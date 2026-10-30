# Manual launcher для одной реальной приёмки этапа 8

Основа: `90b204bfebcf4d412583a7e2e8e8ddb33eec79e8`, tree `21a0dc82b86408c22e460463f1eca14607c80667`. Его полный CI41098187378:2862 PASS, typecheck PASS; настоящий read-only preflight41098187434:PASS. Это доказательства предыдущего SHA, не нового launcher.

## Подготовлено, но не опубликовано и не разрешено к запуску

Новый workflow `.github/workflows/stage8-rejected-proposal-live.yml` имеет единственный trigger `workflow_dispatch`. Нет push/schedule/repository_dispatch/workflow_run, matrix, retry или автоматического активационного commit. Concurrency фиксирована на проект, cancel-in-progress=false. Два job: read-only preflight и зависящий от его успеха accept. Только последний шаг accept получает provider credentials/state token и вызывает ровно один существующий `scripts/project-rejected-proposal-host.ts --live`.

Новый `projectRejectedProposalLiveLaunch.ts` — проверка допуска launcher, не новая возможность Factory и не замена Host. До ключа восстановления/AI-ключа он проверяет настоящий manual event, erman-ksv actor/triggering actor, run_attempt1, точный branch/SHA/workflow, неизменный checkout и отсутствие изменений проверенного Host/corrective loop/manifest/config относительно90b204b. Разрешены только7 новых файлов данного патча. Проверяет полный CI точного нового SHA (Install,Typecheck,Test), два OWNER-комментария, текущий бюджет и checkpoint13. Внешние обращения только GET GitHub, без retry, с лимитом12 GET и120сек; возвращается только DATA с executionAuthorized=false.

В job preflight после допуска выполняется настоящий существующий read-only Host. В accept проверки повторяются до подготовки образов и непосредственно перед AI-ключом. Node/browser Docker images закреплены digest из неизменённого manifest. Реальный Host затем заново проверяет OWNER/evidence/source/ledger и делает единственный durable CAS claim. Неизвестный HTTP, потерянный ACK, crash после claim, повторный ticket, Security blocked и повторный invalid результат требуют остановки, без нового permit/replay. Ledger/history/checkpoint не сбрасываются.

## Два отдельных OWNER-документа

1. `OWNER-recovery-DRAFT.json` — точный новый admission существующего authorizer: одно новое предложение Coder и три независимые проверки, максимум4 запроса; checkpoint13, исходный5589939, новый executionproject-run-2d43cb3c8c822b8f45adc66c17874408. Canonical body SHA-256: `32d1809679fc5f4b88ae5d21314e472e3cd3925cc5f492a02c3b2d1314cd5549`. Это ещё не опубликованный OWNER comment и не permit.
2. `OWNER-launch-DRAFT.json` — отдельное разрешение именно на старт manual launcher: конкретный новый source SHA, путь workflow, recovery commentId, те же manifest/checkpoint/ledger и максимум8 запросов на весь цикл. Поля sourceSha и recoveryOwnerDecision.commentId сейчас null: будущего commit и подлинного комментария ещё нет. Такой draft не проходит проверку допуска. Его нельзя подписывать/публиковать в этом виде.

После отдельного согласия на публикацию launcher необходимо дождаться полного CI нового SHA. Затем реальный OWNER erman-ksv публикует первый точный JSON новым неизменённым комментарием в PR75. Оба решения должны быть новыми после завершения CI данного source SHA. После получения recovery commentId точный второй JSON генерируется без API-вызовов:

```sh
pnpm exec tsx orchestration/projectRejectedProposalLiveLaunch.ts --draft EXACT_PUBLISHED_SHA RECOVERY_OWNER_COMMENT_ID
```

Второй JSON OWNER отдельно проверяет и публикует новым неизменённым комментарием в PR75. Его source SHA нельзя угадать до создания commit; launcher сам не создаёт OWNER-комментарии и не заполняет approvals. Raw recovery document не расширяется: существующий authorizer отверг бы новый code-SHA field. Поэтому старт exact-code launcher подтверждается отдельным документом. Он проверяет допуск к старту; постоянно действующим разрешением исполнения остаются recovery admission и настоящие бюджетные OWNER-решения, которые Host перечитывает перед операциями. Для немедленного отзыва исполнения необходимо отозвать recovery admission; удаление только launch-комментария после старта не заменяет этот механизм.

