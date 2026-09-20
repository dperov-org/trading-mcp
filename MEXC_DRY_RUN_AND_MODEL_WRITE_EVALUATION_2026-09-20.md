# MEXC dry-run и проверка model-to-MCP write-вызовов

Дата: 2026-09-20
Статус: реализован dry-run runtime, строгая coercion enum-кодов и field descriptions; полный набор из 15 MEXC write-инструментов проверен на шести моделях.

## Цель

Нужен безопасный способ проверять, как реальная модель формирует MEXC write-вызов через настоящий MCP. Проверка должна использовать те же tool names, JSON Schema, Zod-валидацию и transport, что и production, но не должна создавать, отменять или изменять заявки на MEXC.

## Режим dry-run

Режим включается только внешней переменной окружения:

```powershell
$env:MEXC_WRITE_MODE = 'dry-run'
npm run mexc:start
```

Допустимы только значения:

- `live` — значение по умолчанию; write-инструменты работают штатно;
- `dry-run` — write-инструменты не выполняют handler.

Неизвестное значение останавливает старт сервера. Режим не добавляется в description или JSON Schema MCP-инструментов: модель не может включить либо выключить его своим tool call. Startup-лог содержит `write-mode: live` или `write-mode: dry-run` для операционной диагностики.

### Поток выполнения

```text
модель
  -> реальный MEXC MCP (stdio или HTTP)
  -> поиск инструмента и обычная Zod-валидация
  -> [write + dry-run] dry-run receipt
  -> [write + live] handler -> подпись -> HTTP MEXC
```

Инструменты помечаются runtime-метаданными `operation: 'read' | 'write'`; метаданные не публикуются клиенту MCP. В `dry-run` для write-инструмента возвращается:

```json
{
  "ok": true,
  "mode": "dry-run",
  "exchangeRequestSent": false,
  "operation": "createFuturesTriggerOrder",
  "validatedArguments": {}
}
```

Охват MEXC write-набора: Spot create/cancel и Futures create/cancel/update, включая `createFuturesTriggerOrder`. Read-инструменты остаются реальными; например, модель может получить публичные contract metadata и ticker. Это значит, что dry-run не создаёт побочных торговых эффектов, но может делать разрешённые read-only HTTP-запросы.

### Что dry-run подтверждает и чего не подтверждает

Подтверждает:

- что модель выбрала tool и передала JSON в настоящий MCP;
- что JSON проходит опубликованную schema и production Zod-валидацию;
- что write-инструмент распознан как effectful и не запускает handler;
- локальное время MCP-валидации и routing.

Не подтверждает:

- успешность подписи и реального HTTP-запроса к MEXC;
- правила matching engine, ликвидность и состояние счёта;
- реальную latency размещения на бирже.

Поэтому `writeOperationElapsedMs` в model eval — это время локального dry-run вызова, а не exchange order latency.

## Команды проверки

```powershell
# Реальный stdio MCP с валидным trigger payload, без HTTP write к MEXC
npm run smoke:mexc:dry-run

# Шесть моделей: OpenAI и Qwen; real MCP, MEXC_WRITE_MODE=dry-run
npm --prefix apps/openai-mcp-live-check run eval:mexc-write

# Полная матрица: все 15 write-инструментов × 6 моделей
npm --prefix apps/openai-mcp-live-check run eval:mexc-write-suite
```

`mexc-dry-run-model-eval.mjs` поднимает `src/mexc.ts` с `MEXC_WRITE_MODE=dry-run`, получает из него реальную schema тестируемого инструмента, а затем передаёт model tool call в этот же MCP по stdio. Локальный recording MCP для этого сценария не используется.

Для полного набора раннер публикует модели ровно один write-tool на кейс. Это проверяет формирование корректных параметров, Zod-валидацию и routing, но намеренно не измеряет выбор инструмента из большого каталога. В каждый результат сохраняются raw model arguments, нормализованные `validatedArguments`, локальная latency и receipt dry-run.

## Воспроизведённые проблемы

### 1. Qwen сериализует числовые enum как строки

На реальном MCP, с исходным реалистичным сценарием `getFuturesContracts -> getFuturesTicker -> createFuturesTriggerOrder`, все проверенные Qwen-модели отправили строковые коды:

