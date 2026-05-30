# План разработки: Remote MCP сервер Bybit для Linux + Tailscale Funnel

Дата: 2026-05-24

## 1. Цель

Доработать текущий проект `trading-mcp` до состояния работающего удаленного MCP сервера, который:

- запускается на Linux как фоновый сервис
- доступен извне через `Tailscale Funnel`
- работает с существующим аккаунтом Bybit по предоставленным API-ключам
- поддерживает разбиение `tools` на группы и выборочное подключение групп
- поддерживает выборочное подключение MCP metadata
- поддерживает выборочное подключение MCP prompts
- пишет лог вызовов tools в текстовый файл
- имеет минимальный набор smoke tests без mock, работающих против реального аккаунта
- имеет отдельный интеграционный тест с реальным LLM-клиентом, который подключается к MCP и проверяет видимость tools через prompt

## 2. Исходное состояние репозитория

Сейчас проект:

- реализует MCP только через `stdio` транспорт: [src/server.ts](/c:/Projects/trading-mcp/src/server.ts:2)
- регистрирует только tools
- не поддерживает MCP prompts
- не имеет удаленного HTTP транспорта
- не имеет раздельной конфигурации tool groups
- не имеет полноценного audit/tool-call logging
- не имеет тестовой инфраструктуры

Это означает, что для `Tailscale Funnel` текущая реализация недостаточна: `stdio` подходит только для локального запуска клиентом как дочернего процесса, а для Funnel нужен сетевой транспорт.

## 3. Ключевое архитектурное решение

### 3.1 Транспорт

Для удаленного доступа через Tailscale Funnel сервер нужно перевести на `Streamable HTTP`.

Причина:

- официальный MCP transport spec определяет два стандартных транспорта: `stdio` и `Streamable HTTP`
- `stdio` предполагает, что клиент запускает сервер как subprocess
- `Streamable HTTP` предназначен для независимого серверного процесса с удаленными клиентами

Официальные источники:

- MCP Transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP TS SDK server docs: https://ts.sdk.modelcontextprotocol.io/documents/server.html

### 3.2 Публикация наружу

Наружу сервер публикуется через `Tailscale Funnel`, который умеет проксировать локальный HTTP-сервис на публичный HTTPS endpoint.

Официальный источник:

- Tailscale Funnel CLI docs: https://tailscale.com/docs/reference/tailscale-cli/funnel

Практическая схема:

1. MCP сервер слушает только `127.0.0.1:8080`
2. Tailscale Funnel публикует его наружу
3. внешний URL вида `https://<node>.<tailnet>.ts.net/mcp`
4. LLM-клиент подключается к этому URL как к удаленному MCP серверу

Рекомендуемый локальный binding:

- только `127.0.0.1`
- не `0.0.0.0`

Это согласуется и с MCP security guidance для Streamable HTTP.

### 3.3 LLM-интеграция для e2e теста

Для интеграционного теста разумно использовать клиент, который гарантированно умеет работать с удаленным MCP по HTTP.

Рекомендуемый путь:

- OpenAI Responses API или OpenAI Agents SDK с remote MCP / Streamable HTTP

Официальные источники:

- OpenAI remote MCP guide: https://platform.openai.com/docs/guides/tools-remote-mcp
- OpenAI Agents SDK MCP guide: https://openai.github.io/openai-agents-js/guides/mcp/

Причина выбора:

- документация официальная и актуальная
- есть поддержка удаленных MCP серверов
- подходит для автоматизированного интеграционного сценария

## 4. Целевое состояние системы

В результате должен получиться сервис со следующими режимами:

### 4.1 Режимы запуска

- `stdio` для локальных интеграций и обратной совместимости
- `http` / `streamable-http` для remote доступа

### 4.2 Режимы публикации функциональности

- все группы tools включены по умолчанию
- группы можно ограничивать через env-конфиг
- metadata можно публиковать выборочно
- prompts можно публиковать выборочно

### 4.3 Режимы эксплуатации

- read-only
- authenticated read
- write-enabled режим, если он отдельно разрешен политикой сервера

