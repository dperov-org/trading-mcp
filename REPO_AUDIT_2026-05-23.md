# Аудит репозитория `trading-mcp`

Дата анализа: 2026-05-23

Source:

https://github.com/bybit-exchange/trading-mcp

## Что это за проект

Это MCP-сервер для Bybit, написанный на TypeScript и работающий через stdio-транспорт. Он публикует Bybit V5 REST и WebSocket API как MCP tools, чтобы AI-клиенты вроде Claude Desktop, Cursor и VS Code могли вызывать биржевые операции естественным языком.

По факту проект состоит из двух слоев:

1. Ручной инфраструктурный код:
   - запуск и проверка целостности пакета: `src/index.ts`, `src/version-check.ts`
   - MCP-сервер и маршрутизация вызовов: `src/server.ts`
   - REST/WS клиенты: `src/client/rest-client.ts`, `src/client/ws-client.ts`
   - менеджер долгоживущих подписок: `src/client/subscription-manager.ts`
   - подпись запросов и auth helpers: `src/utils/auth.ts`
   - примитивный rate limiter: `src/utils/rate-limiter.ts`

2. Большой автоматически сгенерированный слой thin-wrapper'ов в `src/tools/**`:
   - Zod-схема входа
   - имя и описание инструмента
   - проброс вызова в `restClient` или `wsClient`

## Функциональность

По структуре репозитория проект покрывает практически весь пользовательский контур Bybit V5:

- market data: тикеры, стаканы, свечи, funding, open interest, risk limit, delivery price
- trading: create/amend/cancel order, batch-операции, pre-check, DCP
- positions: leverage, trading stop, close position, risk limit flows
- account: balances, collateral, fee rate, transaction log, account config
- asset: deposit/withdraw/convert/transfer/history
- user/sub-account/broker/affiliate
- RFQ / spread trading / copy trading / bots / earn / crypto loan / liquidity mining / alpha
- WebSocket snapshot-инструменты
- WebSocket trade-инструменты для order entry
- отдельные persistent subscription tools поверх `SubscriptionManager`

Статически в репозитории найдено:

- 327 tool-модулей в `src/tools/**` без `index.ts`
- 32 верхнеуровневые категории инструментов
- около 7.4k строк TypeScript в `src/**`
- 359 файлов с маркером `auto-generated, do not edit`

Распределение по главным категориям:

- `asset`: 35
- `websocket`: 27
- `account`: 24
- `market`: 22
- `bot`: 18
- `rfq-trading`: 15
- `crypto-loan-fixed-term`: 15
- `spot-margin-trade-uta`: 14
- `p2p`: 13
- `trade`: 12
- `spread-trading`: 12
- `position`: 11

## Архитектура

### 1. Запуск и защита дистрибутива

`src/index.ts` перед стартом вызывает `checkIntegrityAtStartup()`. В `src/version-check.ts` реализована проверка версии и sha256-хешей файлов дистрибутива по удаленному manifest URL. Идея правильная: снижает риск запуска подмененного пакета с API-ключами.

### 2. MCP-слой

`src/server.ts` создает MCP `Server`, регистрирует `ListToolsRequestSchema` и `CallToolRequestSchema`, валидирует вход через Zod и отдает JSON как текстовый payload. Это простая и понятная модель без лишней магии.

### 3. Доступ к Bybit

`src/client/rest-client.ts` реализует GET/POST и auth/non-auth варианты. Подпись строится в `src/utils/auth.ts`, где поддержаны обе модели авторизации:

- HMAC через `BYBIT_API_SECRET`
- RSA через `BYBIT_API_PRIVATE_KEY_PATH`

Окружение читается в момент вызова, а не на import-time. Это хороший выбор для MCP и для тестируемости.

### 4. WebSocket

Есть два режима:

- одноразовый snapshot (`src/client/ws-client.ts`)
- долгоживущая подписка с буфером, повторным подключением и read/stop/list API (`src/client/subscription-manager.ts`)

