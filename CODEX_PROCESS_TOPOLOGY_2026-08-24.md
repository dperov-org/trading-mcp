# Топология процессов Codex и app-server

Снимок собран 24 августа 2026, 14:34 MSK (11:34 UTC на `singapur`).
Это диагностический отчёт: он отделяет наблюдаемые связи `PID → PPID` от
интерпретаций роли процесса. Значения актуальны только на момент снимка.

## Область исследования

Исследованы 10 связанных локальных процессов Windows:

1. основной процесс VS Code и два его `NodeService`-процесса;
2. два app-server, запущенных расширением ChatGPT для VS Code;
3. два code-mode-host;
4. CUA runtime launcher и запущенный им app-server на `stdio://`;
5. Codex Desktop (`ChatGPT.exe`).

Команды получены из `Win32_Process`, TCP — из `Get-NetTCPConnection`.  Запуск
с повышенными правами для чтения окружения других процессов не выполнялся.

## Ancestry: 10 процессов (локальная машина)

| PID | PPID | Родитель / исполняемый файл | Начат (MSK) | Командная строка (существенная часть) | `CODEX_HOME` | Рабочий каталог |
| ---: | ---: | --- | --- | --- | --- | --- |
| 21796 | 4472 | родитель уже завершён; `C:\Program Files\Microsoft VS Code\Code.exe` | 20.08 14:01:38 | `Code.exe .` | не наблюдался | не наблюдался |
| 21904 | 21796 | `Code.exe` | 24.08 14:09:05 | `Code.exe --type=utility --utility-sub-type=node.mojom.NodeService … --user-data-dir=C:\Users\user\AppData\Roaming\Code` | не наблюдался | не наблюдался |
| 44464 | 21796 | `Code.exe` | 24.08 11:35:43 | `Code.exe --type=utility --utility-sub-type=node.mojom.NodeService … --user-data-dir=C:\Users\user\AppData\Roaming\Code` | не наблюдался | не наблюдался |
| 42324 | 44464 | `Code.exe` | 24.08 11:35:49 | `…\.vscode\extensions\openai.chatgpt-26.818.61809-win32-x64\bin\windows-x86_64\codex.exe -c features.code_mode_host=true app-server --analytics-default-enabled` | не наблюдался | не наблюдался |
| 45252 | 21904 | `Code.exe` | 24.08 14:09:16 | та же команда `…\openai.chatgpt-26.818.61809-win32-x64\…\codex.exe … app-server` | не наблюдался | не наблюдался |
| 48700 | 42324 | расширение VS Code `codex.exe` | 24.08 11:37:47 | `…\openai.chatgpt-26.818.61809-win32-x64\…\codex-code-mode-host.exe` | не наблюдался | не наблюдался |
| 48780 | 45252 | расширение VS Code `codex.exe` | 24.08 14:12:42 | `…\openai.chatgpt-26.818.61809-win32-x64\…\codex-code-mode-host.exe` | не наблюдался | не наблюдался |
| 49052 | 42324 | расширение VS Code `codex.exe` | 24.08 11:36:20 | `…\AppData\Local\OpenAI\Codex\runtimes\cua_node\e0c305cbb434431d\bin\node_repl.exe` | не наблюдался | открытый handle на `C:\Projects\trading-mcp`; это не доказывает CWD |
| 46992 | 49052 | CUA runtime `node_repl.exe` | 24.08 11:38:33 | `…\AppData\Local\OpenAI\Codex\bin\1b8b258736e26786\codex.exe app-server --listen stdio://` | не наблюдался | не наблюдался |
| 7296 | 1968 | `explorer.exe`; `…\WindowsApps\OpenAI.Codex_26.818.2441.0_x64__2p2nqsd0c76g0\app\ChatGPT.exe` | 20.08 18:01:20 | `ChatGPT.exe` | не наблюдался | не наблюдался |

Полные строки двух `Code.exe` содержат стандартные Electron/Mojo-флаги,
каналы и trial flags; выше сохранены флаги, идентифицирующие тип процесса.
`CODEX_HOME` не был задан в оболочке диагноста и не виден через
`Win32_Process`; путь `AppData\Local\OpenAI\Codex` — это обнаруженный путь
к рантайму, **не** доказанное значение переменной окружения.

Дополнительное прямое подтверждение проекта: потомки PID 49052 `node.exe`
были запущены с `--working-dir C:\Projects\trading-mcp` и аргументом
`C:\Projects\trading-mcp`. Они не включены в таблицу десяти, поскольку не
являются app-server.

## Локальные TCP и named pipes

| PID | Наблюдаемые TCP-сокеты |
| ---: | --- |
| 21904 | слушает `127.0.0.1:12271` |
| 44464 | слушает `127.0.0.1:1336`; есть исходящее TLS-соединение к `172.64.155.209:443` |
| 42324 | исходящие TLS: `100.95.176.25:{6745,8311} → {104.18.32.47,172.64.155.209}:443`; два `CloseWait` к `104.18.32.47:443` |
| 45252 | исходящие TLS: `100.95.176.25:{1717,5054,6598} → 104.18.32.47:443` |
| 21796, 48700, 48780, 49052, 46992, 7296 | TCP-сокетов в таблице снимка нет |