Хотя в этом документе основной акцент на groups/metadata/prompts/logging, для реального Bybit-аккаунта рекомендуется сразу оставить точку расширения под write-policy.

## 5. Объем работ по направлениям

## 5.1 Workstream A: Новый транспорт и Linux runtime

### Цель

Добавить Streamable HTTP transport без поломки существующего stdio режима.

### Изменения

1. Вынести создание MCP server в отдельную фабрику:
   - `createMcpServer(...)`
   - отдельно от запуска транспорта

2. Разделить запуск на два entrypoint режима:
   - `startStdioServer()`
   - `startHttpServer()`

3. Добавить HTTP entrypoint:
   - новый модуль, например `src/http-server.ts`
   - endpoint `/mcp`
   - поддержка `POST` и `GET` по Streamable HTTP spec

4. Добавить конфиг:
   - `MCP_TRANSPORT=stdio|http`
   - `MCP_HOST=127.0.0.1`
   - `MCP_PORT=8080`
   - `MCP_PATH=/mcp`

5. Добавить базовую HTTP security policy:
   - проверка `Origin`
   - allowlist origin'ов через env
   - возможность отключения strict origin validation только в dev
   - опциональный bearer token для remote MCP

6. Добавить graceful shutdown:
   - SIGTERM
   - SIGINT
   - корректное закрытие HTTP server
   - корректное закрытие активных WebSocket subscriptions

### Результат

- сервер запускается как локальный HTTP MCP сервис на Linux
- тот же проект по-прежнему может работать в stdio режиме

## 5.2 Workstream B: Разбиение tools на группы

### Цель

Сделать группы tools first-class конфигурацией сервера.

### Целевая модель

Каждый tool должен иметь metadata:

- `group`
- `name`
- `description`
- `inputSchema`
- `handler`
- позже можно добавить `requiresAuth` и `access`

### Предлагаемые группы

Минимально начать с текущей структуры `src/tools/*`:

- `market`
- `trade`
- `wstrade`
- `account`
- `position`
- `asset`
- `user`
- `websocket`
- `subscription`
- `rfq-trading`
- `spread-trading`
- `broker`
- `affiliate`
- `bot`
- `earn`
- `earntoken`
- `advanceearn`
- `fixedterm`
- `liquiditymining`
- `p2p`
- `alpha`
- `strategy`
- `spot-margin-trade-uta`
- `spot-margin-uta`
- `crypto-loan-fixed-term`
- `crypto-loan-flexible`
- `crypto-loan-new`
- `copy-trading-classic`
- `copy-trading-tradfi`
- `fiat-convert`
- `doublewin`
- `smartleverage`

### Конфиг

- `BYBIT_ENABLED_TOOL_GROUPS`
- `BYBIT_DISABLED_TOOL_GROUPS`
- `BYBIT_ENABLED_TOOLS`
- `BYBIT_DISABLED_TOOLS`

### Семантика

- по умолчанию включены все группы
- если `BYBIT_ENABLED_TOOL_GROUPS` не задан, используется полный набор
- если задан allowlist, включаются только перечисленные группы
- потом применяется denylist
- затем точечный allow/deny по именам tools

### Изменения

1. Ввести внутренний registry групп
2. Перестроить `src/tools/index.ts` или добавить поверх него новый слой группировки
3. Добавить централизованный фильтр разрешенных tools
4. Фильтровать до регистрации MCP

### Важный принцип

Запрещенные tools не должны появляться в `ListTools` вообще. Их нельзя просто оставить и блокировать только в runtime.

## 5.3 Workstream C: Выборочное подключение MCP metadata

### Цель

Управлять тем, сколько дополнительной MCP metadata сервер публикует клиенту.

### Что считать metadata

Для этого проекта под MCP metadata разумно понимать:

- принадлежность tool к группе
- признак `requiresAuth`
- признак `write-sensitive`
- теги вроде `market-data`, `account-read`, `trade-execution`
- краткие operational hints

### Конфиг

- `BYBIT_MCP_METADATA_MODE=none|basic|full`

### Семантика

