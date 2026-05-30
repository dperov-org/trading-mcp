# План рефакторинга под multi-exchange и план реализации MEXC MCP

Дата: 2026-05-30

## Цель

На базе текущего `trading-mcp` сделать не просто второй форк под другую биржу, а выделить exchange-agnostic ядро и подключить `MEXC` как новый backend с собственными REST, WebSocket, auth и codegen-слоями.

Практический вывод: это реалистично, но лучший путь не "скопировать Bybit и переименовать", а поэтапно разнести проект на:

1. общее MCP-ядро;
2. общий runtime для tool definitions;
3. exchange-specific adapters;
4. exchange-specific generated tools;
5. exchange-specific smoke/verification.

---

## На что опирается план

### Текущая архитектура репозитория

Сейчас в проекте уже есть естественное разделение на маленькое ручное ядро и большой generated layer:

- MCP server: `src/server.ts`
- REST client: `src/client/rest-client.ts`
- WebSocket snapshot/trade client: `src/client/ws-client.ts`
- persistent subscriptions: `src/client/subscription-manager.ts`
- auth/signature helpers: `src/utils/auth.ts`
- generated tools registry: `src/tools/index.ts`
- публичный inventory-first codegen: `scripts/generate-tools.mjs`
- OpenAI function-tools codegen поверх inventory: `apps/openai-function-tools-adapter/scripts/generate-openai-tools.mjs`

Это уже хорошая база для выделения exchange-independent framework.

### Актуальные ограничения и свойства MEXC API

Ниже указаны свойства, которые влияют на проектное решение:

- MEXC Spot V3 использует базовый REST endpoint `https://api.mexc.com` и HMAC-подпись с заголовком `X-MEXC-APIKEY`; signed endpoints требуют `timestamp`, optional `recvWindow`, а signature передаётся в query/body.
- MEXC Futures тоже использует `https://api.mexc.com`, но auth-модель другая: заголовки `ApiKey`, `Request-Time`, `Signature`, optional `Recv-Window`; строка для подписи строится как `accessKey + timestamp + parameterString`.
- Для Spot WebSocket базовый endpoint сейчас `wss://wbs-api.mexc.com/ws`; одно соединение живёт не более 24 часов; без подписки сервер может отключить соединение, клиент может слать `ping`.
- Для Spot private WS используется `listenKey`.
- Для Futures docs в update log фиксируют отдельный WS endpoint `wss://contract.mexc.com/edge`.
- MEXC прямо пишет, что sandbox/test environment сейчас не предоставляет.

Официальные источники:

- Spot general info: https://www.mexc.com/api-docs/spot-v3/general-info
- Spot websocket market streams: https://www.mexc.com/api-docs/spot-v3/websocket-market-streams/
- Spot websocket user data streams: https://www.mexc.com/api-docs/spot-v3/websocket-user-data-streams/
- Futures integration guide: https://www.mexc.com/api-docs/futures/integration-guide
- Futures update log: https://www.mexc.com/api-docs/futures/update-log
- MEXC API overview / no sandbox note: https://www.mexc.com/en-GB/mexc-api

---

## Рекомендуемая целевая архитектура

### 1. Вынести exchange-agnostic ядро

Новая структура:

```text
src/
  core/
    mcp/
    tool-runtime/
    codegen-runtime/
    schemas/
    errors/
  exchanges/
    bybit/
      config/
      auth/
      rest/
      ws/
      subscriptions/
      tools/
      codegen/
    mexc/
      config/
      auth/
      rest/
      ws/
      subscriptions/
      tools/
      codegen/
```

Что должно жить в `core`:

- generic `ToolDefinition` type;
- generic `startMcpServer()` и registration/runtime helpers;
- JSON serialization/error mapping для MCP;
- общие helpers для `zod`/JSON Schema;
- codegen contracts;
- smoke/verify primitives.

Что должно жить в `exchanges/*`:

- env/config contract;
- auth/signing;
- REST transport;
- WS transport;
- subscription lifecycle;
- generated tools;
- exchange-specific smoke scenarios.

### 2. Убрать прямую привязку MCP server к Bybit

