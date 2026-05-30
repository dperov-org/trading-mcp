# Оценка восстановимости кодогенератора

Дата: 2026-05-28

## Краткий вывод

Точный исходный код публичного codegen pipeline по текущему репозиторию восстановить нельзя.

Совместимый новый генератор, который будет снова выпускать `src/tools/**` в текущем формате, восстановить можно с высокой вероятностью.

Статус на текущий момент:

- публичная реализация codegen добавлена в репозиторий
- bootstrap inventory уже собран из текущего `src/tools/**`
- проект снова поддерживает `npm run generate`

Итоговая оценка:

- exact recovery оригинального генератора: низкая
- recovery функционально совместимого генератора: высокая
- recovery сгенерированного output почти без изменения runtime: высокая

## Что реализовано

В репозиторий добавлен публичный codegen:

- generator script: `scripts/generate-tools.mjs`
- verify script: `scripts/verify.mjs`
- inventory: `codegen/tool-inventory.json`
- npm scripts:
  - `npm run codegen:bootstrap`
  - `npm run generate`
  - `npm run verify`

Подтверждение:

- [scripts/generate-tools.mjs](/c:/Projects/trading-mcp/scripts/generate-tools.mjs:1)
- [scripts/verify.mjs](/c:/Projects/trading-mcp/scripts/verify.mjs:1)
- [package.json](/c:/Projects/trading-mcp/package.json:31)
- [codegen/tool-inventory.json](/c:/Projects/trading-mcp/codegen/tool-inventory.json:1)

## Как устроен новый публичный pipeline

### 1. Source-of-truth

Новый публичный source-of-truth не является исходной Bybit API spec.

Вместо этого используется inventory-файл:

- `codegen/tool-inventory.json`

В нем хранятся:

- все `index.ts` под `src/tools/**`
- все tool-модули под `src/tools/**`
- raw TS-фрагменты для:
  - imports
  - `name`
  - `description`
  - `inputSchema`
  - `handler`

Это сознательное решение.

Причина:

- исходная private spec / private generator в публичном репозитории отсутствуют
- generated output сохранился полностью
- raw TS fragments позволяют воспроизводимо генерировать текущий слой wrappers без ручной перенабивки 327 файлов

### 2. Bootstrap режим

Команда:

```bash
npm run codegen:bootstrap
```

Что делает:

1. Рекурсивно читает `src/tools/**/*.ts`
2. Разделяет tool-файлы и `index.ts`
3. Извлекает banner `auto-generated, do not edit`, если он есть
4. Для tool-файлов извлекает:
   - `export const ...`
   - `name`
   - `description`
   - `inputSchema`
   - `handler`
5. Для `index.ts` извлекает:
   - export name массива tools
   - import lines
   - entries массива, включая spread entries вроде `...assetConvertTools`
6. Пишет нормализованный inventory в `codegen/tool-inventory.json`

Особенно важно:

- bootstrap поддерживает вложенные индексы, например `asset/convert/index.ts`
- поэтому inventory покрывает не только root `src/tools/index.ts`, но и промежуточные group-index файлы

### 3. Generate режим

Команда:

```bash
npm run generate
```

Что делает:

1. Читает `codegen/tool-inventory.json`
2. Перегенерирует все tool-файлы
3. Перегенерирует все `index.ts` под `src/tools/**`
4. Перегенерирует root `src/tools/index.ts`

Практически это возвращает проекту воспроизводимость:

- generated layer больше не является "невоспроизводимым артефактом"
- `src/server.ts` снова может честно ссылаться на `npm run generate`

### 3.1 Verify режим

Команда:

```bash
npm run verify
```

Что делает:

1. Проверяет, что текущая версия Node.js удовлетворяет минимальному требованию `>=20.6`
2. Запускает `npm run generate`
3. Запускает `npm run typecheck`
4. Запускает `npm run build`
5. Печатает краткий timing summary по шагам

Зачем это нужно:

- один воспроизводимый вход для локальной проверки
- единое место для будущих дополнительных smoke/integration checks
- явная фиксация того, что codegen теперь считается частью стандартной верификации

Важно:

- `verify` сейчас не выполняет сетевые запросы к Bybit
- `verify` сейчас не делает diff-check рабочего дерева после `generate`
- это intentional local verification pipeline, а не полноценный test suite

### 4. Почему pipeline сделан именно так

Это не spec-first generator в чистом виде.

Это inventory-first generator, восстановленный из уже существующего output.

Плюсы такого подхода:

- быстро возвращает воспроизводимость
- не требует доступа к internal repo
- сохраняет все текущие human-written AI hints и custom handler overrides
- покрывает nested category indexes

Минусы:

