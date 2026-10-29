# Этап10.6 — выборочные контексты и точная привязка запроса

26.10.2026. Законченный блок общего исполнителя: task-specific context packets и production composition, которая передаёт модели только genuine packet той же задачи/снимка. Независимые verdicts/полный цикл ремонта ещё не подключены.

## Что реализовано

`orchestration/projectModelContext.ts` строит author/security/reviewer/tester packet только из подлинного plan/task/snapshot и проверенных host bytes. Входные selections задают путь, версию base/proposed и UTF16 offsets. Текст фрагмента не принимается от модели: он извлекается из private source/prepared changes, снабжается source/fragment SHA. Для review требуется genuine proposal именно того же snapshot; каждый changed file должен иметь показанный proposed excerpt. Копия JSON не является capability.

Source/proposed strings, request body и инструкции хранятся private WeakMap. Default JSON packet содержит только paths/ranges/role/commit/hash/bytes/token estimate. Commander может получать эти метаданные; `projectContextRequestBody` — HOST-only путь явной передачи выбранного текста модели, не результат SDK tool.

По каждому базовому/предложенному файлу вычислены конкретные **unshownSource ranges**. Host runtime checks в packet всегда unverified/testsExecuted:false: чужой JSON не может превратить их в passed. Для Tester это указано и в неизменяемой system instruction. Semantic relevance выбранного host диапазона, непоказанный код, независимые verdicts, runtime/browser, CI и публикация остаются явно unverified.

## Ограничения контекста

- До8 непересекающихся fragments, до2048 UTF16 chars каждый, до6000 selected UTF8 bytes на packet.
- По существующему private файлу суммарно base+proposed не более60% оригинальных bytes и2048bytes. Полный существующий файл и разбиение на куски для обхода ограничения отклоняются. Полный original, скопированный через новый generated file, также отклоняется в проверяемом payload.
- Отсутствие original должно быть доказано snapshot. Новый genuine create-файл можно явно показать целиком в пределах cap; он не является непоказанным прежним private source.
- Actual serialized request не более min(profile.maxReviewBytes,12000) bytes; output reserve1200, estimated input+reserve не более6000 tokens. Размер учитывает JSON escaping. Overflow — явный отказ, без потери критериев/обрезания доказательств/запроса модели.

Это ограничения одного packet, не глобальный privacy ledger всех будущих задач и не семантическое доказательство достаточности excerpts. Выбор source windows остаётся доверенным host-кодом, не произвольным tool аргументом модели. Unicode boundaries, getters, sparse/unknown fields и ложный source text отклоняются.

## Привязка к исполнению

`createProjectContextGuard` проверяет SHA и bytes ВСЕГО ожидаемого запроса: model, system/user messages, историю и output limit. Затем повторяет source/proposal freshness checks. Подмена или stale source terminal/latching, включая повторное создание guard из того же packet.

`createContextBoundProjectTransport` потребляет тот же native admission, но наружу принимает только packet. Сверяются private plan/task/snapshot identity, исключается оплата чужого проекта/снимка. Caller не может заменить context callback; SDK/body JSON не расширяет запрос. Общий task transport/ledger/TPM limits остаётся один на все роли. Concurrent/bad packet останавливает wire через новый host stop; расходов/HTTP до допуска нет. Модельный ответ остаётся proposalVerified:false, independentAssessmentsVerified:false, publicationAuthorized:false.

Role scheduling и проверка ready/finding/model verdict здесь НЕ реализованы. Только наличие корректного role-context не даёт права перейти к публикации. Low-level transport остаётся HOST-only constructor; production composition использует packet-bound entry.

## Проверки

Source `b597f4dfc31a9dd093d9ac4b7fe55ff7d74c133c`. [CI40350249664](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40350249664), job121668029511: **pnpm typecheck PASS; pnpm test2489/2489 PASS**, failures0. Связанные локальные regressions **214/214**,13 новых context cases. Syntax/exact isolated git diff check PASS. Существующие Calculator сценарии/ожидаемые ответы не менялись.

Unit/integration используют synthetic source/owner/model и настоящий временный file ledger. Проверены metadata privacy, explicit missing ranges, full/split/cross-version/copied-source refusal, genuine review proposal, absence-proven create, invalid scopes/selectors, getters/mutation, message/history/model/output tampering+latching, stale source, actual serialized overflow, packet→native-branded admission→mock HTTP, foreign plan/snapshot/packet budget isolation и injected callback/concurrency refusal.

## Настоящий GitHub audit

[Native40350695171](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40350695171), job121669624912 — SUCCESS. Закреплён tested runtime и successful exact CI Typecheck/Test; token только read, provider/writer keys отсутствуют, локальных installs нет.

Прочитаны6 существующих Calculator files/11284bytes на неизменном `558993981c9bbb7c6100c8335860ac5668768314`, проверены commit/blob/source SHA и absence. Из src/app.mjs выбран только диапазон0..40; full source остаётся memory-only. Request **3538bytes**, SHA `955cfb8d221b1d793549d7a76119a46f1a9e93dec2e149c8636c53079a45a8f6`, conservative reserved estimate2636tokens; это оценка, не расход/разрешение. Показаны6 unshown ranges. Genuine body guard passed, altered body rejected. Artifact metadata не содержит fragment text или request body.

**28 GitHub GET,0 API mutations,0 model calls,0 budget writes,0 application changes.** Это реальное read-only source/context доказательство, не real Groq transport/review/положительное исполнение второго проекта.

## Следующий блок

Связать model response с genuine context/role/proposal identity, проверить независимые verdicts и порядок фаз, подключить actual generic host-test proof и bounded correction. Затем candidate/exact-CI/delivery/restart и отдельная согласованная квота. Текущая remaining.requests0; нового owner grant/production target/real second project нет. Не заявлять общую автономность и не повторять завершённую T05.

Ошибки Calculator (повтор операторов/leading zeros) остаются отдельной незапущенной repair задачей. Код приложения не менялся. Main/ledger/старые receipts сохраняются. Legal disabled; без merge/deployment, платных API, Codespaces, локальных installs или новых агентов.

[Machine proof](../.factory/project-context-binding-proof-20261026.json).