- `none`: публиковать только базовые MCP tool fields
- `basic`: публиковать минимальную metadata, достаточную для выбора tool агентом
- `full`: публиковать расширенную metadata

### Реализация

1. Внутренне хранить metadata всегда
2. Перед ответом на `ListTools` применять metadata projection по режиму
3. Если SDK/клиент не поддерживает отдельное metadata-поле, добавлять ее в `description`

### Важный принцип

Metadata публикуется только для разрешенных tools. Для отключенных групп metadata не публикуется вообще.

## 5.4 Workstream D: MCP prompts и их выборочное подключение

### Цель

Добавить серверную поддержку MCP prompts и возможность публиковать только нужные prompt groups.

### Почему это нужно

Пользователь прямо требует выборочное подключение prompts.

Кроме того, MCP prompts в спецификации являются отдельной capability:

- сервер должен декларировать capability `prompts`
- клиент может запрашивать `prompts/list`
- клиент может вызывать `prompts/get`

Официальный источник:

- MCP prompts spec: https://modelcontextprotocol.io/specification/2025-06-18/server/prompts

### Типы prompts для проекта

Практически для Bybit MCP нужны не “общие подсказки”, а прикладные prompt templates, например:

- `market_overview`
- `account_health_check`
- `order_placement_guardrails`
- `position_review`
- `risk_summary`
- `tool_discovery_help`

### Группы prompts

Рекомендуемая модель:

- `general`
- `market`
- `account`
- `trading`
- `risk`
- `ops`

### Конфиг

- `BYBIT_ENABLED_PROMPT_GROUPS`
- `BYBIT_DISABLED_PROMPT_GROUPS`
- `BYBIT_PROMPTS_MODE=off|basic|full`

### Реализация

1. Добавить registry prompts
2. Подключить capability `prompts`
3. Реализовать `prompts/list`
4. Реализовать `prompts/get`
5. Фильтровать prompts теми же принципами, что и tools

### Важный принцип

Prompts тоже должны публиковаться выборочно. Если группа prompts запрещена, клиент ее не видит.

## 5.5 Workstream E: Logging вызовов tools в текстовый файл

### Цель

Записывать все вызовы tools в отдельный текстовый лог, пригодный для аудита и отладки.

### Минимальные требования

- лог именно в файл
- человекочитаемый формат
- запись успешных и неуспешных вызовов
- без утечки секретов

### Предлагаемый формат

Обычный append-only текстовый лог в формате `JSON Lines` или line-oriented text.

Рекомендуемый вариант:

- `.log` файл
- по одной JSON-записи в строке

Например:

```json
{"ts":"2026-05-24T12:34:56Z","requestId":"...","tool":"getTickers","group":"market","status":"ok","durationMs":83,"args":{"category":"spot","symbol":"BTCUSDT"}}
{"ts":"2026-05-24T12:35:02Z","requestId":"...","tool":"createOrder","group":"trade","status":"error","durationMs":51,"error":"Bybit API error 10001: ...","args":{"category":"linear","symbol":"BTCUSDT","side":"Buy","qty":"0.001"}}
```

### Конфиг

- `MCP_TOOL_LOG_ENABLED=true|false`
- `MCP_TOOL_LOG_PATH=/var/log/bybit-mcp/tool-calls.log`
- `MCP_TOOL_LOG_FORMAT=jsonl|text`

### Что логировать

- timestamp
- requestId
- client/session id, если доступен
- tool name
- tool group
- transport mode
- success/error
- duration
- входные args после redaction

### Что редактировать

- секреты auth
- токены
- любые потенциально чувствительные поля, если будут добавлены в future prompts/tools

### Реализация

1. Встроить обертку вокруг `tool.handler`
2. Генерировать `requestId`
3. Добавить redaction helper
4. Писать лог после выполнения tool
5. При ошибке логировать error class и message

### Важный принцип

Логирование должно быть centralized. Не размазывать `console.error` по generated-tools.

## 5.6 Workstream F: Работа с реальным Bybit аккаунтом

### Цель

