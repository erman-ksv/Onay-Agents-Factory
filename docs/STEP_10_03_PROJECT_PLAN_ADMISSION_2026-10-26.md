# Этап10.3 — общий план и допуск задачи

26.10.2026. Законченный блок: общий валидатор плана и привязка допуска задачи к genuine profile/native budget. Это не заявление, что универсальный исполнитель или второй живой проект уже работают.

## Реализовано

- `projectPlan.ts`: цель владельца содержит его критерии и обязательные пути. Репозиторий, ветка, ID, requirements/owner/plan fingerprints выводятся host-кодом из подлинного target. Модель предлагает только tasks/blockers/unverifiedAreas. Чужие пути, роли/ID/репозитории, циклы и неупорядоченные общие файлы отклоняются. Неполное покрытие критериев/файлов даёт blocked, а не completed.
- План не считается источником доказательств: source/dependencies/reviews/tests/CI/delivery явно остаются unverified. План и goal frozen и зарегистрированы в private WeakMap; их JSON-копия не даёт права допуска.
- Planning context — только ограниченные метаданные/критерии, без полного кода; максимум16000 UTF8 байт. Переполнение вызывает явный отказ без обрезания критериев, повторения задачи или расходов. Input ограничен размером/глубиной/числом узлов, getters/sparse/extra fields отклоняются без вызова getter. Реальный provider token-budget/pacing сохраняется в прежнем runtime; новый model transport не добавлен.
- `projectExecutionAdmission.ts`: unblocked plan допускается только с настоящим native controller в development, точными project/repo/owner/plan/profile/task identity и минимумом4 оставшихся запросов. Read-only grant или чужой контроллер не подходит. Сохраняется детерминированный execution ID; scope одноразовый.
- Доверенный host должен предоставить assertSource и assertDependencies. Они проверяются повторно с native owner check до/после асинхронных операций; после consume guard доступен будущему executor для проверки перед каждым request/tool. Ошибка, ложное JSON evidence, повтор, потеря owner/source и конкуренция терминальны. Допуск не отправляет HTTP модели, не списывает резерв, не инициализирует ledger и не публикует приложение. executionAuthorized:false сохраняется до следующих реальных gate.

## Проверки

Source `e405075c36538cc3ea1b31c9688ad2b14467d991`. [CI40323482182](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40323482182), job121574084870: **pnpm typecheck PASS, pnpm test2445/2445 PASS**, failures0. Связанные локальные регрессии **140/140 PASS**,17 новых. Старые Calculator сценарии/ожидаемые ответы не менялись. В новой проверке overflow исходный пример не достигал лимита; исправлена величина синтетического примера, фактический overflow теперь проверен. Полный exact isolated diff check PASS.

Тесты используют synthetic note-project requirements и mock native owner/source/dependency callbacks. Это настоящий новый код с unit/integration проверками, не реальный source read, модельный запуск или CI второго приложения. Прежний native Calculator proof сохранён отдельно. Новых production targets/grants/model calls/budget writes/application writes0.

## Что осталось до универсальной команды

1. Связать цель с ограниченным вызовом планировщика и явно разрешённой до-плановой квотой: итоговый native project grant привязан к готовому plan fingerprint, поэтому вызов планирования нельзя молча взять из ещё не существующего плана.
2. Подключить к профилю настоящие GitHub snapshot/dependency guards, модельную генерацию и ограниченную коррекцию с reserve-before-HTTP, stop429, checkpoint и защитой от повтора.
3. Перенести все обязательные Security/Reviewer/Tester, реальные sandbox/browser tests, разрешённую публикацию кандидата, exact-candidate CI и доставку события без Calculator-specific допущений. Допуск этой версии не заменяет ни один из этих gate.
4. После конкретной цели/репозитория и отдельного owner allowance подтвердить второй живой проект с начала до конца. Новое содержимое плана/profile fingerprint требует нового явного native решения и полного исторического учёта; этот модуль не переносит и не сбрасывает старый ledger автоматически.

Main `0752de6cf757c833417754bfe7f9a10fd654dbd9`, Calculator `558993981c9bbb7c6100c8335860ac5668768314`, ledger `b139646c2f359fe23f213e0a3227aa99dd84f369` перепроверены и неизменны. Текущий бюджет used65, remaining.requests0. Onay — отдельное приложение; его код не менялся. Без merge/deployment, платных API, Codespaces, локальной установки зависимостей или новых агентов. Legal disabled.

[Machine proof](../.factory/project-plan-admission-proof-20261026.json). Общий план Factory0–100 и универсальная автономность остаются открыты; ограниченный шаг9 закрыт и не переоткрывается этим новым этапом.