```json
{
  "side": "1",
  "openType": "1",
  "triggerType": "1",
  "executeCycle": "1",
  "orderType": "2",
  "trend": "1"
}
```

Проверенные модели:

| Модель | Raw тип `side` | Локальный результат |
|---|---:|---|
| `qwen3.6-flash` | `string` | `side/openType/triggerType/executeCycle/orderType/trend: Invalid input` |
| `qwen3.8-flash` | `string` | тот же validation error |
| `qwen3.7-plus` | `string` | тот же error, также `positionMode` строкой |

Время локального отказа в write-вызове: 4–5 ms. Это доказывает, что handler и MEXC HTTP не были вызваны. Ошибка совпадает с наблюдённым диалогом Qwen и воспроизводится без риска реальной заявки.

### 2. OpenAI передаёт числа, но неверно выбирает код типа ордера

В детерминированном dry-run сценарии `gpt-5-nano`, `gpt-5-mini` и `gpt-5` передали числовые enum, но вместо market-кода выбрали `orderType` 4, 3 и 2 соответственно. Все эти коды являются limit-style и требуют `price`, которого модель не передала. `gpt-5-nano` также передал недопустимый `recvWindow: 0`.

Причина: опубликованная schema показывает допустимый диапазон кодов, но не объясняет торговую семантику каждого кода. Слово `market` в пользовательском prompt само по себе не даёт модели надёжного отображения в числовой enum.

### 3. OpenAI function-calling adapter и OpenAPI 3 schema

MCP публикует schema через OpenAPI 3 target. `exclusiveMinimum: true` из этого формата не принимается OpenAI Responses API, где ожидается числовая форма JSON Schema. Eval adapter нормализует это поле только перед запросом к OpenAI. Production MCP schema и runtime не меняются.

Для GPT-5 reasoning-моделей также нужен достаточный `max_output_tokens` и `reasoning.effort='low'`; при малом лимите ответ заканчивался `incomplete` до первого function call. Это особенность тестового orchestration, а не ошибка MCP.

## Исправление production MCP

### Строгое преобразование enum-кодов

Перед Zod enum-валидацией MCP принимает только целочисленные строковые коды для полей:

- `side`;
- `openType`;
- `triggerType`;
- `executeCycle`;
- `orderType`;
- `trend`;
- `positionMode`.

Допустимо: `"1" -> 1`. После преобразования применяется текущая строгая enum-схема. Нельзя принимать `"foo"`, `"1.0"`, `"1e0"`, пустую строку, `null` или значение вне допустимого набора. Преобразованные значения в dry-run receipt — числовые.

Преобразование должно быть ограничено этими кодовыми полями. Не следует неявно менять правила для цен и объёмов: у них отдельные требования точности и форматирования.

### Описания полей

В published schema добавлены descriptions непосредственно на полях, включая полное отображение кодов:

- `side`: `1=open long`, `2=close short`, `3=open short`, `4=close long`;
- `openType`: isolated/cross;
- `triggerType`: условие `>=` / `<=` для trigger price;
- `executeCycle`: 24 часа / 7 дней;
- `orderType`: отдельное указание market-кода и requirement `price` для limit-style кодов;
- `trend`: источник trigger price: last / fair / index;
- `positionMode`: режим позиции.

Такое описание нужно и Qwen, и OpenAI: coercion решает проблему JSON-типа, а descriptions решают проблему выбора правильного кода.

### Результат повторного dry-run eval после исправления

Все модели получили `mode=dry-run`, `exchangeRequestSent=false` и нормализованный `side=1`, `orderType=5`:

| Провайдер | Модель | Raw тип `side` | Полное время | Локальный write dry-run |
|---|---|---|---:|---:|
| OpenAI | `gpt-5-nano` | number | 3 801 ms | 5 ms |
| OpenAI | `gpt-5-mini` | number | 3 032 ms | 4 ms |
| OpenAI | `gpt-5` | number | 9 736 ms | 3 ms |
| Qwen | `qwen3.6-flash` | string | 11 860 ms | 3 ms |
| Qwen | `qwen3.8-flash` | string | 16 903 ms | 4 ms |
| Qwen | `qwen3.7-plus` | string | 6 660 ms | 3 ms |

