# Продолжение плана в одном ограниченном запуске

## Результат

Добавлены native host bootstrap, закреплённый manifest и ограниченный цикл ожидания CI. Активный runner может сам дождаться CI кандидата, передать событие холодному обработчику, выполнить следующую задачу через четыре роли и проверить CI нового кандидата. Между этими переходами второй ручной старт не требуется. Опрос CI сам не обращается к модели.

Это альтернатива relay через default-branch GitHub Events: main остаётся неизменным, приложение и его workflow также не изменяются. Отдельные сервер, Codespaces и платный API не добавлены. Публичный Factory Actions используется в пределах действующей бесплатной конфигурации аккаунта.

## Что реализовано

- `projectRuntimeManifest.ts`: JSON host-конфигурация до64KiB, SHA256 pin из доверенного workflow, opaque capability, точный profile/goal/plan/history/OWNER decision/CI pins/node policies/selections/existing archive pin. Копия capability не работает. История всех scopes обязательна. Source/keys/commands из event не принимаются. Node policies остаются host-only; legal/merge не включаются.
- Native bootstrap: authenticated OWNER development approval, только inspect существующего ledger, минимум4requests/48000requestBytes/24000reservedTokens перед стартом, native state protection, existing archive с non-null trusted pin, постоянный recovery key. Никаких initialize/нового grant/автоматической ротации. OWNER approval проверяется заново в ходе выполнения.
- `projectCiContinuation.ts`: до12 опросов, пауза10–15секунд, не более10минут по monotonic clock. В production используются fixed native adapters. Каждый успешный poll сверяется с immutable CI policy и реальным attempt, затем cold entrypoint независимо проверяет CI ещё раз. Durable claim и encrypted persistence предшествуют task execution. Failed CI/429/uncertain outcome не повторяются; duplicate не расходует запросы снова.
- `scripts/project-ci-continuation.mjs`: fixed manifest path, independently pinned digest, no-follow bounded file read, native bootstrap и runner. В stdout только metadata/latest acknowledged archive pin; ключ уничтожается в памяти по завершении. Ошибка не выводит source/model reply/token.
- Feature-only workflow `.github/workflows/project-ci-continuation.yml`: push marker включает один запуск; immutable checkout; provider/Git/key credentials передаются только после проверки host manifest. Пин manifest намеренно не настроен, поэтому runtime/model шаги должны пропускаться. Marker не может выдать allowance или выбрать scope/pin/command.

## Проверки

12 новых regression tests:7 bounded continuation и5 manifest/host checks. Вместе с cold-event тестами локально22/22 PASS. Модели/API/sandbox в этих тестах simulated; реальные локальные Git, ciphertext, ledger и порядок операций проверяются. Это не запуск реального приложения или Groq. Script syntax и isolated exact git diff --check PASS.

## Что пока не закрыто

1. **Конкретный production manifest и разрешение.** Закрепить реальный owner goal/plan, подходящие acceptance gates, настоящий candidate intent в archive и latest trusted pin; добавить отдельный точный OWNER development grant с ограниченным allowance, сохранив все65 прежних расходов. Действующее разрешение read-only-review/remaining0 не подходит. Завершённый CalculatorT05 не перезапускать. Для UI/Expo нужны независимые browser/device gates — Node contracts не заменяют такую приёмку.
2. **Реальный подтверждённый цикл.** После разрешения включить независимо pinned manifest в immutable workflow и подтвердить настоящий model→Security→Reviewer→Tester→host tests→publication→CI→next task. Сейчас только тесты механизма; general production autonomy не закрыта.

Активное ожидание ограничено одним runner job. Если CI не завершился в пределах окна, возвращается awaiting-ci с сохранённым pin. Самоперезапуска/вечного фонового poller нет. Новый cold старт после остановки требует сохранённого последнего trusted pin и действующего allowance; unknown HTTP/push/state не переигрывается. Полное межрепозиторное событие после завершения runner job отдельно не активировано.

Main, код Calculator/Onay, текущие project budget/state refs не менялись. Новых реальных provider calls0. Legal=false.

## Точные результаты

Source b8ffbf6b5e4020af5c006f19e559d1e11a959ec7: [CI40496129660](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40496129660), job122161907187 — pnpm typecheck PASS, pnpm test2656/2656 PASS, failures0.

[Native launch guard40496458547](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40496458547), job122163029675 — ожидаемый статус blocked-host-manifest-not-configured. Runtime и image шаги SKIPPED;0provider/app/budget/state writes. Workflow SUCCESS означает успешную проверку безопасной остановки, а НЕ реальный запуск команды. Новых keys/allowance не создавалось.
