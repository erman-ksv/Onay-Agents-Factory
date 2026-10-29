# Конкретный запуск: разрешение пока не выдано

## План для владельца

Новая ветка Calculator: feat/calculator-agent/calculator-input-repair-20261027. База:558993981c9bbb7c6100c8335860ac5668768314. Завершённый T05 не перезапускается.

1. Frontend исправляет повторные/заменённые операции и ведущие нули только в src/app.mjs. Сохраняются отрицательные operands/results, десятичные числа, кнопки и клавиатура. Далее независимые Security/Reviewer/Tester,6 arithmetic host checks,25 input+5 existing browser checks, Draft candidate и exact CI.
2. Только после успешного CI первая задача передаёт управление второй: Frontend дописывает regression tests в test/ui.test.mjs. Существующие байты файла и ожидаемые ответы менять нельзя: новый append-only guard отклонит замену/удаление. Повторяются независимые роли, host checks и candidate CI.

index.html/styles.css/src/calculator.mjs — read-only dependencies. Никаких изменений Onay, main, workflow приложения, merge, deployment или юридического агента.

## Предлагаемые пределы, не новое разрешение

| Величина | Ранее использовано | Дополнительно максимум | Общий предел |
| --- | ---: | ---: | ---: |
| Запросы |65|8|73|
| Request bytes |626530|96000|722530|
| Reserved tokens |263359|48000|311359|

Groq Free, qwen/qwen3-32b, до12000bytes в одном request, существующий context guard до6000reserved tokens/request.8запросов=2задачи×(author+Security+Reviewer+Tester). Это один ограниченный проход каждой задачи, не обещание автоматического исправления любой ошибки. При429, truncated/malformed reply, failed review/test, unknown push/state или нехватке бюджета — остановка и сохранение расходов, без повтора всей задачи/возврата charges/нового allowance. Для дополнительного исправления потребуется отдельное проверяемое решение, не скрытый retry.

Разрешение предлагается до30.10.2026 23:59:59UTC. Без owner comment native start не разрешён. Ни бюджет, ни app branch сейчас не создавались.

## Сохранение старой истории

Новый план имеет другой fingerprint. Поэтому старые65запросов нельзя назвать нулевой историей или новым planning. В history добавлен явный carryover старого полностью исчерпанного ledger30aba2ef…: head b139646c2f359fe23f213e0a3227aa99dd84f369, точный старый grant, used65/626530/263359 и evidence SHA полного состояния со всеми6reservations, включая прежние неудачи. Старые59исторических расходов также сохранены в старом grant.

Native owner authorization читает источник через fixed GitHub store, проверяет head/revision, grant SHA, точные totals и digest каждого reservation. Перенос разрешён только из исчерпанного источника; изменения старого ref после подготовки останавливают новый допуск. Исходные counters/records не удаляются, не переписываются и не возвращаются. Новые planning/tasks имеют честные historical0,65старых charges учтены отдельно как carryover. Новый ledger без native owner decision не инициализируется.

Review fragments выбираются по действительному diff proposed file, а не прежним абсолютным offsets: reviewers получают bounded changedWindow и явные unshown areas. Никакой полный приватный source по умолчанию не отправляется.

## Файлы и подтверждение

- .factory/input-repair-launch-package-20261027.json — полный предложенный plan/history/policies, ownerDecision=null. Это не активный runtime manifest.
- .factory/proposed-input-repair-owner-approval-20261027.json — точный текст предлагаемого OWNER comment.
- docs/helpers/input-repair-approval-20261027.html — offline кнопка копирования raw JSON, без сети/storage/автоматической отправки. Ключей не содержит. JS syntax/CSP hash проверены; выполнение на устройстве владельца отдельно не утверждается.

Проверка Factory принимает только unedited authenticated OWNER comment от erman-ksv на PR75 с exact body digest; произвольный JSON/env не является разрешением. Поэтому владелец должен сам опубликовать JSON новым комментарием, без code fences и изменений. Это подтверждает8новых запросов и описанный scope. До комментария разрешено0новых model requests.

## Проверки

Source de8825f2246c397d830210619030b804ae862e87: [CI40518338021](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40518338021), job122237945344 — pnpm typecheck PASS, pnpm test2696/2696 PASS, failures0.10новых regressions:4carryover,4package,2append/dynamic windows.15selected/22related local cases PASS; exact diff-check/script/helper syntax PASS.

Native read-only preflight отдельно проверяет actual old ledger/базовый CI/ограниченные author contexts/отсутствие новых state refs. Это не native owner approval и не реальная задача агентов. Результат фиксируется отдельно по факту. Main/Calculator/current actual budget/state не менялись; legal=false.

## Подтверждённый native preflight

[Actions40519171316](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40519171316), job122241191386 — SUCCESS.52запроса, толькоGET к фиксированным Factory/Calculator repos. Carryover65/626530/263359 подтверждён дважды на неизменённом b139646. Base CI40178095158 принят. Новые budget/archive refs отсутствуют. Author contexts4668/5082bytes, reserved3012/3150tokens: в лимитах.0provider/app/budget/state writes; ownerApprovalVerified=false. Это проверка предложения, не выданное разрешение.

Следующее действие владельца: открыть offline helper, скопировать rawJSON и опубликовать новым OWNER-комментарием в https://github.com/erman-ksv/Onay-Agents-Factory/pull/75 . Не нужны API-ключи в чате и повторная настройка recovery key. После комментария host проверит его ID/body/actor/expiry, привяжет immutable manifest и однократно инициализирует новый metadata ledger с историей65 и8слотами. Сам факт присутствия файлов proposal не разрешает эту запись или model execution.
