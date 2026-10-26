# Этап10.4 — общий защищённый транспорт модели

26.10.2026. Добавлена передача запросов generic задачи через ранее созданный plan/admission и обязательный shared project budget. Это transport block, не законченный универсальный author/reviewer executor и не исправление Calculator.

## Реализовано

`projectTaskModelTransport.ts` потребляет одноразовый genuine admission. Требует явные Groq/Free/live/legal flags, подлинный development scope, обязательные host context/provenance assertion и checkpoint callback. Модель/JSON не создают эти capabilities. Разрешён только один Groq endpoint; provider fallback, streaming, tool calls и multiple completions не допускаются. Секреты/ключи блокируются в сообщениях/ответе, тело не попадает в snapshot/checkpoint/error.

Общие лимиты:4 запроса,24000 байт/request,96000 байт/task,1200 output tokens,300000ms. Используется прежний проверенный four-role task preset и TPM pacing без изменения legacy default. Generic context aggregate24000 токенов покрывает4×6000; это локальный потолок, не новый owner allowance. Каждая операция всё равно проверяется настоящим project ledger, его лимит не увеличивается. Пауза допустима до свежего запроса; ошибочный запрос не повторяется.

Порядок: bounded parse/host guards → pacing → shared context/task admission → durable reservation → повтор owner/source/context → source-free checkpoint с SHA/bytes/counters → повтор guards → HTTP. Потеря checkpoint/owner/source/context после резерва сохраняет расход и не отправляет HTTP. HTTP429/network/503, malformed/truncated/tool-bearing/oversized response прекращают сессию; abort/deadline и конкуренция не возобновляют её.

Успешный HTTP возвращает private content с proposalVerified:false/publicationAuthorized:false/wholeAppCompleted:false. Строка модели не считается проверенным кодом или verdict. Проверку proposal, корректировку, независимые роли, sandbox и CI ещё требуется соединить в generic pipeline. Настоящий snapshot/context selector должен реализовать обязательные host callbacks; noop mock в тесте не считается реальным доказательством источника.

## Найденная интеграционная ошибка Factory

Прежний generic admission выдавал ID project-task-<32hex>. Подстрока sk-<hash> совпадала с существующим secret scanner, из-за чего durable reservation блокировался. Это обнаружил реальный путь нового теста от admission через ledger к mock HTTP: первый прогон31 тестов дал22PASS/9FAIL. Формат заменён на project-run-<hash>. Secret scanner не ослаблен, legacy Calculator IDs/grant/key/history не изменены. До этого generic production targets/runs0; старый формат не мог создать успешную reservation через данный валидатор. Новый round trip доказывает reserve/checkpoint-before-HTTP; перезапуск того же task ID отвергается без повторного расхода.

## Проверки

Source `e1e86a58055fceaf1dc3694ebf55e420b1ae70b3`. [CI40337212062](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40337212062), job121621887033: **pnpm typecheck PASS; pnpm test2460/2460 PASS**, failures0. Полный exact isolated git diff --check PASS.

Локально **185/185** связанных regressions PASS.15 новых cases в projectPlan.test.ts: полный roundtrip; четыре больших запроса/pacing/24k;429; network/HTTP failure; unsafe requests; oversized contexts; flags/copied admission; preflight refusal; checkpoint failure/false; источник/owner/context после reserve; invalid/truncated/oversized/tool/secret response; fresh-controller replay; lost reservation ACK; checkpoint deadline; concurrent calls. Все model/native-owner/source/context responses synthetic/mock. Хранилище тестового бюджета реально пишет временные файлы; это не новая запись в настоящий GitHub budget.

## Границы и следующая работа

Реальных model calls0; настоящий budget не менялся, remaining.requests0. Новых production targets/grants0. Изменён только Factory, приложение не редактировалось. В отчёт дефектов отдельно добавлен случай ведущих нулей00005→5 с сохранением0.05; агентная починка Calculator не запускалась.

Далее: profile-bound authentic snapshot/context adapter и generic proposal validator; затем связывание author→bounded correction→Security/Reviewer/Tester→host tests→candidate→exact CI/delivery. До-плановая квота/планирующий HTTP также отдельный gate. Не подключать generic transport к live workflow без этих доказательств и нового native allowance. Общая автономность/второй проект/выпуск Onay не заявляются.

Без merge/deployment, Codespaces, платных API, локальной установки зависимостей или новых агентов. Legal disabled. Старые положительные/отрицательные receipts и расходы сохраняются. [Machine proof](../.factory/project-model-transport-proof-20261026.json).