- source-of-truth уже производен от generated output
- pipeline пока не умеет заново "изобрести" wrappers из OpenAPI/YAML spec
- inventory содержит raw code fragments, а не чистую доменную модель endpoint-ов

## Что именно этот generator покрывает

Новый generator воспроизводит:

- per-tool wrapper files
- category / subcategory `index.ts`
- root `src/tools/index.ts`

Он сохраняет:

- неоднородные описания tools
- кастомные post-processing handler-ы
- mixed-language descriptions
- nested import topology

Примеры special cases, которые сохраняются как есть через inventory:

- [src/tools/p2p/getAds.ts](/c:/Projects/trading-mcp/src/tools/p2p/getAds.ts:13)
- [src/tools/p2p/getChatMessages.ts](/c:/Projects/trading-mcp/src/tools/p2p/getChatMessages.ts:13)
- [src/tools/user/querySubMembers.ts](/c:/Projects/trading-mcp/src/tools/user/querySubMembers.ts:53)
- [src/tools/user/querySubMembersV5.ts](/c:/Projects/trading-mcp/src/tools/user/querySubMembersV5.ts:59)

## Ограничения текущей реализации

### 1. Это не exact recovery internal generator

Текущая реализация восстанавливает публичную воспроизводимость, но не private source pipeline.

### 2. Inventory хранит raw TS fragments

Это осознанный компромисс.

Пока generator не знает бизнес-семантику параметров глубже, чем та уже выражена в сохраненном TS-коде.

### 3. Нет автоматического удаления stale files

Текущий `generate` перезаписывает известные inventory-файлы, но не делает destructive cleanup неизвестных файлов.

Это тоже осознанно: безопаснее не удалять ничего автоматически в рабочем дереве.

### 4. Bootstrap привязан к текущему формату файлов

Если структура tool-файлов будет радикально изменена вручную, bootstrap-парсер придется дорабатывать.

## Практический результат

Теперь в репозитории есть рабочий публичный путь:

1. Изменить `codegen/tool-inventory.json`
2. Запустить `npm run generate`
3. Получить воспроизводимый generated layer в `src/tools/**`

И стандартный локальный verify-путь:

1. Обновить inventory или generator при необходимости
2. Запустить `npm run verify`
3. Проверить, что generate/typecheck/build проходят на текущей машине

Или:

1. Отредактировать существующие tool-файлы
2. Запустить `npm run codegen:bootstrap`
3. Зафиксировать новое inventory

Второй сценарий полезен как transitional-режим миграции от legacy generated output к публичному inventory-first pipeline.

## На чем основан вывод

### 1. Runtime явно ожидает внешний codegen

`src/server.ts` прямо говорит, что `allTools` generated by the codegen pipeline, и пытается импортировать уже готовый `src/tools/index.ts`.

Подтверждения:

- [src/server.ts](/c:/Projects/trading-mcp/src/server.ts:13)
- [src/server.ts](/c:/Projects/trading-mcp/src/server.ts:23)

### 2. В публичном `package.json` нет способа запустить генерацию

В скриптах есть только `build`, `dev`, `typecheck`, `publish-pkg`.

Подтверждение:

- [package.json](/c:/Projects/trading-mcp/package.json:31)

Это согласуется с замечанием в аудите:

- [REPO_AUDIT_2026-05-23.md](/c:/Projects/trading-mcp/REPO_AUDIT_2026-05-23.md:215)

### 3. История git указывает на внутренний upstream

В истории много коммитов вида `sync: vX.Y.Z from internal@...`.

Это сильный признак того, что публичный репозиторий является downstream-синком из внутреннего репозитория, а не полной исходной площадкой разработки.

### 4. История git также указывает на сознательное исключение `scripts/`

По истории видно:

- `94594c1 chore: ignore scripts directory`
- `9a340af chore: exclude scripts/publish.sh from version control`
- `2dab222 chore: remove publish-pkg script referencing gitignored file`

Это важный сигнал: инфраструктурные скрипты уже раньше сознательно выводились из публичной версии.

Текущий `.gitignore` по-прежнему содержит `scripts/publish.sh`.

Подтверждение:

- [.gitignore](/c:/Projects/trading-mcp/.gitignore:6)

### 5. В публичном дереве нет исходников генератора и нет входной спецификации

В текущем репозитории не найдены:

- `scripts/generate*`
- `codegen/*`
- `openapi.*`
- `swagger.*`
- `*.yaml` / `*.yml` со спецификацией API
- `*.json` со schema/spec inventory

При этом в `devDependencies` лежат `js-yaml` и `@types/js-yaml`, но в публичном `src/` они не используются.

Подтверждение:

- [package.json](/c:/Projects/trading-mcp/package.json:43)

