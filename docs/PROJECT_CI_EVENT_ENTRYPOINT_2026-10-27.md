# Холодный обработчик события CI

Host API: `runProjectCiEvent(options, body)` в `orchestration/projectCiEventEntrypoint.ts`. Это соединение существующих компонентов восстановления, независимой проверки CI и durable dispatch. Автоматический workflow ещё не активирован.

## Доверенные входы host

Host bootstrap передаёт genuine prepared plan, development controller над **существующим** ledger, immutable CI/node policies, ключ из `loadProjectRuntimeRecoveryKey`, native state-protection capability, native checkpoint archive с последним доверенным non-null pin и свежий пустой каталог 0700. Реальные repositories, paths, критерии, policy, callbacks и разрешения не берутся из event/model JSON. Контроллер должен совпадать со всеми полями identity плана. Копии capability не принимаются. `initialize()` не вызывается.

Реальный encrypted intent первого опубликованного кандидата должен уже находиться в этом archive. Legacy кандидат Calculator T05 не переигрывать и не подменять synthetic intent. Отдельное bootstrap-подключение текущего/нового production плана остаётся необходимым.

## Недоверенное сообщение

Relay передаёт строку JSON до 2048 bytes, ровно поля `version:1`, `repository`, `branch`, `candidateSha`, `runId`, `runAttempt:1`, `conclusion`. Это уведомление, а не доказательство успешного CI. Дополнительные поля/source/grant/callback и rerun attempt отклоняются. Чужой repository/branch и failure/cancelled/timed_out игнорируются без hydration, journal claim и model request.

Нативный relay/workflow, его аутентификация и bootstrap текущего production плана не считаются настроенными по наличию этого API.

## Последовательность

1. Проверить genuine host capabilities, development mode и текущий OWNER approval; прочитать существующий бюджет, не сбрасывая историю.
2. Свежей native проверкой подтвердить защиту обоих state namespace. Потребовать существующий archive и trusted pin.
3. Восстановить только authenticated ciphertext в отдельные journal/runtime directories.
4. Если authenticated journal уже содержит этот кандидат и ту же CI policy, вернуть `already-recorded`, даже когда feature branch продвинулась. Не повторять модели, HTTP или push.
5. Найти ровно один authenticated publication intent для candidate SHA; read-only native восстановлением проверить реальные tree/blobs/parent/head/Draft PR.
6. Нативно собрать CI по immutable workflow pins и нужным job/steps. Сопоставить run ID **и attempt, реально прочитанные collector**, с событием. Поддельный success либо номер попытки не заменяет evidence. JSON-копия evidence не имеет capability.
7. Передать genuine confirmation существующему runtime. Durable remote claim записывается до исполнения следующей задачи. Дальше действуют четыре независимые роли, host tests, source/dependency/owner checks, reserve-before-HTTP, cooldown и guarded publication.

Результат включает metadata/status и latest archive pin; host обязан сохранить этот pin вне rollback-prone cache. Неопределённый результат остаётся needs-review. Автоматических повторов, новых grants, budget reset, republish или merge нет. Production API использует fixed adapters; `ForTests` всегда остаётся simulated.

## Проверки и границы

Добавлены 10 регрессионных тестов: холодное восстановление и один successor; duplicate после смены head; foreign/failed notices; malformed/oversized/extra fields; реальный collector против ложного success/run ID; copied capabilities и simulated archive против native; отсутствующий pin/intent; terminal429 и холодный duplicate без второго расхода; отсутствие source/ответов/секретов в metadata; revocation/nonempty directory; несовпадающий стабильный attempt2 и его JSON-копия.

Локально прошли 27/27 связанных тестов. Git diff --check PASS. В этих тестах API, ответы модели и sandbox receipt синтетические; локальные Git, зашифрованные файлы, ledger и последовательность реальны. Это НЕ production model run и НЕ приёмка приложения.

Ключ отдельно подтверждён между двумя GitHub runners: Actions40493328418. Ruleset25942828 native verified. Действующее OWNER разрешение — read-only-review, used65, remaining0. Новый обработчик не активирован с этим разрешением. Legal=false, main/app/budget refs не менялись.

Полный CI source9bb0db2a881a2bdb33092899a1f9e840744d55ff: [Actions40494408921](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40494408921), job122156089993 — pnpm typecheck PASS, pnpm test2644/2644 PASS, failures0. Изменены3 source/test files:182insertions/1deletion; exact source diff-check PASS.
