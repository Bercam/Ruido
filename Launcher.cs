using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace RuidoBrancoLauncher
{
    static class Program
    {
        const string MutexName = "RuidoBrancoLauncher_SingleInstance";
        const string UrlFileName = "server.url";
        const string BoundsFileName = "window.bounds";
        const string DownloadsDirName = "Downloads";
        const string YtDlpFileName = "yt-dlp.exe";
        const string DenoFileName = "deno.exe";
        const string DenoDownloadUrl = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
        const int PreferredPort = 48723;

        static string appDir;
        static string htmlFilePath;
        static string baseUrl;
        static HttpListener listener;
        static NotifyIcon trayIcon;
        static volatile bool keepRunning = true;

        static ToolStripMenuItem playPauseMenuItem;
        static volatile bool backgroundModeEnabled = true;
        static volatile bool backgroundHostActive = false;
        static volatile bool playbackPlaying = false;
        static long lastUiHeartbeatTicks;
        static readonly object commandLock = new object();
        static int commandSeq = 0;
        static string pendingCommand = "none";

        static string downloadsDir;
        static readonly object downloadLock = new object();
        static Process downloadProcess = null;
        static string downloadState = "idle";
        static string downloadMessage = "";
        static StringBuilder downloadErrorLog = new StringBuilder();
        static bool ytDlpInstallBusy = false;
        const string YtDlpDownloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";

        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        [DllImport("user32.dll")]
        static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                appDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "RuidoBrancoApp"
                );
                if (!Directory.Exists(appDir)) Directory.CreateDirectory(appDir);

                htmlFilePath = Path.Combine(appDir, "index.html");
                downloadsDir = Path.Combine(appDir, DownloadsDirName);
                if (!Directory.Exists(downloadsDir)) Directory.CreateDirectory(downloadsDir);

                bool createdNew;
                using (Mutex mutex = new Mutex(true, MutexName, out createdNew))
                {
                    if (!createdNew)
                    {
                        // Ja ha uma instancia rodando: apenas reabre a janela no URL correto.
                        OpenBrowser(ReadExistingUrl(), BuildWindowArgs());
                        return;
                    }

                    if (!File.Exists(htmlFilePath))
                    {
                        ShowError(
                            "Arquivo de interface nao encontrado em:\n" + htmlFilePath +
                            "\n\nExecute novamente o Instalar_Ruido_Branco_Desktop.bat."
                        );
                        return;
                    }

                    if (!TryStartListener(out baseUrl))
                    {
                        ShowError(
                            "Nao foi possivel iniciar o servidor local do aplicativo.\n\n" +
                            "Verifique se uma outra instancia esta em execucao e tente novamente."
                        );
                        return;
                    }

                    WriteExistingUrl(baseUrl);

                    Thread serverThread = new Thread(ServeLoop);
                    serverThread.IsBackground = true;
                    serverThread.Start();

                    CreateTrayIcon();
                    OpenBrowser(baseUrl, BuildWindowArgs(), true);

                    // O servidor NAO depende do processo do navegador: navegadores reaproveitam
                    // instancias existentes e o processo lancado pode terminar em segundos.
                    Application.Run();

                    keepRunning = false;
                    StopListener();
                    DeleteExistingUrl();
                }
            }
            catch (Exception ex)
            {
                ShowError("Falha ao iniciar o aplicativo:\n\n" + ex.Message);
            }
            finally
            {
                keepRunning = false;
                StopListener();
                DisposeTrayIcon();
            }
        }

        static string ReadExistingUrl()
        {
            try
            {
                string path = Path.Combine(appDir, UrlFileName);
                if (File.Exists(path))
                {
                    string url = File.ReadAllText(path).Trim();
                    if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) return url;
                }
            }
            catch (Exception) { }
            return "http://127.0.0.1:" + PreferredPort + "/";
        }

        static void WriteExistingUrl(string url)
        {
            try { File.WriteAllText(Path.Combine(appDir, UrlFileName), url); }
            catch (Exception) { }
        }

        static void DeleteExistingUrl()
        {
            try
            {
                string path = Path.Combine(appDir, UrlFileName);
                if (File.Exists(path)) File.Delete(path);
            }
            catch (Exception) { }
        }

        static string ReadWindowBoundsText()
        {
            try
            {
                string path = Path.Combine(appDir, BoundsFileName);
                if (File.Exists(path))
                {
                    string saved = File.ReadAllText(path).Trim();
                    if (saved.Length > 0) return saved;
                }
            }
            catch (Exception) { }
            return "80,80,520,720";
        }

        static string BuildWindowArgs()
        {
            int x = 80;
            int y = 80;
            int w = 520;
            int h = 720;

            try
            {
                string path = Path.Combine(appDir, BoundsFileName);
                if (File.Exists(path))
                {
                    string[] parts = File.ReadAllText(path).Trim().Split(',');
                    if (parts.Length == 4)
                    {
                        int.TryParse(parts[0], out x);
                        int.TryParse(parts[1], out y);
                        int.TryParse(parts[2], out w);
                        int.TryParse(parts[3], out h);
                    }
                }
            }
            catch (Exception) { }

            w = Math.Max(320, Math.Min(3840, w));
            h = Math.Max(240, Math.Min(2160, h));
            return string.Format("--window-position={0},{1} --window-size={2},{3}", x, y, w, h);
        }

        static void SaveWindowBounds(int x, int y, int w, int h)
        {
            if (w <= 0 || h <= 0) return;
            w = Math.Max(320, Math.Min(3840, w));
            h = Math.Max(240, Math.Min(2160, h));
            try
            {
                File.WriteAllText(
                    Path.Combine(appDir, BoundsFileName),
                    string.Format("{0},{1},{2},{3}", x, y, w, h)
                );
            }
            catch (Exception) { }
        }

        static bool TryStartListener(out string url)
        {
            url = null;
            string[] hosts = new string[] { "127.0.0.1", "localhost" };

            // Tenta algumas portas proximas para nao depender de uma checagem previa
            // (que tem janela de corrida entre o teste e o HttpListener.Start).
            for (int port = PreferredPort; port < PreferredPort + 20; port++)
            {
                for (int h = 0; h < hosts.Length; h++)
                {
                    HttpListener candidate = new HttpListener();
                    string prefix = string.Format("http://{0}:{1}/", hosts[h], port);
                    try
                    {
                        candidate.Prefixes.Add(prefix);
                        candidate.Start();
                        listener = candidate;
                        url = prefix;
                        return true;
                    }
                    catch (Exception)
                    {
                        try { candidate.Stop(); } catch (Exception) { }
                        try { candidate.Close(); } catch (Exception) { }
                    }
                }
            }
            return false;
        }

        static void StopListener()
        {
            HttpListener current = listener;
            listener = null;
            if (current == null) return;
            try { current.Stop(); } catch (Exception) { }
            try { current.Close(); } catch (Exception) { }
        }

        static void ServeLoop()
        {
            while (keepRunning && listener != null && listener.IsListening)
            {
                HttpListenerContext ctx = null;
                try
                {
                    ctx = listener.GetContext();
                }
                catch (HttpListenerException) { break; }
                catch (ObjectDisposedException) { break; }
                catch (Exception)
                {
                    if (!keepRunning) break;
                    continue;
                }

                try
                {
                    string path = ctx.Request.Url.AbsolutePath;

                    if (path == "/favicon.ico")
                    {
                        ctx.Response.StatusCode = 204;
                    }
                    else if (path == "/get-command")
                    {
                        int since = 0;
                        int.TryParse(GetQueryValue(ctx, "since"), out since);
                        int seq;
                        string cmd;
                        lock (commandLock)
                        {
                            seq = commandSeq;
                            cmd = seq > since ? pendingCommand : "none";
                        }
                        byte[] payload = Encoding.UTF8.GetBytes(seq + "|" + cmd);
                        ctx.Response.ContentType = "text/plain; charset=utf-8";
                        ctx.Response.ContentLength64 = payload.Length;
                        ctx.Response.OutputStream.Write(payload, 0, payload.Length);
                    }
                    else if (path == "/playback-state")
                    {
                        playbackPlaying = GetQueryValue(ctx, "playing") == "1";
                        RefreshTrayMenu();
                        ctx.Response.StatusCode = 204;
                    }
                    else if (path == "/background-mode")
                    {
                        backgroundModeEnabled = GetQueryValue(ctx, "enabled") == "1";
                        ctx.Response.StatusCode = 204;
                    }
                    else if (path == "/page-alive")
                    {
                        Interlocked.Exchange(ref lastUiHeartbeatTicks, DateTime.UtcNow.Ticks);
                        ctx.Response.StatusCode = 204;
                    }
                    else if (path == "/window-closed")
                    {
                        if (backgroundModeEnabled) ScheduleBackgroundHostCheck();
                        ctx.Response.StatusCode = 204;
                    }
                    else if (path == "/download-status")
                    {
                        string state;
                        string message;
                        lock (downloadLock)
                        {
                            state = downloadState;
                            message = downloadMessage;
                        }
                        WriteText(ctx,
                            "{\"state\":\"" + JsonEscape(state) + "\",\"message\":\"" + JsonEscape(message) + "\"}",
                            "application/json; charset=utf-8");
                    }
                    else if (path == "/downloads")
                    {
                        StringBuilder list = new StringBuilder("[");
                        bool first = true;
                        try
                        {
                            foreach (string file in Directory.GetFiles(downloadsDir))
                            {
                                FileInfo info = new FileInfo(file);
                                if (!first) list.Append(',');
                                first = false;
                                list.Append("{\"name\":\"").Append(JsonEscape(info.Name))
                                    .Append("\",\"size\":").Append(info.Length).Append('}');
                            }
                        }
                        catch (Exception) { }
                        list.Append(']');
                        WriteText(ctx, list.ToString(), "application/json; charset=utf-8");
                    }
                    else if (path == "/download-youtube")
                    {
                        string error = StartYoutubeDownload(GetQueryValue(ctx, "url"));
                        if (string.IsNullOrEmpty(error)) ctx.Response.StatusCode = 204;
                        else
                        {
                            ctx.Response.StatusCode = 400;
                            byte[] payload = Encoding.UTF8.GetBytes(error);
                            ctx.Response.ContentType = "text/plain; charset=utf-8";
                            ctx.Response.ContentLength64 = payload.Length;
                            ctx.Response.OutputStream.Write(payload, 0, payload.Length);
                        }
                    }
                    else if (path == "/install-ytdlp")
                    {
                        string error = InstallYtDlp();
                        if (string.IsNullOrEmpty(error)) ctx.Response.StatusCode = 204;
                        else
                        {
                            ctx.Response.StatusCode = 400;
                            byte[] payload = Encoding.UTF8.GetBytes(error);
                            ctx.Response.ContentType = "text/plain; charset=utf-8";
                            ctx.Response.ContentLength64 = payload.Length;
                            ctx.Response.OutputStream.Write(payload, 0, payload.Length);
                        }
                    }
                    else if (path == "/open-downloads")
                    {
                        try
                        {
                            Process.Start("explorer.exe", "\"" + downloadsDir + "\"");
                        }
                        catch (Exception) { }
                        ctx.Response.StatusCode = 204;
                    }
                    else if (path == "/get-bounds")
                    {
                        byte[] bounds = Encoding.UTF8.GetBytes(ReadWindowBoundsText());
                        ctx.Response.ContentType = "text/plain; charset=utf-8";
                        ctx.Response.ContentLength64 = bounds.Length;
                        ctx.Response.OutputStream.Write(bounds, 0, bounds.Length);
                    }
                    else if (path == "/bounds")
                    {
                        int x = 0, y = 0, w = 0, h = 0;
                        string[] pairs = ctx.Request.Url.Query.TrimStart('?').Split('&');
                        for (int i = 0; i < pairs.Length; i++)
                        {
                            string[] kv = pairs[i].Split('=');
                            if (kv.Length != 2) continue;
                            int value;
                            if (!int.TryParse(kv[1], out value)) continue;
                            if (kv[0] == "x") x = value;
                            else if (kv[0] == "y") y = value;
                            else if (kv[0] == "w") w = value;
                            else if (kv[0] == "h") h = value;
                        }
                        SaveWindowBounds(x, y, w, h);
                        ctx.Response.StatusCode = 204;
                    }
                    else
                    {
                        byte[] content = File.ReadAllBytes(htmlFilePath);
                        ctx.Response.ContentType = "text/html; charset=utf-8";
                        ctx.Response.AddHeader("Cache-Control", "no-store");
                        ctx.Response.ContentLength64 = content.Length;
                        ctx.Response.OutputStream.Write(content, 0, content.Length);
                    }
                }
                catch (Exception)
                {
                    try { ctx.Response.StatusCode = 500; } catch (Exception) { }
                }
                finally
                {
                    try { ctx.Response.OutputStream.Close(); } catch (Exception) { }
                }
            }
        }

        static void WriteText(HttpListenerContext ctx, string text, string contentType)
        {
            byte[] payload = Encoding.UTF8.GetBytes(text);
            ctx.Response.ContentType = contentType;
            ctx.Response.ContentLength64 = payload.Length;
            ctx.Response.OutputStream.Write(payload, 0, payload.Length);
        }

        static string JsonEscape(string value)
        {
            if (value == null) value = "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in value)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c == '\t') sb.Append("\\t");
                else if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.ToString();
        }

        static string FindJsRuntimeArg()
        {
            string denoPath = Path.Combine(appDir, DenoFileName);
            try { if (File.Exists(denoPath)) return "--js-runtimes deno:\"" + denoPath + "\""; }
            catch (Exception) { }
            return "";
        }

        static string StartYoutubeDownload(string url)
        {
            if (string.IsNullOrWhiteSpace(url)) return "Informe a URL do vídeo.";

            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri) ||
                (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                return "URL inválida.";

            string host = uri.Host.ToLowerInvariant();
            bool isYoutube = host == "youtube.com" || host.EndsWith(".youtube.com") ||
                             host == "youtu.be" || host.EndsWith(".youtu.be");
            if (!isYoutube) return "Use apenas links públicos do YouTube.";

            string ytDlpPath = Path.Combine(appDir, YtDlpFileName);
            string denoPath = Path.Combine(appDir, DenoFileName);
            if (!File.Exists(ytDlpPath) || !File.Exists(denoPath))
                return "Clique em “Instalar yt-dlp” para baixar o yt-dlp e o Deno (necessário para o YouTube).";

            if (string.IsNullOrEmpty(FindJsRuntimeArg()))
                return "Runtime JavaScript (Deno) não encontrado. Clique em “Instalar yt-dlp”.";

            Process existing;
            lock (downloadLock) { existing = downloadProcess; }
            if (existing != null)
            {
                try { if (!existing.HasExited) return "Já existe um download em andamento."; }
                catch (Exception) { }
            }

            string outTemplate = Path.Combine(downloadsDir, "%(title).80s [%(id)s].%(ext)s");
            string safeUrl = url.Replace("\"", "").Replace("\r", "").Replace("\n", "");
            string runtimeArg = FindJsRuntimeArg();
            string arguments = "--no-playlist --no-part --no-overwrites --restrict-filenames " +
                               (!string.IsNullOrEmpty(runtimeArg) ? runtimeArg + " " : "") +
                               "-f \"best[acodec!=none][height<=720]/best[acodec!=none]/best\" " +
                               "-o \"" + outTemplate + "\" \"" + safeUrl + "\"";

            try
            {
                Process process = new Process();
                process.StartInfo.FileName = ytDlpPath;
                process.StartInfo.Arguments = arguments;
                process.StartInfo.WorkingDirectory = appDir;
                process.StartInfo.UseShellExecute = false;
                process.StartInfo.CreateNoWindow = true;
                process.StartInfo.RedirectStandardError = true;
                process.EnableRaisingEvents = true;

                lock (downloadLock) { downloadErrorLog.Length = 0; }
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (string.IsNullOrEmpty(e.Data)) return;
                    lock (downloadLock)
                    {
                        if (downloadErrorLog.Length < 2000)
                        {
                            if (downloadErrorLog.Length > 0) downloadErrorLog.Append('\n');
                            downloadErrorLog.Append(e.Data);
                        }
                    }
                };

                process.Exited += delegate(object sender, EventArgs e)
                {
                    int code = -1;
                    try { code = ((Process)sender).ExitCode; } catch (Exception) { }
                    lock (downloadLock)
                    {
                        downloadProcess = null;
                        downloadState = code == 0 ? "done" : "error";
                        if (code == 0)
                        {
                            downloadMessage = "Download concluído. O arquivo está na pasta Downloads do app.";
                        }
                        else
                        {
                            string detail = ExtractYtDlpError(downloadErrorLog.ToString());
                            downloadMessage = string.IsNullOrEmpty(detail)
                                ? "Falha no download (código " + code + "). O vídeo pode ser privado, ter restrição de idade ou estar indisponível."
                                : detail;
                        }
                    }
                };

                lock (downloadLock)
                {
                    downloadProcess = process;
                    downloadState = "downloading";
                    downloadMessage = "Baixando vídeo...";
                }
                process.Start();
                process.BeginErrorReadLine();
                return "";
            }
            catch (Exception ex)
            {
                lock (downloadLock)
                {
                    downloadProcess = null;
                    downloadState = "error";
                    downloadMessage = ex.Message;
                }
                return "Falha ao iniciar o download: " + ex.Message;
            }
        }

        static string ExtractYtDlpError(string log)
        {
            if (string.IsNullOrWhiteSpace(log)) return "";
            string[] lines = log.Split('\n');
            string lastError = "";
            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i].Trim();
                if (line.IndexOf("ERROR:", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    line.IndexOf("error:", StringComparison.OrdinalIgnoreCase) >= 0)
                    lastError = line;
            }
            if (!string.IsNullOrEmpty(lastError))
            {
                int idx = lastError.IndexOf("ERROR:", StringComparison.OrdinalIgnoreCase);
                if (idx < 0) idx = lastError.IndexOf("error:", StringComparison.OrdinalIgnoreCase);
                if (idx >= 0) lastError = lastError.Substring(idx);
                if (lastError.Length > 220) lastError = lastError.Substring(0, 220) + "...";
                return lastError;
            }
            string trimmed = log.Trim();
            if (trimmed.Length > 220) trimmed = trimmed.Substring(trimmed.Length - 220);
            return trimmed;
        }

        static string InstallYtDlp()
        {
            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Ssl3 | SecurityProtocolType.Tls |
                    (SecurityProtocolType)768 | (SecurityProtocolType)3072;
            }
            catch (Exception) { }

            string ytDlpPath = Path.Combine(appDir, YtDlpFileName);
            string denoPath = Path.Combine(appDir, DenoFileName);
            bool needYtDlp = !File.Exists(ytDlpPath);
            bool needDeno = !File.Exists(denoPath);

            if (!needYtDlp && !needDeno)
            {
                lock (downloadLock)
                {
                    downloadState = "done";
                    downloadMessage = "yt-dlp e Deno já estão instalados.";
                }
                return "";
            }

            lock (downloadLock)
            {
                if (ytDlpInstallBusy) return "A instalação já está em andamento.";
                if (downloadProcess != null)
                {
                    try { if (!downloadProcess.HasExited) return "Aguarde o download atual terminar."; }
                    catch (Exception) { }
                }
                ytDlpInstallBusy = true;
                downloadState = "downloading";
                downloadMessage = needDeno ? "Baixando yt-dlp e Deno do GitHub..." : "Baixando yt-dlp do GitHub...";
            }

            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                try
                {
                    if (needYtDlp)
                    {
                        string tempPath = ytDlpPath + ".downloading";
                        try
                        {
                            if (File.Exists(tempPath)) File.Delete(tempPath);
                            using (WebClient client = new WebClient())
                                client.DownloadFile(YtDlpDownloadUrl, tempPath);
                            File.Move(tempPath, ytDlpPath);
                        }
                        catch (Exception)
                        {
                            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch (Exception) { }
                            throw;
                        }
                    }

                    if (needDeno)
                    {
                        lock (downloadLock) { downloadMessage = "Baixando Deno do GitHub..."; }
                        string zipPath = Path.Combine(appDir, "deno.downloading.zip");
                        string extractDir = Path.Combine(appDir, "deno_extract");
                        try
                        {
                            if (File.Exists(zipPath)) File.Delete(zipPath);
                            if (Directory.Exists(extractDir)) Directory.Delete(extractDir, true);
                            using (WebClient client = new WebClient())
                                client.DownloadFile(DenoDownloadUrl, zipPath);
                            ZipFile.ExtractToDirectory(zipPath, extractDir);
                            string extracted = Path.Combine(extractDir, DenoFileName);
                            if (!File.Exists(extracted)) throw new FileNotFoundException("deno.exe não encontrado no pacote.");
                            File.Move(extracted, denoPath);
                        }
                        finally
                        {
                            try { if (File.Exists(zipPath)) File.Delete(zipPath); } catch (Exception) { }
                            try { if (Directory.Exists(extractDir)) Directory.Delete(extractDir, true); } catch (Exception) { }
                        }
                    }

                    lock (downloadLock)
                    {
                        downloadState = "done";
                        downloadMessage = "yt-dlp e Deno instalados. Agora é possível baixar vídeos do YouTube.";
                    }
                }
                catch (Exception ex)
                {
                    lock (downloadLock)
                    {
                        downloadState = "error";
                        downloadMessage = "Falha ao instalar: " + ex.Message;
                    }
                }
                finally
                {
                    lock (downloadLock) { ytDlpInstallBusy = false; }
                }
            });

            return "";
        }

        static string GetQueryValue(HttpListenerContext ctx, string key)
        {
            string[] pairs = ctx.Request.Url.Query.TrimStart('?').Split('&');
            for (int i = 0; i < pairs.Length; i++)
            {
                string[] kv = pairs[i].Split('=');
                if (kv.Length == 2 && kv[0] == key) return Uri.UnescapeDataString(kv[1]);
            }
            return "";
        }

        static void IssueCommand(string cmd)
        {
            lock (commandLock)
            {
                commandSeq++;
                pendingCommand = cmd;
            }
        }

        static void RefreshTrayMenu()
        {
            try
            {
                if (playPauseMenuItem == null || trayIcon == null || trayIcon.ContextMenuStrip == null) return;
                MethodInvoker update = delegate
                {
                    playPauseMenuItem.Text = playbackPlaying ? "Pausar áudio" : "Retomar áudio";
                };
                if (trayIcon.ContextMenuStrip.InvokeRequired) trayIcon.ContextMenuStrip.BeginInvoke(update);
                else update();
            }
            catch (Exception) { }
        }

        static void ScheduleBackgroundHostCheck()
        {
            long beaconTicks = DateTime.UtcNow.Ticks;
            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                Thread.Sleep(1200);
                if (!backgroundModeEnabled || backgroundHostActive) return;
                // Se a pagina enviou um heartbeat depois do beacon, foi apenas um refresh.
                if (Interlocked.Read(ref lastUiHeartbeatTicks) > beaconTicks) return;
                StartBackgroundHost();
            });
        }

        static HashSet<int> GetAudioHostPids()
        {
            HashSet<int> pids = new HashSet<int>();
            try
            {
                string query = "SELECT ProcessId, CommandLine FROM Win32_Process " +
                               "WHERE Name = 'chrome.exe' OR Name = 'msedge.exe'";
                ManagementObjectSearcher searcher = new ManagementObjectSearcher(query);
                foreach (ManagementObject obj in searcher.Get())
                {
                    object cmdObj = obj["CommandLine"];
                    object pidObj = obj["ProcessId"];
                    if (cmdObj == null || pidObj == null) continue;
                    if (cmdObj.ToString().IndexOf("audiohost=1", StringComparison.OrdinalIgnoreCase) >= 0)
                        pids.Add(Convert.ToInt32(pidObj));
                }
            }
            catch (Exception) { }
            return pids;
        }

        static void HideHostWindows(HashSet<int> pids)
        {
            if (pids == null || pids.Count == 0) return;
            EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
            {
                try
                {
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);
                    if (pids.Contains((int)pid)) ShowWindow(hwnd, 0); // SW_HIDE
                }
                catch (Exception) { }
                return true;
            }, IntPtr.Zero);
        }

        static string FindBrowserPath()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe")
            };
            for (int i = 0; i < candidates.Length; i++)
            {
                if (File.Exists(candidates[i])) return candidates[i];
            }
            return null;
        }

        static void StartBackgroundHost()
        {
            if (backgroundHostActive) return;
            string browser = FindBrowserPath();
            if (string.IsNullOrEmpty(browser)) return;

            backgroundHostActive = true;
            try
            {
                string userDataDir = Path.Combine(appDir, "WebProfile");
                string args = string.Format(
                    "--app=\"{0}?audiohost=1\" --user-data-dir=\"{1}\" " +
                    "--window-position=-32000,-32000 --window-size=320,240 " +
                    "--autoplay-policy=no-user-gesture-required --disable-extensions --no-first-run",
                    baseUrl, userDataDir
                );
                Process.Start(new ProcessStartInfo
                {
                    FileName = browser,
                    Arguments = args,
                    UseShellExecute = false
                });
            }
            catch (Exception)
            {
                backgroundHostActive = false;
                return;
            }

            ThreadPool.QueueUserWorkItem(delegate(object state)
            {
                for (int i = 0; i < 24; i++)
                {
                    Thread.Sleep(250);
                    HashSet<int> pids = GetAudioHostPids();
                    if (pids.Count > 0)
                    {
                        HideHostWindows(pids);
                        break;
                    }
                }
            });
        }

        static void CloseBackgroundHost()
        {
            if (!backgroundHostActive) return;
            IssueCommand("close");
            Thread.Sleep(1000);
            HashSet<int> pids = GetAudioHostPids();
            foreach (int pid in pids)
            {
                try { Process.GetProcessById(pid).Kill(); }
                catch (Exception) { }
            }
            backgroundHostActive = false;
            playbackPlaying = false;
            RefreshTrayMenu();
        }

        static void CreateTrayIcon()
        {
            try
            {
                trayIcon = new NotifyIcon();
                string iconPath = Path.Combine(appDir, "app.ico");
                if (File.Exists(iconPath)) trayIcon.Icon = new Icon(iconPath);
                else trayIcon.Icon = SystemIcons.Application;
                trayIcon.Text = "Ruido Ambiental";
                trayIcon.Visible = true;

                ContextMenuStrip menu = new ContextMenuStrip();
                menu.Items.Add("Abrir aplicativo", null, delegate(object sender, EventArgs e)
                {
                    CloseBackgroundHost();
                    OpenBrowser(baseUrl, BuildWindowArgs());
                });
                playPauseMenuItem = (ToolStripMenuItem)menu.Items.Add("Retomar áudio", null, delegate(object sender, EventArgs e)
                {
                    IssueCommand(playbackPlaying ? "pause" : "resume");
                });
                menu.Items.Add("Abrir pasta de downloads", null, delegate(object sender, EventArgs e)
                {
                    try { Process.Start("explorer.exe", "\"" + downloadsDir + "\""); }
                    catch (Exception) { }
                });
                menu.Items.Add("Sair", null, delegate(object sender, EventArgs e)
                {
                    CloseBackgroundHost();
                    CloseProfileBrowsers(Path.Combine(appDir, "WebProfile"));
                    Application.Exit();
                });
                trayIcon.ContextMenuStrip = menu;
                RefreshTrayMenu();
                trayIcon.DoubleClick += delegate(object sender, EventArgs e)
                {
                    CloseBackgroundHost();
                    OpenBrowser(baseUrl, BuildWindowArgs());
                };
            }
            catch (Exception)
            {
                DisposeTrayIcon();
            }
        }

        static void DisposeTrayIcon()
        {
            if (trayIcon == null) return;
            try { trayIcon.Visible = false; } catch (Exception) { }
            try { trayIcon.Dispose(); } catch (Exception) { }
            trayIcon = null;
        }

        static void CloseProfileBrowsers(string profilePath)
        {
            try
            {
                string query = "SELECT ProcessId, CommandLine FROM Win32_Process " +
                               "WHERE Name = 'chrome.exe' OR Name = 'msedge.exe'";
                ManagementObjectSearcher searcher = new ManagementObjectSearcher(query);
                foreach (ManagementObject obj in searcher.Get())
                {
                    object cmdObj = obj["CommandLine"];
                    object pidObj = obj["ProcessId"];
                    if (cmdObj == null || pidObj == null) continue;
                    string cmd = cmdObj.ToString();
                    if (cmd.IndexOf(profilePath, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    try { Process.GetProcessById(Convert.ToInt32(pidObj)).Kill(); }
                    catch (Exception) { }
                }
            }
            catch (Exception) { }
            Thread.Sleep(300);
        }

        static void OpenBrowser(string url, string windowArgs, bool closeExistingProfile = false)
        {
            if (string.IsNullOrEmpty(url)) url = "http://127.0.0.1:" + PreferredPort + "/";
            if (string.IsNullOrEmpty(windowArgs)) windowArgs = BuildWindowArgs();

            string userDataDir = Path.Combine(appDir, "WebProfile");
            if (closeExistingProfile) CloseProfileBrowsers(userDataDir);
            string args = string.Format(
                "--app=\"{0}\" --user-data-dir=\"{1}\" {2} " +
                "--autoplay-policy=no-user-gesture-required --disable-extensions --no-first-run",
                url,
                userDataDir,
                windowArgs
            );

            string browser = FindBrowserPath();
            if (!string.IsNullOrEmpty(browser))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = args,
                        UseShellExecute = false
                    });
                    return;
                }
                catch (Exception) { }
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                ShowError("Nao foi possivel abrir o navegador padrao:\n\n" + ex.Message +
                          "\n\nAbra manualmente: " + url);
            }
        }

        static void ShowError(string message)
        {
            try
            {
                MessageBox.Show(message, "Ruido Ambiental", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            catch (Exception) { }
        }
    }
}