Для прикладного слоя это удобно: пользователь может либо получить 1-N сообщений и закрыться, либо поднять фоновую подписку.

## Сильные стороны

### Что сделано хорошо

- Четкое разделение ядра и сгенерированных модулей. Ручной код маленький, а шаблонный слой легко масштабируется.
- `strict: true` в `tsconfig.json` снижает часть банальных ошибок типов.
- Использование Zod почти во всех tools улучшает контрактность входных параметров.
- Auth-конфигурация читается на момент вызова, что уменьшает проблемы поздней инициализации.
- Есть попытка operational hardening: timeout'ы, integrity check, reconnect в подписках, ограничения буфера.
- В generated-tools описания часто достаточно подробные и пригодны для AI-routing.

## Замечания и риски

### 1. Дублирование subscription tools при регистрации

Серьезность: высокая

`subscriptionTools` уже входят в `allTools` через `src/tools/index.ts`, но затем повторно добавляются в `src/server.ts`.

Подтверждение:

- `src/tools/index.ts` включает `...subscriptionTools`
- `src/server.ts:11` импортирует `subscriptionTools`
- `src/server.ts:29` делает `allTools = [...allTools, ...subscriptionTools]`

Последствия:

- в `ListTools` пользователю уходят дублирующиеся инструменты
- лог старта показывает завышенное число инструментов
- поведение становится менее предсказуемым для MCP-клиентов, которые ожидают уникальные имена tools

Это явный дефект, а не просто stylistic issue.

### 2. Persistent WebSocket subscriptions не поддерживают heartbeat/ping

Серьезность: высокая для production-использования подписок

В `src/client/subscription-manager.ts` есть reconnect и auth, но нет периодической отправки `ping`. По коду соединение открывается, подписывается и потом просто ждет сообщения:

- открытие и подписка: `src/client/subscription-manager.ts:134-186`
- heartbeat отсутствует полностью

По официальной документации Bybit:

- при отсутствии `ping-pong` соединение может быть разорвано
- рекомендована отправка heartbeat каждые 20 секунд

Источники:

- Bybit WS Connect: https://bybit-exchange.github.io/docs/v5/ws/connect
- секции `How to Send the Heartbeat Packet` и предупреждение про `send the ping heartbeat packet every 20 seconds`

Практический эффект:

- долгоживущие подписки могут отваливаться чаще, чем нужно
- reconnect будет лечить симптом, но не причину
- для сценариев с DCP это особенно чувствительно, потому что heartbeat участвует в логике disconnection protection

### 3. Rate limiter слишком упрощен относительно реальных лимитов Bybit

Серьезность: средняя

`src/utils/rate-limiter.ts` использует локальный token bucket с дефолтом `10 req/s` и тремя ручными override'ами:

- `/v5/market/kline`
- `/v5/market/orderbook`
- `/v5/market/tickers`

Проблемы:

- лимиты Bybit зависят не только от endpoint path, но и от UID, типа endpoint, а фактический остаток приходит в response headers
- код никак не использует `X-Bapi-Limit`, `X-Bapi-Limit-Status`, `X-Bapi-Limit-Reset-Timestamp`
- для сотен endpoint'ов выбран единый дефолт, который может быть как слишком агрессивным, так и слишком консервативным

Источники:

- Bybit Rate Limit Rules: https://bybit-exchange.github.io/docs/v5/rate-limit

Итог: лимитер лучше, чем ничего, но до production-grade backpressure он не дотягивает.

### 4. README и реальная кодовая база расходятся по числу инструментов

Серьезность: средняя

В README есть взаимоисключающие цифры:

- badge: `Tools-190` в `README.md:8`
- текст: `206 tools` в `README.md:11` и `README.md:32`

При этом в кодовой базе найдено 327 tool-модулей, а с учетом повторной регистрации subscription tools сервер фактически может объявлять 331 запись.

Это означает, что документация явно не синхронизирована с текущим сгенерированным набором.

### 5. UX инструментов неоднороден по языку

