> Дополнение 29.10.2026: после первоначального отчёта воспроизведена и исправлена гонка выдачи corrective permit (два concurrent callers получали два permit). Последнее состояние и итог повторной проверки — `FINAL_RECHECK_RU.md`; первоначальные результаты ниже остаются историческими, не подтверждают полный typecheck.

# ONAY Factory — corrective loop, локальное изменение 29.10.2026

Статус: **пункт 1 BLOCKED; пункт 2 BLOCKED**. Код изменён локально на ветке `feat/calculator-t02-charge-reconcile-20261022`, исходный HEAD `ffb02d3c55ec57859e5d5d33a84112999727abf4`. Commit/push/merge/deploy, реальные AI-вызовы, изменение actual grant/ledger/archive и новые OWNER-запросы не выполнялись. Main не менялся.

## Причины и исправление

1. `projectNextTaskWorker.ts` завершал задачу после отрицательного review/host-теста; существующие correction context/admission/checkpoint не были связаны с Host. Теперь исправимый `changes-requested` с конкретными замечаниями или настоящий failed Node receipt сохраняют исходное предложение и замечания в AES checkpoint `correction-ready`. Отдельное OWNER-разрешение, четыре свободных budget slots и durable CAS `correction-claim` допускают один corrective execution. После него заново выполняются Security → Reviewer → Tester → Node → обязательный browser gate → Draft publication → exact CI → successor. `blocked`, недостоверное evidence и повторная ошибка останавливают цикл.
2. Исходный recovery guard разрешает только свои r1–r4. Он не расширялся. Для correction используется отдельный стабильный execution ID и проверка неизменного старого ledger prefix плюс максимум r1–r4 нового scope. Неизвестный HTTP/CAS ACK не повторяется и не возвращает расходы.
3. Checkpoint сохраняет происхождение evidence и ID исходного execution. Simulated и legacy evidence не становятся native разрешением при восстановлении. Возобновление возможно только до corrective admission, при отсутствии claim/reservations, с актуальной отдельной OWNER capability и проверенными источниками/CI. Перенос checkpoint сам не выдаёт разрешение.
4. Corrective packet обязан показывать и original source, и rejected proposal. Host теперь формирует обе выборки. Аварийный checkpoint после коррекции указывает ID corrective execution.

HTTP 200 означает получение ответа провайдера. Оно не доказывает валидность предложения, независимых оценок, host tests или результата CI. Последний старый потерянный ответ восстановить невозможно; точную внутреннюю причину прошлого host-stopped по нему не заявляем. Ранее исправленный UTF-8 дефект повторно не разрабатывался.

## Функции и файлы

| Файл | Изменение |
|---|---|
| `orchestration/projectCorrectiveAuthorization.ts` | `proposeProjectCorrectiveAuthorization`, `authorizeProjectCorrectiveLoop`, отдельный immutable OWNER policy, fresh GET, one-use task permits |
| `orchestration/projectCorrectiveRuntime.ts` | claim/restore/current guards, расчёт 8 запросов на задачу, no replay |
| `orchestration/projectNextTaskWorker.ts` | bounded corrective path, encrypted persistence, independent reruns, cold resume API, правильный execution ID диагностики |
| `orchestration/projectExecutionAdmission.ts` | обязательный отдельный permit, fixed OSS120B model, одноразовое consumption |
| `orchestration/projectModelContext.ts` | qualified failure evidence, запрет третьей попытки, checkpoint v2 provenance/firstExecutionId |
| `orchestration/projectCorrectionCheckpoint.ts` | authenticated metadata/restore, native vs simulated separation |
| `orchestration/projectNodeTests.ts` | test-only genuine failed receipt verification; native checks не ослаблены |
| `github/projectCheckpointArchive.ts`, `orchestration/projectRuntimeRecovery.ts` | два новых encrypted event kinds, materialization без выдачи полномочий |
| `orchestration/projectReplacementRecoveryHost.ts` | optional отдельный correctiveDecision, полный budget preflight до первой записи |
| `orchestration/projectCiContinuation.ts`, `projectCiEventEntrypoint.ts` | перенос capability в разрешённый successor |
| `orchestration/projectTaskFailureDiagnostic.ts` | точные стадии correction failures |
| `config/fixtures/projectCorrectiveFixture.ts`, `projectPublicationFixture.ts` | строго offline fixture OWNER/ledger и тестовый увеличенный grant |
| `orchestration/projectCorrectiveLoop.test.ts`, `github/projectSourceSnapshot.test.ts` | новые end-to-end регрессии, миграция прежних tests на отдельные simulated permits, native-provenance negative test |

## Проверки и ограничения

Проверки выполняются на полном checkout, восстановленном по точным Git blob/tree/commit hashes. Native Node 24 transform всех 410 TS файлов — только преобразование синтаксиса, **не typecheck**. Используется отдельный build directory; SDK-заглушки не создавались.

