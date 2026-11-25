# Ruído Ambiental

Aplicativo desktop para Windows para gerar ruídos e sons ambiente, usar arquivos locais e reproduzir áudio do YouTube. O launcher executável abre a interface no navegador, mantém o áudio em segundo plano e adiciona controles na bandeja do sistema.

## Baixar e instalar

1. Baixe `Ruido Ambiental.exe` para executar o aplicativo diretamente, ou baixe `Ruido-Ambiental-Windows.zip` para instalar.
2. No ZIP, execute `Instalar_Ruido_Branco_Desktop.bat`.
3. Na janela de opções, deixe **Criar atalho na Área de Trabalho** marcado para criar o atalho ou desmarque para não criar.

O instalador coloca o executável em `%LOCALAPPDATA%\RuidoBrancoApp` e abre o aplicativo. O desinstalador fica disponível como `Desinstalar_Ruido_Branco_Desktop.bat` no ZIP, como asset separado na página Releases e na pasta instalada. Por padrão, ele mantém downloads e configurações; uma opção permite apagá-los também. O executável inclui a interface e não exige Node.js. É necessário Windows com .NET Framework 4.5+ e Chrome ou Edge.

Se a instalação falhar, uma janela explica o problema e orienta como prosseguir. Os detalhes técnicos são salvos em um arquivo de registro na pasta temporária do Windows.

As versões prontas ficam na página **Releases** do GitHub. Para compilar a partir do código-fonte, use Node.js 20+ e .NET Framework:

```powershell
npm ci
npm test
npm run build
```

O build gera `dist/index.html` como um único arquivo, que pode ser incorporado ao launcher C#.

## Arquitetura

- `src/main.ts`: interface, interação e integração com Web Audio.
- `src/styles.css`: estilos e comportamento responsivo.
- `src/state/persistence.ts`: migração, mesclagem segura de padrões e persistência dos perfis/configurações.
- `Launcher.cs`: servidor HTTP local, bandeja do sistema, instância única e downloads do YouTube.
- `vite.config.ts`: empacota TypeScript e CSS em um HTML único, integrado ao executável.

## Uso básico

- **Iniciar/pausar áudio:** botão principal ou ícone na bandeja.
- **Sons:** aba "Ruído" (base) e "Sons" (chuva, vento, cachoeira, pássaros, ondas, riacho, lareira e trovão distante); os sons ambientes são sintetizados localmente e têm controles individuais de volume e intensidade/tom.
- **Mídias adicionadas:** edite o nome, link do YouTube ou arquivo local de qualquer som ou ruído personalizado pelo botão de edição. Os arquivos locais ficam no IndexedDB.
- **Perfis:** salvar e alternar configurações na barra lateral; cada perfil tem símbolo e cor próprios.
- **Equalização:** aba com 6 bandas e presets. Afeta ruído e arquivos locais, mas não o áudio incorporado do YouTube.
- **Modo compacto:** a abinha abre um mini-player com status, volume e botão para expandir; `Esc` também volta ao normal.
- **Fechamento:** toda vez que fechar a janela, uma confirmação pergunta se deseja manter o áudio/app em segundo plano ou encerrar o aplicativo e parar o áudio.
- **Bandeja do Windows:** o ícone mostra o estado de reprodução; use o menu para abrir, pausar/retomar, acessar downloads ou encerrar.
- **Até 3 painéis:** arraste abas para a área lateral para abrir lado a lado.
- **Cadeado:** bloqueia alteração de parâmetros e configurações; permite navegar entre abas/perfis, play/pause e volume geral.

## Downloads do YouTube

No modal de adicionar mídia, cole um link do YouTube e clique em **Baixar vídeo**. Na primeira vez, clique em **Instalar yt-dlp** — o app baixa automaticamente `yt-dlp.exe` e `deno.exe` dos releases oficiais do GitHub para `%LOCALAPPDATA%\RuidoBrancoApp`. Os vídeos são salvos em `%LOCALAPPDATA%\RuidoBrancoApp\Downloads` (menu da bandeja abre a pasta).

Links oficiais:
- yt-dlp: https://github.com/yt-dlp/yt-dlp (Unlicense)
- Deno: https://github.com/denoland/deno (MIT)

Baixe apenas conteúdo próprio ou autorizado. O app não contorna restrições de idade, região ou pagamento.

## Dados locais

- Configurações, parâmetros e perfis: `localStorage` do navegador (chave `ruido_ambiental_cache_v7`); versões anteriores são migradas automaticamente. Ajustes de som e equalização são capturados ao trocar de perfil e antes de fechar a janela.
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