Сейчас `src/server.ts` знает о текущем generated registry и косвенно о Bybit auth mode.

Нужно перейти к схеме:

```ts
startMcpServer({
  serverName,
  serverVersion,
  tools,
  authSummary,
  beforeToolCall,
})
```

Тогда `Bybit` и `MEXC` смогут запускаться через один и тот же MCP runtime.

### 3. Убрать прямую привязку generated layer к `src/tools/**`

Сейчас tools лежат в одном общем дереве. Для multi-exchange это быстро приведёт к конфликтам имён и путанице.

Рекомендуемая модель:

```text
src/exchanges/bybit/tools/**
src/exchanges/mexc/tools/**
```

А runtime-агрегация должна происходить через exchange-specific `index.ts`.

### 4. Формализовать exchange adapter interface

Нужен внутренний контракт вроде:

```ts
interface ExchangeRuntime {
  id: 'bybit' | 'mexc';
  displayName: string;
  authSummary(): string;
  rest: ExchangeRestClient;
  ws?: ExchangeWsClient;
  subscriptions?: ExchangeSubscriptionManager;
  tools: ToolDefinition[];
}
```

Это позволит:

- запускать отдельный MCP на одну биржу;
- в будущем сделать multi-exchange launcher;
- переиспользовать OpenAI function adapter почти без изменений.

---

## План рефакторинга текущего репозитория

### Этап 0. Зафиксировать текущее состояние

Цель:

- не сломать рабочий Bybit runtime во время выделения ядра.

Работы:

- добавить snapshot архитектуры в документ;
- зафиксировать минимальный regression set:
  - `npm run generate`
  - `npm run typecheck`
  - `npm run build`
  - `npm run smoke:bybit`
  - `npm run codex:mcp:smoke`

Критерий завершения:

- все текущие проверки зелёные до начала рефакторинга.

### Этап 1. Выделить generic tool contract

Цель:

- перестать считать текущую форму tool-объекта "Bybit-специфичной".

Работы:

- вынести общий тип `ToolDefinition` в `src/core/tool-runtime/types.ts`;
- вынести helper для `inputSchema.parse`, execution и error formatting;
- перенести логику `ListTools` / `CallTool` из `src/server.ts` в `src/core/mcp/server.ts`.

Критерий завершения:

- Bybit MCP стартует через generic server runtime без изменения внешнего поведения.

### Этап 2. Выделить exchange-specific launchers

Цель:

- отделить общий MCP runtime от конкретной биржи.

Работы:

- создать `src/exchanges/bybit/runtime.ts`;
- перенести туда `allTools`, auth summary и все Bybit-specific зависимости;
- оставить thin entrypoint:
  - `src/index.ts` -> запускает `BybitRuntime`.

Критерий завершения:

- Bybit MCP продолжает работать, а `src/server.ts` больше не содержит прямых ссылок на Bybit env vars или auth helpers.

### Этап 3. Разнести clients/auth/subscriptions по exchange namespace

Цель:

- подготовить место для второго exchange backend.

Работы:

- переместить:
  - `src/client/rest-client.ts` -> `src/exchanges/bybit/rest/client.ts`
  - `src/client/ws-client.ts` -> `src/exchanges/bybit/ws/client.ts`
  - `src/client/subscription-manager.ts` -> `src/exchanges/bybit/ws/subscription-manager.ts`
  - `src/utils/auth.ts` -> `src/exchanges/bybit/auth/signing.ts`
- оставить совместимые re-export shims на переходный период.

Критерий завершения:

- импорты в generated tools смотрят в Bybit namespace, а не в global `src/client` / `src/utils`.

### Этап 4. Переделать codegen на exchange-aware inventory

Цель:

- сделать codegen пригодным для нескольких бирж.

Работы:

- перейти от одного `codegen/tool-inventory.json` к схеме вида:

```text
codegen/
  bybit/
    tool-inventory.json
  mexc/
    tool-inventory.json
```

- расширить inventory metadata:
  - `exchange`
  - `group`
  - `transport`
  - `authRequired`
  - `sourceKind` (`rest` | `ws-snapshot` | `ws-stream` | `ws-trade`)
