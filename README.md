# Ruido Ambiental

Aplicativo desktop (Windows) para gerar ruído branco/complementar com sons ambiente e áudio do YouTube. Funciona como um servidor local aberto no navegador, com execução em segundo plano e controle na bandeja.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `index.html` | Interface web (UI, áudio Web Audio, configurações, perfis, equalizador) |
| `Launcher.cs` | Launcher C#: servidor HTTP local, bandeja, single-instance, downloads |
| `Instalar_Ruido_Branco_Desktop.bat` | Compila e instala o executável na Área de Trabalho |
| `app.ico` | Ícone do executável e da bandeja |
| `LEIA-ME.txt` | Instruções de uso em português |

## Instalação / atualização

1. Baixe os arquivos deste repositório.
2. Execute `Instalar_Ruido_Branco_Desktop.bat`.
3. O script gera `Ruido Ambiental.exe` na Área de Trabalho e abre o app.

Requisitos: Windows com .NET Framework 4.5+ (presente no Windows 10/11) e navegador Chrome ou Edge. O instalador usa o compilador `csc.exe` do próprio Windows.

## Uso básico

- **Iniciar/pausar áudio:** botão principal ou ícone na bandeja.
- **Sons:** aba "Ruído" (base) e "Sons" (chuva, vento, cachoeira, pássaros, etc.).
- **Perfis:** salvar e alternar configurações na barra lateral.
- **Equalização:** aba com 6 bandas e presets. Afeta o áudio gerado pelo app e arquivos locais (não o YouTube).
- **Modo compacto:** botão da abinha redimensiona a janela; `Esc` ou botão ⤢ voltam ao normal.
- **Segundo plano:** ao fechar a janela, o áudio continua (padrão). Use a bandeja para pausar, reabrir ou sair.
- **Até 3 painéis:** arraste abas para a área lateral para abrir lado a lado.
- **Cadeado:** bloqueia alteração de parâmetros e configurações; permite navegar entre abas/perfis, play/pause e volume geral.

## Downloads do YouTube

No modal de adicionar mídia, cole um link do YouTube e clique em **Baixar vídeo**. Na primeira vez, clique em **Instalar yt-dlp** — o app baixa automaticamente `yt-dlp.exe` e `deno.exe` dos releases oficiais do GitHub para `%LOCALAPPDATA%\RuidoBrancoApp`. Os vídeos são salvos em `%LOCALAPPDATA%\RuidoBrancoApp\Downloads` (menu da bandeja abre a pasta).

Links oficiais:
- yt-dlp: https://github.com/yt-dlp/yt-dlp (Unlicense)
- Deno: https://github.com/denoland/deno (MIT)

Baixe apenas conteúdo próprio ou autorizado. O app não contorna restrições de idade, região ou pagamento.

## Dados locais

- Configurações e perfis: `localStorage` do navegador (chave `ruido_ambiental_cache_v7`).
- Posição da janela: `%LOCALAPPDATA%\RuidoBrancoApp\window.bounds`.
- Perfil do navegador: `%LOCALAPPDATA%\RuidoBrancoApp\WebProfile`.
- Arquivos de mídia locais: IndexedDB do navegador.

## Endpoints do servidor local

O launcher expõe apenas `127.0.0.1` na porta 48723 (ou primeira disponível):

| Endpoint | Uso |
| --- | --- |
| `GET /` | Interface |
| `GET /get-command?since=N` | Comandos da bandeja (`seq|cmd`) |
| `POST/GET /playback-state?playing=1` | Estado de reprodução |
| `GET /background-mode?enabled=1` | Ativa/desativa segundo plano |
| `GET /page-alive` | Heartbeat da UI |
| `GET /window-closed` | Sinaliza janela fechada |
| `GET /bounds?x=&y=&w=&h=` / `GET /get-bounds` | Posição da janela |
| `GET /download-youtube?url=` | Inicia download |
| `GET /install-ytdlp` | Instala yt-dlp + Deno |
| `GET /download-status` / `GET /downloads` | Status e lista de downloads |
| `GET /open-downloads` | Abre a pasta no Explorer |

## Notas técnicas

- O servidor HTTP roda no processo do launcher, independente do navegador — fechar a janela não derruba a porta.
- Instância única via `Mutex`; reabrir pela bandeja reaproveita o servidor.
- Áudio gerado e arquivos locais passam por `masterCompressor → EQ (6 filtros) → masterGain → analyser → destination`.
- YouTube toca via iframe (não passa pelo Web Audio).
