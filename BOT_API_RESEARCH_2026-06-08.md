# Bybit и MEXC: API для grid-ботов и других торговых ботов

Дата проверки: 2026-06-08

## Короткий вывод

Bybit: API-возможности для встроенных ботов и стратегий есть. В текущем MCP уже реализованы spot grid, futures grid, futures martingale, futures combo, DCA и execution strategies TWAP/Iceberg/Chase. Официальная документация Bybit подтверждает существование этих endpoint-ов в таблице rate limits.

MEXC: у MEXC есть пользовательский Futures Grid Bot в веб-интерфейсе, но в публичных официальных Spot V3 и Contract V1 API-доках я не нашел endpoint-ов для создания/управления встроенными grid-ботами. Через API доступны обычные spot/futures ордера, trigger/plan orders и TP/SL, поэтому grid/DCA можно строить как собственную стратегию на стороне нашего сервера, но не как native MEXC bot.

## Источники

- Bybit V5 rate-limit table: https://bybit-exchange.github.io/docs/v5/rate-limit
- Bybit V5 changelog: https://bybit-exchange.github.io/docs/changelog/v5
- MEXC Spot V3 API docs: https://mexcdevelop.github.io/apidocs/spot_v3_en/
- MEXC Contract V1 API docs: https://mexcdevelop.github.io/apidocs/contract_v1_en/
- MEXC API overview: https://www.mexc.com/en-GB/mexc-api
- MEXC Futures Grid product page: https://www.mexc.com/futures/trading-bots/grid?lang=en-US

## Bybit

### Что есть в официальном API

В Bybit V5 rate-limit table перечислены отдельные bot/strategy endpoint-ы:

- Futures Combo Bot:
  - `POST /v5/fcombobot/getlimit`
  - `POST /v5/fcombobot/create`
  - `POST /v5/fcombobot/close`
  - `POST /v5/fcombobot/detail`
- Futures Grid Bot:
  - `POST /v5/fgridbot/validate`
  - `POST /v5/fgridbot/create`
  - `POST /v5/fgridbot/close`
  - `POST /v5/fgridbot/detail`
- Futures Martingale Bot:
  - `POST /v5/fmartingalebot/getlimit`
  - `POST /v5/fmartingalebot/create`
  - `POST /v5/fmartingalebot/close`
  - `POST /v5/fmartingalebot/detail`
- Spot Grid Bot:
  - `POST /v5/grid/validate-input`
  - `POST /v5/grid/create-grid`
  - `POST /v5/grid/close-grid`
  - `POST /v5/grid/query-grid-detail`
- DCA Bot:
  - `POST /v5/dca/create-bot`
  - `POST /v5/dca/close-bot`
- Strategy API:
  - `POST /v5/strategy/create`
  - `GET /v5/strategy/list`
  - `GET /v5/strategy/order-list`
  - `POST /v5/strategy/stop`

Bybit changelog также говорит, что Strategy open APIs были добавлены 2026-04-27, а 2026-05-26 Strategy получила новый тип `pov`.

### Что уже реализовано в этом репозитории

Файлы:

- `src/tools/bot/*`
- `src/tools/strategy/*`
- inventory: `codegen/tool-inventory.json`

Реализованные MCP tools:

| Тип | Tools | Endpoint-ы |
| --- | --- | --- |
| Spot Grid | `validateGridInput`, `createGridBot`, `closeGridBot`, `queryGridDetail` | `/v5/grid/*` |
| Spot DCA | `createDCABot`, `closeDCABot` | `/v5/dca/*` |
| Futures Grid | `validateFGridInput`, `createFGridBot`, `closeFGridBot`, `getFGridDetail` | `/v5/fgridbot/*` |
| Futures Martingale | `getFMartLimit`, `createFMartBot`, `closeFMartBot`, `getFMartDetail` | `/v5/fmartingalebot/*` |
| Futures Combo | `getComboLimit`, `createComboBot`, `closeComboBot`, `getComboDetail` | `/v5/fcombobot/*` |
| Execution Strategy | `createTwapStrategy`, `createIcebergStrategy`, `createChaseOrderStrategy`, `queryStrategyList`, `queryStrategyOrderList`, `stopStrategy` | `/v5/strategy/*` |