- сделать генератор параметризуемым:
  - `node scripts/generate-tools.mjs bybit`
  - `node scripts/generate-tools.mjs mexc`

Критерий завершения:

- один и тот же codegen runtime умеет генерировать tool layer для разных exchanges.

### Этап 5. Переделать OpenAI function-tools adapter на exchange-aware registry

Цель:

- чтобы `OpenAI` adapter не был завязан на один exchange.

Работы:

- добавить exchange dimension в generated OpenAI registry;
- поддержать выбор:
  - только `bybit`
  - только `mexc`
  - multi-exchange group allowlist

Критерий завершения:

- adapter-проект может генерировать function tools как минимум для одного выбранного exchange runtime.

---

## План реализации MEXC MCP слоя

### Принцип

`MEXC` нужно делать не как "копию Bybit-дерева", а как второй exchange package поверх нового core.

Рекомендуемая последовательность:

1. сначала `Spot REST`;
2. потом `Spot private REST`;
3. потом `Spot WebSocket`;
4. потом `Futures REST`;
5. потом `Futures WebSocket`;
6. потом generated expansion.

### Этап M1. MEXC config contract

Нужен отдельный env contract:

```text
MEXC_API_KEY
MEXC_API_SECRET
MEXC_RECV_WINDOW
MEXC_ENABLE_SPOT
MEXC_ENABLE_FUTURES
```

Если будут отдельные ключи/permissions для spot и futures, лучше сразу заложить возможность:

```text
MEXC_SPOT_API_KEY
MEXC_SPOT_API_SECRET
MEXC_FUTURES_API_KEY
MEXC_FUTURES_API_SECRET
```

Даже если сначала они мапятся на общий ключ, это убережёт от будущего breaking refactor.

### Этап M2. MEXC auth layer

Это один из самых важных слоёв, потому что MEXC spot и futures подписываются по-разному.

#### Spot auth

Нужно реализовать helper для Spot V3:

- header `X-MEXC-APIKEY`
- `timestamp`
- optional `recvWindow`
- `signature` уходит в query/body
- строка для подписи строится из `totalParams`

#### Futures auth

Нужно отдельное helper API:

- headers:
  - `ApiKey`
  - `Request-Time`
  - `Signature`
  - optional `Recv-Window`
- string-to-sign:
  - `accessKey + timestamp + parameterString`
- GET/DELETE:
  - параметры сортируются
- POST:
  - sign по JSON string

Вывод:

- у `MEXC` нужен не один `auth.ts`, а минимум два signer-модуля:
  - `spot-signing.ts`
  - `futures-signing.ts`

### Этап M3. MEXC REST clients

Нужны два клиента:

```text
src/exchanges/mexc/rest/spot-client.ts
src/exchanges/mexc/rest/futures-client.ts
```

Причина:

- различаются auth contract;
- различается response envelope;
- различаются naming conventions;
- различаются error models.

#### Spot client responsibilities

- public `GET` market endpoints;
- signed account/trade/wallet endpoints;
- response normalization;
- error mapping;
- request timeout;
- IP/weight-aware rate limiting.

#### Futures client responsibilities

- public market endpoints;
- private account/trading endpoints;
- futures-specific error normalization;
- separate rate-limit buckets.

### Этап M4. Response normalization

Это место, где MEXC будет отличаться от Bybit особенно сильно.

Нужен слой нормализации:

```ts
normalizeSpotResponse(...)
normalizeFuturesResponse(...)
normalizeMexcError(...)
```

Причина:

- Bybit часто отдаёт `retCode` / `retMsg`;
- MEXC spot и futures используют другую envelope-модель;
- futures docs показывают `success`, `code`, `data`, `message`.

Лучше не тащить MEXC raw envelopes напрямую в generic runtime. MCP tool должен возвращать либо:

- raw exchange payload в явном поле `raw`;
- либо нормализованный payload с минимальным wrapper drift.

Рекомендация:

- на первом этапе возвращать exchange-native payload почти без изменений, но unify error handling.

