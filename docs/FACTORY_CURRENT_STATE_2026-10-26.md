# Factory: актуальное состояние — 26.10.2026

**Ограниченный шаг9 закрыт: 4/4 подшага.** Общий бюджет, native OWNER активация и расширение, три реальные read-only проверки, отказ нового worker от повторного расхода подтверждены. Полный план0–100 и универсальная автономность этим не закрываются.

[Полный итог](STEP_09_CLOSED_2026-10-26.md) · [Machine proof](../.factory/step9-extended-live-proof-20261026.json).

- T05 уже проверенный Draft-кандидат `558993981c9bbb7c6100c8335860ac5668768314`. Не генерировать/исправлять/публиковать снова без новой задачи.
- Новый OWNER комментарий6413719353 проверен; native extension40307264999 сохранил все3 прежние reservations.
- Live40307399306 SUCCESS: Security/Reviewer/Tester ready:true, Node/Chrome passed, candidate CI подтверждён,3 реальных модельных запроса.
- Native fresh-worker40308016882 SUCCESS: отказ до source/model,14GET/0write/0model, ledger unchanged.
- Полный used65/626530/263359; remaining.requests0. Никакого reset/refund/retry или нового бюджета без отдельного решения.
- Typecheck и2414/2414 tests PASS. Main и приложение неизменны; без merge/deployment. Legal disabled.

Текущий инженерный этап10.7: genuine ответы специалистов и порядок независимых вердиктов готовы; нужны реальные host tests, bounded correction и generic candidate/CI. Общая финальная приёмка Calculator и реальный второй проект не завершены. Onay — отдельное приложение; его дизайн/код здесь не менялись.

## Исторические результаты

Старые failure receipts и отчёты не удалены. Ранний live40296325671 остановился после2 отправок при3 резервах; причина16000vs18000 исправлена. Последующий успех не отменяет эти расходы и не переписывает историю. Ранее подготовленное расширение теперь применено по подлинному новому решению; прежние отчёты со статусом «ждёт approval» относятся к моменту до10:24 UTC.

## Этап10.1: техническая матрица Calculator

11/11 критериев покрыты автоматическими проверками; реальный Chrome проверил5 сценариев. Каждый arithmetic UI случай в реальном браузере и ручная приёмка владельцем пока не подтверждены. Exact-candidate CI/Native head перепроверены чтением;0 новых model calls/Actions. [Полная матрица и границы](STEP_10_01_CALCULATOR_ACCEPTANCE_2026-10-26.md). Следующий инженерный барьер — Calculator-specific авторизация/профиль; нужен host-approved реестр целей и независимый бюджет каждого проекта, без снятия текущих запретов. Код переноса пока не начат.

## Этап10.2: фундамент профилей и бюджета готов

Добавлен host-only реестр неизменяемых профилей; новый репозиторий требует genuine capability и native OWNER документ с подписанным targetProfileSha256. Разные проекты имеют разные namespace; смена профиля того же проекта не сбрасывает ledger. Source c393769, CI40321529096: TypeScript/2428tests PASS, локальные123/123 PASS. Native compatibility40321794272:14GET/0write/0model, старый Calculator used65 сохранён, повтор отклонён. [Полный отчёт](STEP_10_02_PROJECT_PROFILES_2026-10-26.md). Новых production targets0; generic planning/tools/sandbox/CI adapter ещё не подключены, второй проект не запускался. Это следующий инженерный этап, не повод снимать старые allowlist.

## Этап10.3: общий валидатор плана и допуск готовы

Source e405075: цель/критерии владельца, host-derived IDs/branch/profile, проверка DAG/покрытия, bounded16000 metadata context, одноразовый native budget admission с host source/dependency guards. CI40323482182: TypeScript/2445tests PASS, local140/140. [Отчёт](STEP_10_03_PROJECT_PLAN_ADMISSION_2026-10-26.md). Модельный планировщик/универсальный executor, реальные generic guards и весь generic reviews/tests/publication/CI delivery ещё не подключены. Новых моделей/бюджетов/production targets0, main/app/ledger неизменны. Второй проект не запускался.

## Новый дефект Calculator от владельца

Повторные операторы6**2/6*+2 воспроизведены на original handlers (mock DOM): строка принимает их, равно выдаёт ошибку. Это новая незакрытая продуктовая задача; прежние11 критериев не включали этот случай. T05 не повторять. [Диагностика и задача](CALCULATOR_INPUT_DEFECT_2026-10-26.md). Агент не запущен, квота0, source unchanged. Нужны отдельный task/development allowance и полная проверка исправления; generic execution pipeline ещё не подключён.

## Этап10.4: общий транспорт модели проверен

Source e1e86a5, CI40337212062: TypeScript/2460tests PASS; local185/185,15 новых. Native-branded admission→shared reserve→hash-only checkpoint→mock Groq HTTP, terminal429/truncation/failure, fresh-controller replay отказ. Починен generic ID project-task→project-run, scanner не ослаблен.0 live models/real budget writes/app changes. [Отчёт](STEP_10_04_GENERIC_MODEL_TRANSPORT_2026-10-26.md). Actual generic source/context/proposal validator и полный author/correction/role/host/CI pipeline ещё не подключены. Квота0, новый проект не запускался. Новый input defect Calculator включает и leading zeros; repair не запускать без нового task/development allowance.

## Этап10.5: source snapshot и proposal gates проверены

Source7ad340f, CI40341767562: TypeScript/2476tests PASS; local201/201,16 новых. Реальный native40342235253:6 Calculator source blobs/11284bytes verified, absence из полного tree, copied snapshot/foreign workflow proposal отказ,22GET/0write/0model. Полные source/proposal bytes остаются private; metadata only по умолчанию. [Отчёт](STEP_10_05_SOURCE_PROPOSAL_GATES_2026-10-26.md). Далее selected context packet binding и общий независимый role/correction/host/CI pipeline. Actual repair Calculator/второй проект не запускались, квота0.

## Этап10.6: selective context и запрос связаны

Sourceb597f4d, CI40350249664: TypeScript/2489tests PASS; local214/214,13 новых. Private packet→genuine plan/task/snapshot budget binding, exact body guard, explicit unshown ranges, overflow/full-source/message injection отказ. Native40350695171: request3538bytes/6unshown ranges, altered body отказ,28GET/0write/0model. [Отчёт](STEP_10_06_CONTEXT_BINDING_2026-10-26.md). Role verdict/phase ordering, actual host-test proof/correction и полный generic pipeline ещё не подключены. Реальных моделей/нового allowance0; Calculator repair не запускался.


## Этап10.7: genuine ответы и порядок специалистов

Source b1be5a9e8a8662fe37c8ec2d951d2c2bc45aafe7, CI40374169083: TypeScript и2501/2501 tests PASS. Local165/165;12 новых regression tests. Raw reply приватен; hashes связывают задачу/source/request/роль. Только ответ автора создаёт предложение; Security→Reviewer→Tester требуют то же genuine предложение и положительный разобранный предыдущий verdict. Подмена/повтор/пропуск/неразобранный verdict/stale source останавливают без повтора и refund. Модельное одобрение не означает реальные тесты/CI: эти gates остаются false. [Полный отчёт](STEP_10_07_SPECIALIST_REPLIES_2026-10-26.md). Далее host test receipt, bounded correction/restart, generic candidate/CI delivery и отдельный native allowance.0 real models/budget/app writes; main/app/ledger сохранены, legal disabled.