Обеспечить безопасную и воспроизводимую работу сервера с реальными API-ключами существующего аккаунта.

### Конфиг

- `BYBIT_API_KEY`
- `BYBIT_API_SECRET` или `BYBIT_API_PRIVATE_KEY_PATH`
- `BYBIT_TESTNET=false|true`

### Linux-практика

- ключи не хранить в репозитории
- задавать через systemd environment file
- права на env file: `600`
- сервисный пользователь без shell-доступа по возможности

### Рекомендуемое расширение

Хотя не входит в минимальный обязательный объем, желательно сразу предусмотреть:

- write policy env
- allowlist групп для production
- bearer token для HTTP-доступа

Это особенно важно, если MCP публикуется наружу через Funnel.

## 5.7 Workstream G: Linux deployment + Tailscale Funnel

### Цель

Довести проект до воспроизводимого запуска на Linux.

### Что нужно подготовить

1. Linux systemd unit
2. environment file
3. каталог логов
4. команды запуска Tailscale Funnel
5. операционный README

### Предлагаемая структура

- binary / node app запускается как systemd service
- HTTP MCP слушает `127.0.0.1:8080`
- Funnel публикует `https://<node>.<tailnet>.ts.net/mcp`

### Пример операционного сценария

1. Установить Node.js 20+
2. Собрать проект
3. Создать `bybit-mcp.service`
4. Положить env в `/etc/bybit-mcp/bybit-mcp.env`
5. Запустить сервис
6. Проверить локально `curl http://127.0.0.1:8080/mcp`
7. Включить Funnel на этот backend

Пример команды Funnel:

```bash
tailscale funnel --bg --https=443 http://127.0.0.1:8080
```

Если endpoint должен жить не в корне, использовать path routing или роутинг на стороне HTTP-сервера.

### Артефакты

- `deploy/systemd/bybit-mcp.service`
- `deploy/examples/bybit-mcp.env.example`
- `docs/linux-deployment.md`
- `docs/tailscale-funnel.md`

## 5.8 Workstream H: Smoke tests без mock на существующем аккаунте

### Цель

Сделать минимальный, но реальный тестовый контур против существующего аккаунта и живого MCP сервера.

### Ограничения

- без mock
- тесты должны быть неразрушительными
- тесты не должны требовать реальных торговых операций по умолчанию

### Минимальный набор smoke tests

#### 1. Transport smoke

- сервер поднимается в HTTP режиме
- endpoint `/mcp` отвечает
- initialize проходит успешно

#### 2. Tool discovery smoke

- `tools/list` возвращает список
- проверяется, что видны только разрешенные tool groups
- проверяется, что скрытые группы отсутствуют

#### 3. Authenticated read smoke

Примеры безопасных read-only вызовов:

- `getWalletBalance`
- `getAccountInfo`
- `queryAPIKey`
- `getOpenOrders`

#### 4. Public market smoke

- `getServerTime`
- `getTickers`
- `getOrderbook`

#### 5. Prompt discovery smoke

- `prompts/list` работает
- видны только разрешенные prompt groups

#### 6. Metadata smoke

- при `BYBIT_MCP_METADATA_MODE=none` metadata отсутствует
- при `basic` metadata присутствует в ожидаемом минимальном объеме

#### 7. Logging smoke

- вызов `getTickers` создает запись в log file
- ошибочный вызов тоже создает запись

### Отдельный режим для write smoke

Не включать в default smoke.

Если нужен write smoke, его делать опциональным и только под отдельным флагом, например:

- `RUN_WRITE_SMOKE=true`

И использовать только безопасные/обратимые сценарии либо testnet.

## 5.9 Workstream I: Интеграционный тест с LLM

### Цель

Поднять реальный MCP server, подключить реальный LLM-клиент и проверить видимость tools через prompt.

### Почему это отдельный тест

Проверка через обычный MCP client или inspector не доказывает, что реальный LLM:

- увидел tools
- корректно импортировал metadata
- выбрал правильный tool по prompt

### Рекомендуемый вариант реализации

Использовать OpenAI Responses API с remote MCP server.