### Этап M5. MEXC WebSocket layer

Нужны отдельные WS клиенты:

```text
src/exchanges/mexc/ws/spot-client.ts
src/exchanges/mexc/ws/futures-client.ts
```

#### Spot WS

Поддержать:

- market subscriptions;
- reconnect;
- ping/keepalive;
- 24h forced reconnect;
- orderbook snapshot/update maintenance;
- private user data streams через `listenKey`.

#### Futures WS

Поддержать:

- public market topics;
- private topics;
- reconnect;
- ping/keepalive;
- incremental depth semantics.

Важно:

- private spot WS у MEXC концептуально ближе к Binance-style `listenKey`, а не к текущей Bybit auth-on-socket модели;
- значит текущий `ws-client.ts` нельзя просто переиспользовать без abstraction.

### Этап M6. Subscription manager abstraction

Сейчас `SubscriptionManager` заточен под Bybit topics и auth flow.

Нужно выделить generic interface:

```ts
interface ExchangeSubscriptionAdapter {
  connect(topic, options): Promise<ConnectionHandle>;
  reconnect(handle): Promise<void>;
  ping(handle): Promise<void>;
  close(handle): Promise<void>;
}
```

Тогда:

- `BybitSubscriptionAdapter`
- `MexcSpotSubscriptionAdapter`
- `MexcFuturesSubscriptionAdapter`

смогут жить под одним lifecycle manager.

### Этап M7. MEXC tool taxonomy

Не нужно пытаться в первом релизе повторить весь объём Bybit.

Рекомендуемый MVP для MEXC:

#### Group `market`

- `getServerTime`
- `getExchangeInfo` / symbols info
- `getTickers`
- `getOrderbook`
- `getRecentTrades`
- `getKlines`

#### Group `account`

- `getAccountInfo`
- `getWalletBalance`
- `getOpenOrders`
- `getOrderHistory`
- `queryApiPermissions` или близкий endpoint

#### Group `trade`

- `createOrder`
- `cancelOrder`
- `cancelAllOrders`
- `getOrder`

#### Group `websocket`

- `subscribeTickers`
- `subscribeOrderbook`
- `subscribeTrades`
- `subscribeUserOrders`
- `subscribeBalances`

#### Group `subscription`

- `startSubscription`
- `readMessages`
- `stopSubscription`
- `listSubscriptions`

Это достаточно, чтобы:

- покрыть read-only AI use cases;
- проверить private auth flow;
- проверить MCP lifecycle;
- не увязнуть сразу во всех частях MEXC.

### Этап M8. MEXC codegen strategy

Для MEXC я не рекомендую сразу завязываться на "полный автоматический генератор из docs".

Причина:

- у текущего Bybit public codegen уже inventory-first, а не docs-first;
- у MEXC docs структурированы лучше, чем произвольный HTML, но это всё равно не гарантированный OpenAPI generator input;
- MEXC spot и futures живут в разных doc trees и имеют разные auth/response conventions.

Рекомендуемая стратегия:

#### Шаг 1. Ручной curated inventory

Сделать:

```text
codegen/mexc/tool-inventory.json
```

Где для каждого tool описывается:

- name
- group
- transport
- authRequired
- product (`spot` | `futures`)
- httpMethod
- path
- responseMode
- schema module reference
- handler template kind

#### Шаг 2. Template-based generator

Сгенерировать thin wrappers так же, как сейчас генерируются Bybit tools:

- REST public
- REST auth
- WS snapshot
- WS stream

#### Шаг 3. Optional docs scraper

Позже можно добавить helper, который полуавтоматически собирает inventory из MEXC docs, но он не должен быть source of truth.

Лучше:

- `inventory-first`
- `docs-assisted`

чем наоборот.

### Этап M9. Naming and schema policy

Очень важно заранее зафиксировать naming policy, иначе получится хаос между Bybit-style и MEXC-style names.

Рекомендация:

- имена MCP tools держать exchange-neutral, где это возможно:
  - `getTickers`
  - `getOrderbook`
  - `getOpenOrders`
  - `createOrder`
