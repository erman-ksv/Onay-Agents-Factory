# Пункт1 — обязательный браузер перед UI публикацией

## Что завершено

Native публикация UI в generic Factory runtime теперь требует genuine браузерный результат для точных plan/task/snapshot/proposal/policy. Одних четырёх ready specialists и успешного Node receipt недостаточно. Нет receipt, failed/unverified result, копия JSON, чужая policy/proposal/snapshot, stale source или simulated browser не дают native publication approval. Ошибка останавливает transport без повторного model call, reset или автоматической публикации.

Обязательность определяет host: frontend role требует браузер, а для Calculator изменения index.html/styles.css/src/app.mjs требуют его и при role=coder. Переименование UI задачи не обходит gate. Worker проверяет наличие genuine browser policy до исполнения; pinned manifest требует поддержанную browser policy и запрещает команды/неподтверждённые image tags. Для других frontend targets неподдержанная браузерная приёмка означает отказ, а не fallback на Node.

## Что именно проверяется

25 неизменных input checks из config/calculator-input-browser/cases.json выполняются на полном proposed overlay четырёх файлов. Затем на ТОМ ЖЕ overlay выполняется существующий narrow browser suite: clear/backspace, keyboard equivalence и narrow layout —5 прежних сценариев. Старый harness и expected answers не менялись. Source-set SHA, proposal digest и непрерывные source checks связывают результат с изменением.

Read-only baseline report остаётся только данными. Новый internal WeakMap у probe и genuine policy/receipt WeakMaps не позволяют превратить сериализованный отчёт в runtime acceptance. Production использует fixed native Docker process; injected browser/Node/API в тестах остаются simulated. Private legacy runner inputs не являются grant или publication capability.

preparePublicationForTests может выдать только simulated approval. Он не меняет native browserTestsVerified и не подходит native publisher. Обычный preparePublication требует native browser+Node. Существующие owner/budget/source/independent-role/CI/secret/state-protection gates сохранены. Юридический агент отключён.

## Проверки

Source8c05f839b7034a8630c4d4726e540f39190609f9: [CI40500786916](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40500786916), job122177646457: pnpm typecheck PASS, pnpm test2674/2674 PASS, failures0. Добавлено12 regression tests; локально22/22 связанных теста PASS. Exact git diff --check PASS.

Проверены: обязательность gate при Node pass/4ready; role=coder UI bypass; одинаковый plan/proposal/source; cloned/cross-snapshot/cross-policy/failed/simulated receipts; отказ при source movement; обязательность старых browser scenarios; pinned manifest без browser/с moving tag/command; early worker rejection. Положительные pipeline unit cases используют simulated browser/Node/model и не являются реальной приёмкой исправленного приложения. Предыдущий настоящий Chrome baseline показал12 input failures на неизменённом Calculator; это не исправлялось host.

Launch workflow закреплён на проверенный source; browser images из verified immutable manifest готовятся до передачи model credentials, только mcr.microsoft.com/playwright@sha256, без shell interpolation. EXPECTED_RUNTIME_MANIFEST_SHA256 всё ещё не настроен: production не включён и providers не вызываются.

## Что остаётся

Из4 обсуждавшихся пунктов пункт1 реализован и проверен в указанной области. Остались3:

1. Read-only dependencies без расширения write scope и безопасный старт первой новой задачи/production plan.
2. Отдельный точный OWNER development grant с ограниченным allowance и сохранением65 прежних расходов. Сейчас read-only-review, remaining0; «продолжай» не сбрасывает историю.
3. Настоящий agent repair → Security/Reviewer/Tester → host checks → publication → exact CI → successor. Positive native UI acceptance и ограниченное самоисправление ещё требуют реального прогона; текущий one-pass worker на failed verdict/429 останавливается.

Main, Calculator/Onay source, actual budget/state refs не менялись. Новых настоящих model calls0. Merge/deployment не выполнялись. Это завершение программного gate, не всей автономной Factory и не приёмка приложения.