Что тестировать:

1. модель подключается к удаленному MCP серверу по `server_url`
2. сервер успешно отдает `tools/list`
3. в ответе клиента фиксируется, что tools импортированы
4. prompt вроде:

```text
List the available market-related tools from the connected Bybit MCP server and name at least three of them.
```

5. модель отвечает названиями tools из разрешенной группы `market`
6. если `trade` отключен, модель не должна ссылаться на `createOrder` как на доступный tool

### Минимальные сценарии

#### Scenario A: all groups

- подключить сервер со всеми группами
- спросить у модели про market и account tools
- убедиться, что она видит оба набора

#### Scenario B: filtered groups

- включить только `market,account`
- спросить про order execution tools
- убедиться, что модель не видит `createOrder` / `wsCreateOrder`

#### Scenario C: prompts visible

- включить prompts
- попросить модель перечислить доступные prompts или использовать один из них

### Артефакт

Отдельный интеграционный скрипт, например:

- `tests/integration/llm_remote_mcp_visibility.test.ts`

или standalone script:

- `scripts/test-llm-remote-mcp.ts`

### Дополнительный артефакт

Сохранение transcript в текстовый файл:

- `artifacts/llm-integration/<timestamp>.md`

## 6. План по изменениям в кодовой базе

## 6.1 Новые модули

Рекомендуемые новые файлы:

- `src/app/create-server.ts`
- `src/app/tool-registry.ts`
- `src/app/tool-groups.ts`
- `src/app/tool-filter.ts`
- `src/app/tool-metadata.ts`
- `src/app/prompt-registry.ts`
- `src/app/prompt-filter.ts`
- `src/app/config.ts`
- `src/app/logger.ts`
- `src/http-server.ts`

## 6.2 Изменения существующих файлов

### `src/server.ts`

Сейчас это монолит запуска stdio MCP.

Нужно:

- превратить в reusable factory
- отделить регистрацию capabilities
- добавить prompts capability
- убрать transport-specific детали

### `src/index.ts`

Нужно:

- добавить выбор транспорта по env
- оставить integrity/startup bootstrap

### `src/tools/index.ts`

Нужно:

- либо обогатить group metadata
- либо использовать как источник, а группировку строить в новом registry-слое

### `src/client/*`

Вероятно потребуются минимальные правки только для shutdown и возможного логирования, но не для самой бизнес-логики Bybit.

## 7. План по тестовой инфраструктуре

### 7.1 Unit tests

Минимально покрыть:

- config parsing
- group filtering
- metadata projection
- prompt filtering
- logger redaction / formatting

### 7.2 Integration tests

Минимально покрыть:

- MCP initialize
- tools/list
- prompts/list
- filtered groups
- metadata modes
- log file creation

### 7.3 Smoke tests

Выделить отдельный профиль:

- `test:smoke:real`

Он должен:

- требовать наличие реальных env vars
- работать только по явному запуску
- не запускаться по умолчанию в CI без секретов

## 8. Этапы реализации

## Этап 1. Рефакторинг MCP ядра

Цель:

- отделить создание сервера от запуска транспорта

Результат:

- reusable MCP app core
- основа под HTTP transport

## Этап 2. Streamable HTTP transport

Цель:

- сервер работает как remote MCP endpoint

Результат:

- Linux service-ready HTTP MCP server

## Этап 3. Tool groups

Цель:

- default all
- фильтрация по группам и отдельным tool names

Результат:

- `tools/list` публикует только разрешенные tools

## Этап 4. MCP metadata

Цель:

- configurable metadata modes

Результат:

- `none/basic/full`

## Этап 5. MCP prompts

Цель:

- capability prompts
- prompt groups

Результат:

- `prompts/list` и `prompts/get`

## Этап 6. File logging

Цель:

- trace всех вызовов tools

Результат:

- audit-friendly text file

## Этап 7. Linux deployment

Цель:

- service + env + logs + Funnel

Результат:

- reproducible production-like startup

## Этап 8. Smoke + LLM integration tests

Цель:

- доказать реальную работоспособность end-to-end