- exchange-specific различия уносить в schemas и descriptions;
- если semantics сильно различаются, использовать префикс:
  - `getFuturesPositions`
  - `subscribeSpotUserOrders`

Иначе multi-exchange adapter потом будет тяжело объединять.

### Этап M10. Smoke tests

Так как MEXC официально не предоставляет sandbox, smoke strategy должна быть только read-only на старте.

Нужны минимум:

#### REST smoke

- server time
- ticker BTC/USDT
- orderbook BTC/USDT
- account info
- balances
- open orders

#### WS smoke

- public ticker stream
- public orderbook stream
- private user-order stream при наличии ключа

#### LLM smoke

Отдельный app, аналогичный уже сделанным live-check проектам:

- MCP mode
- OpenAI function-tools mode

Примеры вопросов:

- `What is the current BTC/USDT price on MEXC?`
- `What is my MEXC wallet balance?`
- `Do I have any open orders on MEXC?`

### Этап M11. Security policy

Для MEXC нужно сразу повторить и усилить текущие safety barriers:

- по умолчанию запускать только read-only smoke;
- write tools отключать feature-flag'ом;
- логировать auth mode без вывода секретов;
- отдельно маркировать tools как:
  - `read_only`
  - `state_mutating`
- для OpenAI adapter и MCP session launcher поддержать allowlist групп.

---

## Рекомендуемая последовательность реализации

### Фаза A. Подготовка каркаса

1. Выделить `core` и перевести текущий Bybit runtime на него.
2. Разнести Bybit по namespace `src/exchanges/bybit/**`.
3. Сделать exchange-aware codegen.

### Фаза B. MEXC MVP

1. Реализовать MEXC config.
2. Реализовать MEXC spot auth.
3. Реализовать MEXC spot REST public/auth clients.
4. Добавить 8-12 MVP tools.
5. Добавить read-only smoke tests.

### Фаза C. MEXC realtime

1. Реализовать spot WS market streams.
2. Реализовать private listenKey flow.
3. Встроить в generic subscription manager.
4. Добавить subscription tools.

### Фаза D. MEXC futures

1. Реализовать futures auth.
2. Реализовать futures REST client.
3. Реализовать futures WS client.
4. Добавить futures market/account/trade tools.

### Фаза E. Ecosystem integration

1. Подключить MEXC к OpenAI function-tools adapter.
2. Добавить Codex/Cursor/Claude smoke docs.
3. Добавить verify pipeline для `bybit` и `mexc`.

---

## Главные проектные риски

### 1. Spot и futures у MEXC концептуально ближе к двум разным API

Это не blocker, но означает:

- нельзя писать "один mexc client";
- нужно минимум два транспорта и две auth-модели.

### 2. Нет sandbox

Это серьёзно влияет на rollout:

- write-path testing становится рискованным;
- smoke должен быть read-only;
- для trade tools нужен дополнительный safety gate.

### 3. WS semantics отличаются от Bybit

Особенно:

- spot private `listenKey`;
- futures WS endpoint и channel model;
- orderbook maintenance rules.

Поэтому существующий Bybit WS слой нужно abstract, а не копировать.

### 4. Документация MEXC меняется

Futures docs явно обновлялись в 2026 году, в том числе по структуре страниц и endpoint list. Поэтому codegen source of truth должен оставаться локальным inventory, а не живым scraper по docs.

---

## Практический итог

### Короткий ответ

Да, архитектура текущего проекта подходит для MEXC MCP server, но не в виде "просто второго дерева `src/tools`". Нужен промежуточный рефакторинг в multi-exchange framework.

### Что я считаю оптимальным путём

1. Сначала выделить generic core, не ломая Bybit.
2. Потом сделать MEXC Spot MVP.
3. Затем добавить WS.
4. Потом Futures.
5. Только после этого наращивать coverage и автоматизацию codegen.

### Что не рекомендую

- форкнуть текущий проект и дублировать весь Bybit код под `mexc`;
- пытаться сразу покрыть весь MEXC API;
- строить MEXC codegen напрямую из HTML-документации как source of truth;
- начинать с trade/write tools без read-only smoke и allowlist policy.

