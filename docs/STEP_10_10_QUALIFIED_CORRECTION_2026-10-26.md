# Этап10.10 — допуск одной попытки исправления

26.10.2026. Развитие подготовленного handoff из этапа10.9; ни один реальный запрос модели или новый owner grant не выполняется.

## Что изменено

Genuine задание на исправление после подготовки контекста можно связать с native-authorized development controller того же проекта, плана, владельца и профиля. Допуск повторно проверяет owner approval, исходники и зависимости. Нужны минимум4 оставшихся запроса и запас контекста на весь новый цикл; это preflight, а не новая квота. Каждый реальный запрос по-прежнему отдельно проходит durable reserve-before-HTTP.

Попытка исправления имеет один стабильный execution ID для task+plan+correction-1, независимо от текста ошибки, grantId и содержимого исправления. Она использует **тот же project ledger**, не сбрасывает предыдущие счётчики и не повторяет запросы первой попытки. Допуск и handoff одноразовые; копии JSON/чужие/повторные/параллельные заявки не могут разрешить второй расход. Третья попытка не допускается.

Первый запрос нового transport принимает только собственный genuine correction packet. Автор должен вернуть новое bounded предложение относительно ORIGINAL source SHA. Повтор отклонённого кода, даже с другой summary, не принимается. Затем заново требуются Security→Reviewer→Tester по тому же новому предложению и настоящие host tests; прежние одобрения не наследуются.

Новая per-attempt TPM память не должна забывать прошлые запросы: перед первым запросом исправления выдерживается полное консервативное окно60секунд. Ожидания разбиты на части до15секунд с повторными owner/source/context guards. После этого прежний GroqPacer контролирует запросы внутри новой попытки. В тестах часы виртуальные; реальная допустимость по общему аккаунту Groq/нескольким серверам этим не подтверждена.

HTTP429, повреждённый ответ, source/owner loss, uncertain checkpoint и исчерпание бюджета останавливают попытку. Уже записанные резервы сохраняются, авто-retry/refund/reset не добавлены. Native-controller/profile/role/secret/patch/CI ограничения не ослабляются.

## Проверки

- Локально **201/201** целевых тестов, **12 новых** regression tests. Source/context/reply/Node группа77/77.
- Typecheck/полный CI: [CI40381213998](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40381213998), source `90427ef4784baefd4347d37048cbc232166c074d`, job121777628306: **pnpm typecheck PASS; pnpm test2537/2537 PASS, failures0**.
- Комбинированный Docker audit: [Audit40381534393](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40381534393), job121778760980: **SUCCESS**. Первая genuine proposal провалила настоящий host test; handoff→qualified correction→новый author+3reviews→настоящий host test прошёл.8 имитированных ответов модели,2 настоящих Docker проверки, temporary ledger4→8/remaining0,2 distinct stable execution IDs, один неизменный host oracle SHA. Runtime Node proof accepted; browser/CI/publication/wholeApp false. Суммарное виртуальное ожидание180000ms, без реальных запросов модели.
- Точный diff: **git diff --check PASS**; 11 files changed, 330 insertions(+), 27 deletions(-)..

Regression tests покрывают успешный новый четырёхролевой цикл и накопление старых расходов, недостаток запросов/байт/токенов до запуска, forged/getter/concurrent admission, mismatch author packet, no-op/metadata-only/bad SHA patch, второй отрицательный verdict без третьей попытки, HTTP429 с сохранённым резервом, owner/source loss во время cooldown, uncertain checkpoint и повторное использование допуска.

## Границы результата

Модель и owner approval в combined audit **имитируются**, ledger временный локальный, проект/исходники синтетические. Docker/host tests настоящие; ожидаемый ответ host policy не меняется. Это проверка механизма исправления, не реальный Groq запуск, реальное разрешение владельца или разработка второго приложения. Actual model/budget/app writes0; текущая настоящая remaining.requests0 остаётся прежней.

**Durable сохранение и восстановление коррекции пока не подключены.** Stable IDs и write-ahead ledger защищают от повторного расхода, но JSON checkpoint не воссоздаёт genuine authority после перезапуска. Пока такой случай должен безопасно остановиться. Далее нужны authenticated recovery и generic candidate publication/exact-CI delivery/deduplication, отдельный planning/live allowance и реальный прогон. Browser/device/Expo и выпуск Onay отдельно не подтверждены.

Main, Calculator и настоящий ledger сохраняются; никаких app fixes, merge/deployment, Codespaces, paid APIs, локальной установки зависимостей или новых агентов. Legal disabled. Старые failure receipts и расходы не удаляются. GitHub audit использует ранее выбранный pinned Node image и не получает provider/writer secrets.

[Машинный отчёт](../.factory/project-correction-attempt-proof-20261026.json).