Результат:

- живые тесты без mock

## 9. Критерии приемки

Работа считается завершенной, если выполнены все условия:

1. Сервер запускается на Linux в режиме `MCP_TRANSPORT=http`.
2. Сервер корректно отвечает по Streamable HTTP endpoint.
3. Сервер публикуется наружу через Tailscale Funnel.
4. Bybit API keys подаются через env и сервер успешно выполняет auth read operations.
5. По умолчанию доступны все tool groups.
6. При конфиге allow/deny публикуются только нужные группы tools.
7. MCP metadata можно отключить или ограничить режимами `none/basic/full`.
8. MCP prompts реализованы и также фильтруются по группам.
9. Каждый вызов tool попадает в текстовый лог-файл.
10. Есть smoke test набор без mock на реальном аккаунте.
11. Есть отдельный интеграционный тест с реальным LLM, который подтверждает видимость tools через prompt.
12. Документация по Linux deployment и Tailscale Funnel находится в репозитории.

## 10. Риски и ограничения

### 10.1 Публичная публикация MCP с доступом к реальному Bybit аккаунту

Это главный риск проекта.

Минимальные защитные меры, которые нужно заложить в план реализации:

- binding только на localhost
- публикация только через Funnel
- проверка Origin
- bearer token или иной auth для remote MCP
- логирование вызовов
- возможность отключать risky groups

### 10.2 Prompts support в клиентах неоднородна

Не все MCP-клиенты одинаково хорошо показывают prompts в UI. Поэтому prompts нужно реализовать по spec, но интеграционный e2e тест лучше строить на клиенте, который документированно это поддерживает или хотя бы не ломается при наличии prompts capability.

### 10.3 Smoke tests на реальном аккаунте

Они не должны выполнять разрушительных действий по умолчанию. Основной профиль smoke должен быть read-only.

## 11. Рекомендуемый порядок выполнения

1. Рефакторинг server core
2. HTTP transport
3. Linux local run
4. Tool groups
5. Metadata modes
6. Prompts
7. File logging
8. Smoke tests
9. Tailscale Funnel deployment docs
10. LLM integration test

## 12. Итоговый набор артефактов

К завершению работ в репозитории должны появиться:

- HTTP MCP transport
- конфиг tool groups
- конфиг metadata modes
- prompts support
- file logger
- Linux systemd deployment files
- Funnel setup docs
- smoke test suite
- LLM remote MCP integration test
- обновленный README с remote deployment сценарием

## 13. Рекомендуемые примеры env-конфига

```env
MCP_TRANSPORT=http
MCP_HOST=127.0.0.1
MCP_PORT=8080
MCP_PATH=/mcp

BYBIT_API_KEY=...
BYBIT_API_SECRET=...
BYBIT_TESTNET=false

BYBIT_ENABLED_TOOL_GROUPS=market,account,position
BYBIT_DISABLED_TOOL_GROUPS=
BYBIT_ENABLED_TOOLS=
BYBIT_DISABLED_TOOLS=

BYBIT_MCP_METADATA_MODE=basic

BYBIT_PROMPTS_MODE=basic
BYBIT_ENABLED_PROMPT_GROUPS=general,market,account
BYBIT_DISABLED_PROMPT_GROUPS=

MCP_TOOL_LOG_ENABLED=true
MCP_TOOL_LOG_PATH=/var/log/bybit-mcp/tool-calls.log
MCP_TOOL_LOG_FORMAT=jsonl

MCP_ALLOWED_ORIGINS=https://chat.openai.com,https://platform.openai.com
MCP_BEARER_TOKEN=replace_me
```

## 14. Резюме

Главная доработка здесь не в Bybit API, а в превращении локального `stdio` MCP сервера в управляемый remote MCP сервис:

- с `Streamable HTTP`
- с deployment под Linux
- с публикацией через Tailscale Funnel
- с группировкой tools
- с управляемой публикацией metadata и prompts
- с file-based audit logging
- с живыми smoke и LLM e2e тестами

Именно такой порядок работ даст рабочий результат, а не только частичный набор фич.