Пробел: локальная схема Strategy пока покрывает `twap`, `iceberg`, `chaseOrder`, но не покрывает новый `pov`, который появился в changelog 2026-05-26.

### Практические возможности использования Bybit

1. Spot grid для range-bound рынка
   - Агент анализирует волатильность, диапазон, объемы и spread.
   - Сначала вызывает `validateGridInput`.
   - После явного подтверждения пользователя вызывает `createGridBot`.
   - Мониторинг через `queryGridDetail`.
   - Закрытие через `closeGridBot` с выбранным close mode.

2. Futures grid
   - Для линейных futures/perps с leverage.
   - Сначала `validateFGridInput`, затем `createFGridBot`.
   - Обязательно добавить риск-чек: max leverage, liquidation distance, expected grid exposure, stop-loss.

3. Futures martingale
   - Использовать только после строгой проверки лимитов через `getFMartLimit`.
   - Высокий риск усреднения против тренда; нужен hard stop по drawdown/equity.

4. Futures combo
   - Подходит для корзин/ребалансировки нескольких futures-позиций.
   - Может использоваться для sector/relative-value идей, например long сильный актив + short слабый актив внутри одной темы.

5. DCA
   - Регулярная покупка набора spot assets.
   - Полезно для долгосрочного накопления, но надо учитывать комиссии, min order и концентрацию в одном активе.

6. TWAP / Iceberg / Chase
   - Это не "боты" в стиле grid, но это execution algos.
   - TWAP: крупная заявка равномерно во времени.
   - Iceberg: скрытие размера.
   - Chase: агрессивное исполнение с лимитом max chase price.
   - Нужно добавить поддержку `pov`, если хотим соответствовать текущему Bybit Strategy API.

## MEXC

### Что есть в продукте MEXC

Официальная страница MEXC Futures Grid Bot описывает нативный grid bot:

- работает 24/7;
- минимальный старт от 10 USDT;
- варианты Long Grid, Short Grid, Neutral Grid;
- параметры включают direction, price range, grid quantity, investment amount, leverage;
- торговые комиссии применяются как futures fees, дополнительных bot fees нет.

Это подтверждает наличие продукта в интерфейсе MEXC, но не подтверждает наличие публичного API для управления этим продуктом.

### Что есть в официальном API MEXC

MEXC Spot V3 docs в оглавлении показывают обычные блоки:

- Market Data
- Sub-Account
- Spot Account/Trade
- Wallet
- WebSocket Market Streams
- WebSocket User Data Streams
- Rebate

В этих разделах нет grid/bot/strategy endpoint-ов.

MEXC Contract V1 docs показывают:

- Market endpoints
- Account and trading endpoints
- WebSocket API

В contract docs также нет grid/bot/strategy endpoint-ов. Более того, в contract docs часть order endpoint-ов исторически помечена как "Under maintenance", хотя MEXC объявила запуск Futures API trading с 2026-03-31. Для текущей интеграции надо проверять доступность конкретных endpoints live smoke-тестами.

MEXC API overview говорит, что API trading service поддерживается для Spot и Futures пар, а futures trading доступен пользователям с KYC и futures API permissions. Также там явно указано, что sandbox/test environment отсутствует.

### Что уже реализовано в этом репозитории для MEXC

Файлы:

- `src/exchanges/mexc/tools/trade/*`
- `src/exchanges/mexc/tools/futuresTrade/index.ts`
- `src/exchanges/mexc/tools/market/*`
- `src/exchanges/mexc/tools/futuresMarket/*`

Реализовано:

- spot order create/cancel/cancel-all/query;
- futures order create/cancel/cancel-all;
- futures trigger/plan orders;
- futures TP/SL update/cancel;
- market/account/history endpoints.