`46992` слушает `stdio://`, поэтому отсутствие TCP у этого app-server
ожидаемо. Система содержит named pipes с префиксами `codex-ipc`,
`codex-browser-use-*`, `codex-computer-use-*` и VS Code Git pipes, но
стандартный просмотр handle не позволил надёжно атрибутировать владельца
конкретной трубы одному из десяти PID. В отчёте они поэтому не выданы как
подтверждённый канал конкретного процесса.

## Восстановленная топология

```text
VS Code PID 21796
├─ NodeService PID 44464
│  └─ VS Code ChatGPT extension codex PID 42324  [app-server]
│     ├─ codex-code-mode-host PID 48700
│     └─ CUA node_repl PID 49052
│        └─ Codex PID 46992  [app-server --listen stdio://]
└─ NodeService PID 21904
   └─ VS Code ChatGPT extension codex PID 45252  [app-server]
      └─ codex-code-mode-host PID 48780

Codex Desktop: ChatGPT.exe PID 7296 (родитель — explorer.exe)
└─ в выбранных 10 нет дочернего app-server
```

Выводы:

- Связь **VS Code extension host → app-server** подтверждена по ancestry:
  `Code NodeService → extension-bundled codex.exe app-server`. Буквальный
  процесс с флагом `--extensionHost` в этом снимке не обнаружен, поэтому
  `NodeService` назван наблюдаемым bridge-процессом, а не безусловно
  extension host.
- Локальный `PID 46992` — второй app-server в ветви расширения, но он
  транспортно локален (`stdio://`), а не удалённый Singapur server.
- Связь **Codex Desktop → app-server** этой выборкой не подтверждена.
  `ChatGPT.exe` является отдельным корнем; наблюдался его дочерний
  `codex-computer-use.exe`, но не app-server. Это не исключает IPC через
  дочерние renderer/utility процессы, только исключает доказанную прямую
  цепочку среди данных PID.
- Отдельного процесса с именем «OpenAI Runtime Manager» не найдено.
  `PID 49052 node_repl.exe` расположен внутри CUA runtime и непосредственно
  запускает `PID 46992`; разумно называть его runtime launcher/host, но не
  подтверждать продуктовую роль «Runtime Manager» только по этому снимку.

## Удалённый app-server: Singapur

На сервере `singapur` app-server — независимая Linux-ветвь, запущенная
`screen`, а не потомок ни VS Code, ни локального Codex Desktop:

```text
PID 1903307  SCREEN codex-app (PPID 1), started 16.08 13:28:12 UTC
└─ 1903309  npm run codex:app-server:linux
   └─ 1903330  sh -c bash scripts/start-codex-app-server-with-mcp.sh
      └─ 1903331  node /usr/bin/codex -C /root/projects/trading-mcp app-server …
         └─ 1903395  actual codex binary …/codex-linux-x64/…/codex
            --listen ws://127.0.0.1:8790
            -- MCP URLs: 127.0.0.1:8791/mcp/bybit, :8792/mcp/mexc
```

На момент снимка PID 1903395 слушает `127.0.0.1:8790`. Tailscale (`tailscaled`
PID 1454045) публикует tailnet-слушатели `100.121.145.114:8790` и IPv6, а
также 8791/8792. Web UI слушает только `127.0.0.1:8787`; MCP-серверы —
`127.0.0.1:8791` и `:8792`.

```text
local remote client configuration (start-codex-remote.bat)
   └─ ws://singapur.tail3e0cf.ts.net:8790
        └─ Tailscale serve/funnel
             └─ remote Codex app-server PID 1903395
                  ├─ Bybit MCP :8791
                  └─ MEXC MCP  :8792
```

Наличие `start-codex-remote.bat` подтверждает конфигурацию клиентского
подключения к удалённому адресу, но не доказывает, что такой клиент был
запущен в момент снимка.

## Scheduler / remote

Отдельные задачи `perfect-storm` на Singapur являются sibling-процессами с
PPID 1, также запущенными в отдельных `screen`-сессиях:

```text
PID 640432  SCREEN run_watch_update       → PID 640434 Python
PID 640447  SCREEN collect_btc_options    → PID 640449 Python
PID 1862322 SCREEN position_listener      → Python run_bybit_private_stream
PID 1862727 SCREEN do_trades_import_new   → Python run_option_trade_listener
```

У них нет ancestry к `codex-app` PID 1903307 и не найдено systemd unit/timer,
который связывал бы их с Codex. Следовательно, по наблюдаемым данным это
параллельные долгоживущие сервисы, а не scheduler дочерних задач app-server.

## Практический итог

Есть три разные сущности, которые нельзя смешивать при диагностике:

1. VS Code extension запускает локальные app-server / code-mode процессы.
2. Codex Desktop — отдельное Electron-приложение; прямая связь с app-server
   данным снимком не установлена.
3. Singapur app-server — самостоятельный `screen`-managed сервер, к которому
   удалённые клиенты могут подключаться через Tailscale.

Для следующего снимка с точным `CODEX_HOME`, CWD и владельцами named pipes
следует собирать процессное окружение/handle от имени того же пользователя с
повышенными правами (например Process Explorer или системный дамп handles),
не подменяя неизвестные значения догадками.