Это не доказывает формат источника, но является косвенным признаком того, что генератор мог читать YAML-спеку во внутреннем пайплайне.

Статус этого пункта: inference, не прямое доказательство.

## Что сохранилось и позволяет восстановить совместимый генератор

Несмотря на отсутствие исходного pipeline, сохранился весь generated output. Этого достаточно, чтобы восстановить структуру целевой модели.

### 1. Сохранились все сгенерированные tool-модули

В `src/tools/**` найдено:

- 327 tool-модулей без `index.ts`
- 32 категориальных `index.ts`
- 1 общий `src/tools/index.ts`

Это совпадает с общим числом 359 auto-generated файлов, отмеченным в аудите.

Подтверждения:

- [REPO_AUDIT_2026-05-23.md](/c:/Projects/trading-mcp/REPO_AUDIT_2026-05-23.md:43)
- [src/tools/index.ts](/c:/Projects/trading-mcp/src/tools/index.ts:1)

### 2. Формат output очень однотипный

Практически все tool-файлы укладываются в небольшой набор шаблонов:

- `restClient.get(...)`: 41
- `restClient.getAuth(...)`: 121
- `restClient.postAuth(...)`: 124
- `wsClient.snapshot(...)`: 27
- `wsClient.tradeRequest(...)`: 6
- `subscriptionManager.*`: 4
- специальные post-processing override: 4

Из этого следует, что новый генератор не обязан быть сложным. Основная масса output генерируется из 5-7 шаблонов.

### 3. Хорошо видна трехуровневая структура эмиссии

Текущий output показывает три слоя:

1. per-tool файл
2. per-category `index.ts`
3. общий `src/tools/index.ts`

Подтверждения:

- [src/tools/trade/createOrder.ts](/c:/Projects/trading-mcp/src/tools/trade/createOrder.ts:1)
- [src/tools/trade/index.ts](/c:/Projects/trading-mcp/src/tools/trade/index.ts:1)
- [src/tools/index.ts](/c:/Projects/trading-mcp/src/tools/index.ts:1)

### 4. Ручное ядро, в которое встраиваются generated wrappers, сохранилось полностью

Ручные runtime-компоненты, на которые опирается генерация:

- REST runtime: [src/client/rest-client.ts](/c:/Projects/trading-mcp/src/client/rest-client.ts:36)
- WS snapshot / trade runtime: [src/client/ws-client.ts](/c:/Projects/trading-mcp/src/client/ws-client.ts:60)
- subscription runtime: `src/client/subscription-manager.ts`

Это важно: восстанавливать нужно только emitter и источник metadata, а не весь transport/runtime слой.

## Что утрачено для exact recovery

### 1. Исходная inventory/spec модель

По output нельзя точно восстановить, в каком виде generator получал вход:

- OpenAPI / Swagger
- вручную подготовленный YAML/JSON inventory
- внутренний экспорт из другого сервиса
- смесь spec + override-файлов

### 2. Исходные правила enrichment descriptions

Некоторые описания выглядят как прямой перенос endpoint docs.
Некоторые выглядят как сильно дополненные AI-routing hints.
Некоторые содержат security-aware вставки или product-specific бизнес-правила.

Примеры:

- [src/tools/trade/createOrder.ts](/c:/Projects/trading-mcp/src/tools/trade/createOrder.ts:7)
- [src/tools/wstrade/wsCreateOrder.ts](/c:/Projects/trading-mcp/src/tools/wstrade/wsCreateOrder.ts:7)
- [src/tools/user/querySubMembersV5.ts](/c:/Projects/trading-mcp/src/tools/user/querySubMembersV5.ts:7)

По output нельзя надежно отделить:

- что пришло из первичной спецификации
- что было наложено override-слоем
- что было вручную или полуавтоматически расширено под MCP/LLM

### 3. Исходные override-таблицы

Найдены как минимум 4 tool-модуля с дополнительной логикой поверх простого proxy:

- [src/tools/p2p/getAds.ts](/c:/Projects/trading-mcp/src/tools/p2p/getAds.ts:13)
- [src/tools/p2p/getChatMessages.ts](/c:/Projects/trading-mcp/src/tools/p2p/getChatMessages.ts:13)
- [src/tools/user/querySubMembers.ts](/c:/Projects/trading-mcp/src/tools/user/querySubMembers.ts:53)
- [src/tools/user/querySubMembersV5.ts](/c:/Projects/trading-mcp/src/tools/user/querySubMembersV5.ts:59)

Из output видно, что существовал как минимум слой точечных post-process override-ов.
Но по репозиторию не видно, где эти override-ы были описаны до эмиссии.

### 4. Исходные naming/convention rules

Видны разные стили имен:

- camelCase: `createOrder`
- префиксы действия: `get`, `query`, `set`, `post`
- сохранение исходного legacy-имени: `QueryOrderFromOpenApi`, `SmallAssetQuote`

Значит в generator были правила нормализации имен или уже подготовленный inventory с готовыми tool names.
Точную логику naming policy по output восстановить можно только частично.

## Что можно восстановить практически

### Вариант A. Совместимый generator из текущего output

Это самый реалистичный путь.

Идея:

1. Один раз извлечь из текущих `src/tools/**` внутренний inventory:
   - `toolName`
   - `category`
   - `description`
   - `schema AST` или сырой TS-фрагмент `inputSchema`
   - тип handler-шаблона
   - endpoint / WS `op` / topic-builder
   - optional post-processing override id
2. Положить inventory в публичный `tools.inventory.json` или `tools.inventory.ts`
3. Написать новый generator, который выпускает:
   - per-tool modules
   - category indices
   - root index

Плюсы:

- воспроизводимая генерация появится быстро
- output можно сделать byte-near-compatible
- не нужен доступ к внутреннему repo

Минусы:

- это будет новый генератор, а не восстановление оригинального
- часть source-of-truth уже будет взята из generated output

Оценка реализуемости: высокая

### Вариант B. Generator из внешней Bybit API спецификации

Теоретически возможен, но хуже.

Понадобится заново строить:

- маппинг endpoint -> tool name
- auth policy
- human-friendly descriptions
- MCP/LLM agent hints
- custom overrides
- WS topic builders

Без готовой официальной machine-readable spec или внутреннего inventory это будет заметно дороже и менее совместимо с текущим output.

Оценка реализуемости: средняя

### Вариант C. Exact recovery через git history

По текущей публичной истории шанс низкий.

На практике история показывает обратное:

- публичный repo синкается из `internal@...`
- вспомогательные scripts сознательно исключались из version control
- следов codegen source в истории не найдено

Оценка реализуемости: низкая

## Вероятная форма исходного генератора

Ниже не факт, а наиболее вероятная реконструкция по признакам в output.

### Базовая модель

С высокой вероятностью generator принимал inventory вида:

- category
- toolName
- method: `get|getAuth|postAuth|wsSnapshot|wsTrade|subscription`
- endpoint path или WS op/topic template
- description
- список параметров
- типы параметров
- optional / default / enum / numeric constraints
- optional handler override

### Эмиссия

С высокой вероятностью pipeline делал:

1. emit tool module
2. emit category index
3. emit root `src/tools/index.ts`

### Источник inventory

Наиболее вероятные варианты:

1. внутренний YAML/JSON inventory
2. OpenAPI-подобная spec + ручные override-ы
3. внутренний сервисный export, который затем превращался в YAML/TS

Признаки в пользу inventory + override модели:

- сильная однотипность handler-ов
- редкие, но явные специальные post-processing cases
- сильно неоднородная детализация `description`
- наличие `js-yaml` без публичного использования

Статус раздела: inference

## Минимальный план восстановления публичного генератора

### Этап 1. Зафиксировать source-of-truth

Создать новый inventory-файл, извлеченный из текущих generated modules.

Минимальные поля:

- `name`
- `category`
- `description`
- `schemaSource`
- `handlerKind`
- `endpoint`
- `wsOp`
- `topicBuilder`
- `requiresOverride`
- `overrideId`

### Этап 2. Вынести overrides отдельно

Нужен явный реестр специальных случаев.

Минимум:

- `p2p.getAds`: удалить `remark`
- `p2p.getChatMessages`: префикс недоверенного текста + warning
- `user.querySubMembers`
- `user.querySubMembersV5`

### Этап 3. Написать emitter

Новый generator может быть довольно компактным:

- render per-tool file
- render category `index.ts`
- render root `src/tools/index.ts`

### Этап 4. Добавить публичный `generate` script

После этого комментарий в `src/server.ts` станет правдивым, а проект станет воспроизводимым без внутреннего репозитория.

### Этап 5. Ввести snapshot-тесты на output

Без этого codegen будет дрейфовать.

Нужно минимум проверять:

- список файлов
- содержимое root index
- детерминированный порядок tools
- отсутствие неожиданных diff при повторной генерации

## Практический вердикт

Если цель звучит как:

- "вернуть именно тот самый внутренний generator в исходном виде"

то ответ: нет, по текущему публичному репозиторию это практически нереально.

Если цель звучит как:

- "сделать так, чтобы проект снова умел воспроизводимо генерировать свои wrappers"

то ответ: да, это реалистично, и текущего репозитория для этого достаточно.

Наиболее рациональный путь: не искать утраченный private generator, а собрать новый публичный generator, используя текущий `src/tools/**` как начальный canonical dataset.