Не реализовано и, судя по публичным официальным docs, не предоставляется как native API:

- создать MEXC Futures Grid Bot;
- создать MEXC Spot Grid Bot;
- создать MEXC Infinity Grid;
- создать Smart Rebalance;
- query/close native MEXC bot через public API.

### Практические возможности использования MEXC

1. Собственный grid executor поверх MEXC spot/futures API
   - Держим состояние grid-уровней у себя.
   - Выставляем лимитные заявки через `createOrder` / `createFuturesOrder`.
   - После fill ставим обратную заявку на соседнем grid level.
   - Все заявки маркировать client/external id, чтобы можно было восстановить состояние после рестарта.

2. Собственный futures grid с TP/SL
   - Использовать futures order API и trigger/stop endpoints.
   - Добавить invariant: максимальный notional, максимальная просадка, liquidation buffer, emergency cancel-all.

3. DCA на spot
   - Периодический executor, который вызывает spot `createOrder`.
   - Подходит лучше, чем grid, потому что состояние проще и меньше риск рассинхронизации.

4. TWAP/VWAP executor
   - Разбивать заявку по времени и рынку.
   - Использовать market data и лимитные/рыночные ордера.
   - Это не native MEXC strategy, но реализуемо надежнее, чем grid.

5. Monitoring-only integration с native MEXC bot
   - Если пользователь запускает native bot вручную в UI, через публичный API, вероятно, нельзя получить его bot-specific state.
   - Можно косвенно мониторить account/orders/trades, но связь сделок с конкретным bot может быть неполной.

## Рекомендации по развитию MCP

### Bybit

1. Добавить отдельный "bot safety guide" tool
   - объясняет, какие параметры обязательны;
   - запрещает создание bot без явного подтверждения пользователя;
   - показывает worst-case exposure и условия закрытия.

2. Добавить поддержку Bybit Strategy `pov`
   - Bybit changelog от 2026-05-26 говорит, что Strategy поддерживает новый тип `pov`;
   - локально сейчас есть только `twap`, `iceberg`, `chaseOrder`.

3. Добавить read-only bot review snapshot
   - список активных bot/strategy;
   - PnL, exposure, open orders, grid bounds;
   - предупреждение, если цена близко к границе grid или liquidation risk.

4. Добавить write smoke для bot endpoints без создания реального bot
   - только validate/getlimit endpoints;
   - `validateGridInput`, `validateFGridInput`, `getFMartLimit`, `getComboLimit`.

### MEXC

1. Не пытаться дергать undocumented web endpoints MEXC native bots
   - риск поломки, блокировок, нарушения ToS и нестабильного auth.

2. Реализовать собственный bot runtime в нашем проекте
   - локальное состояние в SQLite/JSONL;
   - idempotent reconciliation loop;
   - recovery после рестарта через open orders + fills;
   - dry-run/backtest mode;
   - строгий per-symbol risk config.

3. Начать с DCA/TWAP, затем grid
   - DCA и TWAP проще и безопаснее;
   - grid требует аккуратного state machine, fill handling и risk stop.

4. Для futures MEXC держать отдельный guarded mode
   - MEXC не имеет sandbox;
   - futures endpoints и permissions менялись;
   - нужен отдельный small-notional smoke и агрессивный cleanup.

## Итоговая матрица

| Биржа | Native grid/bot API | Реализовано в MCP | Практический путь |
| --- | --- | --- | --- |
| Bybit | Да: `/v5/grid`, `/v5/fgridbot`, `/v5/fmartingalebot`, `/v5/fcombobot`, `/v5/dca`, `/v5/strategy` | Да, кроме нового Strategy `pov` | Использовать native bots через MCP с safety checks |
| MEXC | В публичных API docs не найдено; продукт в UI есть | Нет native bot tools; есть spot/futures trading primitives | Делать собственный bot runtime поверх order API |

