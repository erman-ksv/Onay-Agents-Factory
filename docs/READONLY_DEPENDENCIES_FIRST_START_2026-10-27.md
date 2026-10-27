# Пункт2 — read-only dependencies и первая задача

## Реализация

Host target profile и owner goal теперь могут объявлять отдельный readOnlyPaths. Этот список проверяется, не пересекается с writablePaths и участвует в profile/owner/plan fingerprints. Без поля прежние profiles и планы сохраняют прежнюю форму и hashes. Произвольные, скрытые/служебные и не объявленные host пути не добавляются.

Snapshot загружает и проверяет Git blob SHA/UTF8/размеры read-only dependencies вместе с writable source. Отсутствующая зависимость останавливает работу; право создать её не выдаётся. changePaths остаётся только writable. Модель может получить ограниченный относящийся к задаче base excerpt зависимости, с SHA/readOnly metadata и явными непоказанными областями. Полный приватный код в модельный ответ не сериализуется. Patch/create read-only файла отклоняется. Node/browser могут читать эти источники без права записи.

Для нового плана добавлен mode=first-task в pinned host manifest: archivePin=null/candidateSha=null означают только явно новый, отсутствующий archive. Existing continuation по-прежнему требует действующий non-null trusted pin и SHA кандидата. Existing archive или любые task WAL reservations запрещают свежий start. Модельный ledger по-прежнему только inspect: initialize/reset/grant extension не добавлены.

## Защищённый старт

prepareProjectInitialTask требует genuine development controller, exact plan/profile/task scope, свежий genuine passed base CI, действующие state rules, существующий бюджет с достаточным allowance и отсутствующий archive. Проверяются стабильные execution IDs всех задач плана. Первый task не имеет непроверенных зависимостей.

До любого model HTTP сохраняется AES-GCM task-start claim через native archive CAS. Только один host выигрывает создание claim. Неподтверждённый append/claim не повторяется. Нельзя восстановить in-memory ticket из JSON, передать simulated ticket native worker или повторно употребить ticket.

Первый task использует ТОТ ЖЕ worker, что successor: fresh source/dependency CI, cooldown, reserve-before-HTTP, durable before-HTTP checkpoint, author→Security→Reviewer→Tester, Node+обязательный UI browser gate, exact Draft publication и encrypted checkpoints. BASE CI проверяется заново между операциями. После публикации script переходит к bounded CI continuation; ledger и расходы не обнуляются.

Расширен только encrypted archive формат task-start; при восстановлении файл остаётся данными, не execution capability. Unknown исходы сохраняются для needs-review. 429 сохраняет charged WAL и initial claim; cold first-task replay запрещён.

## Проверки и ограничения

Добавлено12 regression tests:5 read-only scopes,6 initial-start,1 explicit first-task manifest. Локально22/22 связанных теста PASS. В тестах пройдена цепочка first task→4roles→host checks→publication→CI→следующая задача→CI; это simulated model/API/sandbox и local Git, а не настоящий development run приложения.

Проверены concurrent claim1winner/1loser, копии tickets/CI, запрет native использования simulated, 429/cold replay, неизменность write scope, полные source hashes, отсутствие raw private dependency в model metadata, host node checks по read-only module и явное разделение first-task/continue.

Первый полный CI40511529525 остановился на TypeScript: неизвестный тип ветки CI и потерянное narrowing model config во вложенном executor. Полные тесты были SKIPPED. Типы исправлены; первоначальный failed run не выдаётся за успешную проверку.

Production manifest остаётся не настроен, реальный OWNER mode=read-only-review, used65/remaining0. Ни нового grant, ни запросов Groq, ни записи Calculator/Onay, ни actual budget/state writes не выполнялось. Actual first-task native execution и general autonomous self-repair пока не подтверждены. Main, legal=false и запрет merge/deployment сохранены.

После подтверждения полного CI пункты1–2 готовы в коде/регрессиях. Остаются2 этапа: точный ограниченный development grant с сохранением истории и реальный независимый цикл команды на конкретном исправлении. До запроса grant нужно зафиксировать concrete production plan/history/manifest; schema first-task сама по себе не разрешает запуск.

## Подтверждённые результаты

Исправленный source f399c19e4d75fd955e454bf78538512a8241d60b: [CI40511722021](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40511722021), job122215089120 — pnpm typecheck PASS, pnpm test2686/2686 PASS, failures0. Local22related и11повторных executor cases PASS; exact diff-check PASS. Пункты1–2 завершены в коде/регрессиях; actual native first development/исправление приложения ещё не подтверждены.
