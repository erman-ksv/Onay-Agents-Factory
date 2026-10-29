# Шаг 9.4: опубликованный кандидат через обязательный project budget

> Исторический срез до подтверждения владельца. После него 9.3 реально активирован; live остановлен на локальной границе контекста, исправление прошло 2402 теста, новых вызовов после исправления нет. [Актуальный итог](STEP_09_OWNER_ACTIVATION_AND_LIVE_REVIEW_2026-10-26.md).
26.10.2026. **Код соединён и протестирован; настоящий модельный запуск ещё не выполнялся. Шаг 9 не закрыт.** T05 уже опубликована и проверена; её генерация/исправление/публикация не повторяются.

## Исполнитель

`runPublishedCalculatorProjectReview` использует подлинный `AuthorizedProjectBudgetController`, требует operationMode=read-only-review и неизменную идентичность проекта/плана. Поддельный объект и development-mode отклоняются. Допуск ограничен ровно тремя оставшимися запросами, максимум 72000 дополнительных байтов и 18000 reserved tokens; текущие used должны точно совпадать с полной историей. Уже потраченный резерв, даже другим экземпляром контроллера или для другого кандидата, не обнуляется.

Стабильный execution ID зависит от плана, задачи и candidate SHA. Кандидат/PR/CI проверяются до каждого HTTP и после асинхронных операций. Восстановленный read-only proposal проходит прежний валидатор; подлинное evidence создаётся только обычными host Node/browser runners. Три независимых Security → Reviewer → Tester используют `createCalculatorProjectRuntimeTeam` с обязательным shared ledger. Перед HTTP выполняются owner/source проверки и приватная контрольная запись; remote CAS reservation происходит в существующем бюджетном адаптере. Нет вызовов generate, repair, publish или initialize.

Любой отрицательный verdict, ошибка, 429, сбой persist или утрата источника завершают фазу. Нет автоматического повторения, четвёртого запроса, компенсации резерва или переписывания прежнего T05 receipt. Результат трёх ревью не даёт права публикации и не означает готовность всего приложения.

## Подключение к настоящему host

Расширен уже проверенный `calculator-published-candidate-preflight.mjs`. При обычной проверке модельные/writer ключи по-прежнему запрещены. Только новый режим review с конкретным ownerDecision может создать native GitHub controller, проверить уже инициализированный ledger и затем использовать реальные Node/Chrome проверки и обязательный router. Все обращения к Calculator остаются GET. Writer token нужен только фиксированному Factory ledger; Groq transport ограничен тремя отправками на один endpoint. Полный исходник и приватные checkpoints не загружаются в публичный artifact; сохраняется только source-free result.json. Private checkpoint остаётся на временном worker, durable сохранность расходов/запрета повтора обеспечивается remote ledger; возобновление с приватным архивом не заявляется.

Новый workflow `published-project-review.yml` разделяет request/inspect/review jobs. Inspect имеет только read permissions и не получает модельные ключи. Review с contents:write/actions:read и GROQ_API_KEY выбирается только при operation=review и непустом структурном ownerDecision; это не заменяет последующую настоящую проверку автора/текста/срока комментария и ledger внутри host. Runtime checkout закреплён на протестированном SHA. Модельные полномочия по произвольному JSON/переменной окружения не появляются.

Текущий `.factory/published-project-review-request.json`: **operation=inspect, ownerDecision=null**. Привилегированный review job должен быть skipped. Пригодный текущий кандидат уже подтверждён настоящими Node/Chrome/CI в run 40291832282; новый inspect не повторяет эти неизменённые проверки.

## Проверки

Source SHA: `32bdcfdea5cc8191671b1a85b7a38561f8a7d9ee`. [CI 40294407754](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40294407754), job 121476842376: **pnpm typecheck PASS, pnpm test 2400/2400 PASS, ошибок 0**. Лог прочитан.

Локально **28/28** связанных регрессий, включая 8 новых: три review с reservation до HTTP; подделка/mode; источники/реальные host checks/до-HTTP persist; 429 без повторения с сохранением списания; новый controller и replay; отрицательный verdict без автора; gate metadata/getters; другой candidate без нового бюджета. Happy path использует настоящие контроллер/router/ledger с mock HTTP и mock host runners — это не новый живой модельный запуск. Script node --check проходит; локальная установка зависимостей не выполнялась.

Настоящий новый workflow [40294860705](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40294860705): request `121478331530` PASS, inspect `121478382111` PASS, привилегированный review `121478384479` **SKIPPED**. Native отчёт: **blocked-owner-approval-missing**, ownerApprovalVerified:false, projectBudgetActivated:false, 1 GET, 0 mutations, 0 modelCalls. Runtime SHA и source CI проверены. Это доказательство безопасного gate, не живых трёх ревью. Metadata artifact `12636859742`, 470 байтов; output ZIP не скачивался/не пересчитывался.

## Что требуется для разрешённого запуска

1. Владелец проверяет и публикует неизменённый JSON из `.factory/proposed-project-budget-approval.json` отдельным комментарием от erman-ksv в Factory PR75. Документ пока НЕ активен: только 3 дополнительных Free Groq запроса, до 18000 reserved tokens, read-only-review, срок до 01.11.2026 00:00 UTC. Полная история — 59 запросов/553908 байтов/230413 reserved tokens; новые потолки — 62/625908/248413. Не трактовать обычное «Продолжай» как согласование нового расхода.
2. Проверить native comment ID, тело/digest, неизменность, OWNER и срок; записать конкретный ownerDecision в отдельный operator initialize request. Явно инициализировать ledger полной историей, без reset. Модельные ключи оператору initialize не нужны.
3. Только затем изменить новый request на review с тем же ownerDecision и выполнить ограниченные три ревью через общий счётчик. Проверить remote reservations, итог, отрицательный/дублированный запуск. Реальный HTTP или model verdict не подменять mocks.

Это именно оставшиеся 9.3 (решение/активация) и 9.4 (live proof), а не новая задача по переделке Calculator. Main, merge/deployment, код Onay/Calculator не изменены; юридический агент выключен. Codespaces, платные API и новые вспомогательные агенты не использовались.