Серьезность: средняя/низкая

README в основном англоязычный, но часть описаний tools в `subscription` и `websocket` на китайском:

- `src/tools/subscription/startSubscription.ts:8-21`
- `src/tools/subscription/readMessages.ts:6-14`
- `src/tools/websocket/subscribeTickers.ts:8`

Для MCP-клиентов это неприятно, потому что LLM ориентируется на `description` при выборе инструмента. Смешение языков ухудшает discoverability и стабильность tool selection.

### 6. В проекте отсутствуют тесты

Серьезность: средняя

В репозитории не найдено файлов `test`/`spec`, а в `package.json` нет `test` script. Для проекта, который:

- работает с реальными ордерами
- подписывает приватные запросы
- держит persistent WebSocket-соединения

это заметный пробел. Особенно не хватает хотя бы:

- unit-тестов на `buildAuthHeaders`, `toQueryString`
- тестов на выбор auth mode
- тестов на reconnect / buffer semantics `SubscriptionManager`
- smoke-теста регистрации tool names без дублей

### 7. Комментарий о `npm run generate` не подтверждается скриптами репозитория

Серьезность: низкая

В `src/server.ts:13-15` есть комментарий про запуск `npm run generate`, но в `package.json:31-35` такого скрипта нет. Похоже на остаток от внутреннего codegen pipeline, который не доведен до публичной формы.

Это не ломает runtime, но ухудшает сопровождаемость.

### 8. Дублирование конфигурации WS endpoint-ов

Серьезность: низкая

Карты `WS_MAINNET` / `WS_TESTNET` определены отдельно и почти идентично в:

- `src/client/ws-client.ts`
- `src/client/subscription-manager.ts`

Риск невысокий, но это прямой источник drift при будущих изменениях URL/региональных доменов.

## Оценка качества кода

### Общая оценка

Архитектурно: 7.5/10

Эксплуатационная зрелость: 5.5/10

Сопровождаемость ручного ядра: 7/10

Сопровождаемость всего репозитория: 6/10

Итоговая практическая оценка: 6.5/10

### Почему не выше

Главная причина не в стиле кода. Стиль как раз в основном аккуратный. Просадка идет из-за operational gaps:

- нет тестов
- есть явный дефект с дублированием tools
- persistent WS реализован без heartbeat
- документация заметно отстает от реального состояния codegen-слоя

### Почему не ниже

Потому что базовая архитектура здравая:

- ручное ядро небольшое и читаемое
- генерация tools сильно сокращает ручной шум
- Zod и strict TypeScript дают приемлемую контрактность
- auth и transport-слой реализованы достаточно прозрачно

## Что я бы сделал в первую очередь

1. Убрать повторное добавление `subscriptionTools` в `src/server.ts`.
2. Добавить heartbeat для persistent subscriptions с интервалом 20 секунд и обработкой `pong`.
3. Ввести хотя бы минимальный test suite для auth, registration и subscription lifecycle.
4. Синхронизировать README с фактическим количеством инструментов и категориями.
5. Вынести WS URL-конфигурацию в общий модуль.
6. Улучшить rate limiting: хотя бы чтение лимитных headers и telemetry по `retCode=10006`.

## Ограничения анализа

- Я не смог прогнать `npm run typecheck` и `npm run build`, потому что в текущей среде `node`/`npm` отсутствуют в `PATH`, хотя репозиторий ожидает `node >= 20.6` по `package.json:52-54`.
- Анализ был в основном статическим, без запуска сервера и без интеграционных запросов к Bybit.

## Итог

Проект выглядит как полезный и масштабируемый codegen-driven MCP gateway над Bybit V5 API. Для read-heavy и tool-discovery сценариев он уже выглядит рабочим. Для надежного production-использования в торговых и long-lived WebSocket сценариях ему не хватает нескольких важных инженерных доработок, прежде всего: heartbeat, тестов, устранения дубликатов регистрации и синхронизации документации с фактическим состоянием генерации.