Qwen продолжает генерировать строки, что подтверждает необходимость coercion; server-side validation принимает только заранее определённые digit-only коды и не ослабляет диапазоны enum.

## Регрессии после исправления

Обязательный набор:

1. Numeric enum payload проходит schema и dry-run receipt.
2. Qwen-подобный payload со строками `"1"` нормализуется и проходит; в handler/dry-run receipt значения числовые.
3. `"foo"`, `"1.0"`, `"1e0"`, `null` и out-of-range code отклоняются до handler.
4. Market trigger без `price` проходит только с market-кодом; limit-style code без `price` отклоняется.
5. `MEXC_WRITE_MODE=dry-run` гарантирует `exchangeRequestSent=false`; handler не вызывается.
6. `MEXC_WRITE_MODE=live` остаётся явным default и не меняет read-инструменты.
7. Ночной model eval сохраняет raw arguments, типы enum, модель, latency и результат Zod без секретов.

## Полный прогон write-набора

В набор входят все 15 MEXC write-инструментов, классифицированных runtime: `createTestOrder`, `createOrder`, `cancelOrder`, `cancelAllOrders`, `createFuturesOrder`, `cancelFuturesOrderByExternalId`, `cancelAllFuturesOrders`, `cancelFuturesOrders`, `createFuturesTriggerOrder`, `cancelFuturesTriggerOrders`, `cancelAllFuturesTriggerOrders`, `updateFuturesOrderTpSl`, `cancelFuturesStopOrders`, `cancelAllFuturesStopOrders`, `updateFuturesTriggerOrderTpSl`.

Первый полный запуск дал 87/90 PASS (15 инструментов × 3 OpenAI + 3 Qwen). Успешные результаты всегда содержали `mode="dry-run"`, `exchangeRequestSent=false` и ожидаемые нормализованные аргументы; локальный вызов MCP занимал 2–31 ms. Три отказа были диагностированы по артефакту:

- `gpt-5-nano` вызвал `createFuturesTriggerOrder`, но пропустил явно запрошенный `reduceOnly:false`; MCP корректно принял необязательное поле, однако assertion правильно отметил неполное соблюдение тестового payload;
- `qwen3.7-plus` не вызвал `createOrder` и `cancelAllFuturesOrders`: описание production-инструмента говорит о реальном действии, а внешний runtime switch принципиально не опубликован в schema, поэтому модель запросила подтверждение.

Это не были ошибки валидации или обращения к MEXC. Для controlled evaluation добавлен системный контекст раннера: локальный production MCP уже запущен с внешним write-interceptor, handler не запускается, поэтому модель должна сделать один вызов без подтверждения. Production tool descriptions и скрытость `MEXC_WRITE_MODE` при этом не менялись. После уточнения обязательного `reduceOnly:false` и этого тестового контекста повторно прогнаны все модели затронутых трёх кейсов: 9/9 PASS. Следовательно, каждый элемент матрицы 15 × 6 имеет подтверждённый успешный запуск в реальном MCP dry-run контуре.

Для пользовательской сессии с `MEXC_WRITE_MODE=live` подтверждение на реальную торговую операцию остаётся правильным поведением модели; системная инструкция выше допустима только в изолированном eval, где write handler технически заблокирован.

## Артефакты прогона

- Qwen, realistic `contracts -> ticker -> create`:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-19T21-45-21-288Z/summary.json`
- Qwen, deterministic write prompt:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-19T21-49-52-405Z/summary.json`
- OpenAI, deterministic write prompt:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-19T21-52-40-348Z/summary.json`
- All providers after coercion and descriptions:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-20T08-43-03-545Z/summary.json`
- Full write matrix, initial 87/90:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-20T09-08-58-606Z/summary.json`
- Repeat: trigger case, all OpenAI models, 3/3:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-20T09-19-55-202Z/summary.json`
- Repeat: spot `createOrder`, all Qwen models, 3/3:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-20T09-20-18-522Z/summary.json`
- Repeat: Futures `cancelAllFuturesOrders`, all Qwen models, 3/3:
  `apps/openai-mcp-live-check/artifacts/mexc-dry-run-model-eval/2026-09-20T09-20-38-201Z/summary.json`