Project-набор до последней проверки диагностического ID: **476 PASS / 0 FAIL / 0 SKIPPED**. Включает 12 новых regression tests. После изменения диагностического ID добавлен 13-й loop test. Итог заключительного общего прогона: **2638 tests / 2625 PASS / 13 FAIL / 0 SKIPPED**, 172 файла. Все 13 новых loop tests PASS. Все 13 failures совпадают с failures неизменённого baseline; подробности в `verification.json`.

Расширенный первый общий прогон: 2461 tests, 2448 PASS / 13 FAIL / 0 SKIPPED; ещё 141 + 35 tests PASS из шести дополнительных файлов. Все те же 13 failures воспроизведены на неизменённом исходнике: 8 требуют отсутствующий `tsx`, 2 получают Node spawn EPERM, 3 — TCP listen EPERM. Они не заменялись успешными заглушками. 17 файлов со статическими SDK-зависимостями @openai/agents/openai/zod не запускались; число их test cases не подсчитано.

`pnpm typecheck`: **BLOCKED**, `tsc: not found`. `pnpm test`: **BLOCKED**, `tsx: not found`. Package installation не завершилась: registry EPERM. Docker socket и subprocess Node EPERM. Native Docker/browser suite, полная штатная SDK-backed suite и внешний независимый reviewer не подтверждены.

В fixture действительно выполняются local bare Git и фиксированный synthetic module через Node import с независимыми assertions. GitHub/AI/Docker infrastructure остаются **simulated**. Это не native sandbox receipt, не настоящее независимое AI review и не доказательство live автономности. Проверены ограничения авторизации/бюджета, negative Security, повторная ошибка, 429, lost provider response, lost claim ACK, tampered checkpoint, cold restoration и exact CI → successor на simulated evidence. Существующие UTF-8/recovery tests включены в общий прогон. Настоящие timeout/Docker/browser проверки, недоступные здесь, не считаются PASS.

## GitHub: повторно проверенные факты

PR [75](https://github.com/erman-ksv/Onay-Agents-Factory/pull/75) остаётся open/draft, head `ffb02d3c55ec57859e5d5d33a84112999727abf4`, base `feat/agent-owned-corrective-cycle-20261022`.

- [CI 40835425841](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40835425841), тот же SHA: success; ранее прочитанные job logs подтверждают TypeScript и 2811 PASS / 0 FAIL / 0 SKIPPED.
- [Read-only preflight 40835425962](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40835425962), тот же SHA: success, без генераций/бюджетных/архивных записей.
- Последний live [40831669000](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40831669000), SHA `a8015d324a549eae0741458fa383b228c953dee6`: failure. Не повторялся.

Эти CI относятся к исходному опубликованному коду. **CI изменённого кода отсутствует**, поскольку commit/push запрещены без нового разрешения.

## Бюджет и OWNER — только проекты DATA

Ledger head `b0eab60fe92c0759ae9f8f3e57d05e6fb8e95b0e`, archive `c364324e7a5011e983e08615bbdb7a2218043b3c` (10 events) повторно прочитаны и не изменились. Учтены все 65 historical calls и пять дополнительных reservations: **70 / 650605 bytes / 278665 reserved tokens**. Остаток actual grant — **7 / 119925 / 56694**.

Для двух задач: обычный успешный путь 8 запросов; полный ограниченный worst case **2 × (4 initial + 4 correction) = 16** новых запросов, 192000 bytes и 96000 reserved tokens. Первое отрицательное review может остановить initial раньше; запас всё равно должен покрывать полный worst case. Минимальные потолки с сохранением расходов: **86 / 842605 / 374665**. Это не разрешение изменить actual limits.

Файлы `01-budget-owner-DRAFT.json`, `02-recovery-owner-DRAFT.json`, `03-corrective-owner-DRAFT.json` и `manifest-DRAFT.json` — только рассчитанные предложения, не подписанные/применённые разрешения. Никакие comment IDs не выдумывались. Их **не следует публиковать/активировать** сейчас.

Конкретный оставшийся дефект подготовки: `inspectProjectDevelopmentBudgetExtension` принимает только +1/+12000/+6000. Ему нельзя передать предлагаемое увеличение с maxRequests 77 до 86. Текущий Host безопасно откажет до записи. Для реальной приёмки нужен отдельно проверенный ограниченный grant transition, сохраняющий всю lineage и требующий подходящих OWNER решений. Существующее правило не расширялось и не обходилось. Старый ten-event пакет с maxRequests 78 покрывает только 8 новых запросов и для worst-case corrective цикла непригоден.

## Что осталось в двух существующих пунктах

**Пункт 1 BLOCKED:** завершить допустимый bounded grant transition, восстановить dependency-backed typecheck/full tests, получить разрешение на commit/push, подтвердить CI на точном исправленном SHA, затем актуализировать pinned manifest и отдельно согласовать OWNER scope. Подготовленные JSON до этого не активируются.

**Пункт 2 BLOCKED:** выполнить native Node/browser проверки и отдельно разрешённый реальный Commander → Coder → Security → Reviewer → Tester → correction → fresh checks → Draft → exact CI → automatic successor. Нынешние локальные тесты не закрывают live приёмку.

Правки разработки остановлены после комплексного изменения и проверки; дальнейшие ограничения отражены доказательствами. План проекта не дополнялся.