В manual dispatch нужно выбрать фиксированную рабочую ветку, указать тот же exact source SHA, оба commentId и точную confirmation `ONE_REJECTED_PROPOSAL_AND_SUCCESSOR_MAX_8`. Manual dispatch, публикация кода и настоящий AI-запуск требуют отдельных согласований. Текущее задание разрешает только подготовку: ничего из этого не выполнено.

## Срок и бюджет

Срок existing Host scope, budget OWNER и обоих draft: **30.10.2026 23:59:59UTC**. На момент подготовки30.10.2026 17:32UTC он ещё действовал. Срок не продлевался. Gate останавливает истёкший scope до HTTP; Host также проверяет expiry при операциях. Если срок истечёт до публикации/CI/новых комментариев, эти документы нельзя применять. Потребуется отдельное согласование актуального scope и действительности всей grant lineage, сохраняя историю; launcher не обновляет expiry, grant, расход или лимит автоматически.

Учтено71 requests/655866 bytes/281875 reserved tokens; осталось15/186739/92790. Первое восстановление4/48000/24000, successor после подтверждённого CI ещё4/48000/24000; максимум8/96000/48000. Остаток после worstcase7/90739/44790. Ceilings86/842605/374665 сохраняются. Ни budget extension, ни дополнительный corrective retry не подключены.

## Продолжение после CI и доказательства приёмки

Существующий Host после успешного Coder/Security/Reviewer/Tester, native Node/browser и Draft передаёт exact candidate SHA и настоящий grant lineage в `runProjectCiContinuation`. Он независимо подтверждает кандидатный CI, сохраняет delivery claim и допускает вторую из2 утверждённых задач. Защиты от двойного исполнения/списания находятся в неизменённых Host/CAS/ledger и проверяются существующими regression tests.

Новый gate имеет тесты с фиксированным временем и синтетическим HTTP-транспортом. `projectRejectedLiveState.json` содержит source-free ledger и зашифрованный checkpoint из публичных pinned commits868e730/79e01d0; plaintext ответа и recovery key там отсутствуют. Мок-ответы проходят настоящие парсеры, вычисление digest, проверку ciphertext и OWNER-метаданных. ForTests receipt явно simulated и не создаёт native capability. Эти тесты не являются доказательством настоящей AI-приёмки.

До закрытия этапа нужно отдельно зафиксировать реальный новый Coder результат, все независимые решения, native Node/browser, Draft, exact candidate CI и автоматический переход/результат следующей задачи. Статусы awaiting-ci, ci-failed или остановка Host не являются завершением этапа.

Отдельный read-only postcheck launcher требует status=plan-ci-recorded, два разных candidate SHA, durable archive pin и ровно8 новых учтённых запросов (71→79), bytes/tokens в пределах96000/48000. Обычный exit0 Host при awaiting-ci не пройдёт этот check. Если postcheck не прошёл, результат и checkpoint сохраняются; повторные AI-вызовы запрещены. Даже успешный postcheck не заменяет независимое чтение реальных CI/результатов при итоговой приёмке.

## Операционный блокер manual workflow

GitHub требует наличия workflow_dispatch workflow в default branch для получения manual dispatch events. На проверенном main0752de6 имеется только README.md; нового workflow там нет. В этом задании main менять запрещено. Поэтому подготовка и отдельный push рабочей ветки не считаются доказательством доступности manual dispatch. Регистрацию/доступность запуска нужно отдельно разрешить и подтвердить поддерживаемым способом. Нельзя обходить блокер добавлением push-trigger для live, изменением default branch или самовольным изменением main.

## Граница готовности

Полный typecheck/test launcher и новый CI должны быть подтверждены после отдельной публикации, если локальное окружение остаётся без зависимостей. Успешные2862 предыдущегоSHA не подменяют эти проверки. Ни коммит/push, ни dispatch, ни реальные AI-вызовы, ни OWNER/budget/state writes в ходе подготовки не разрешены. Этап8 остаётся BLOCKED до реальной приёмки и автоматического продолжения после CI.
