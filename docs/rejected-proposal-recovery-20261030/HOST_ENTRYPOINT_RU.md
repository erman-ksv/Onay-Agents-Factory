# Отдельный Host-entrypoint отклонённого предложения

Основа кода: `7f9e4de0fa1a8d3518893ef8986c3d961a7ce1ce`, CI41063809748 (2852 PASS, typecheck PASS). Это результат предыдущего SHA, не CI новых файлов.

Новые файлы не изменяют corrective loop, валидатор патча, ledger, CAS, существующие workflow и OWNER-бюджет.

## Состав

- `.factory/rejected-proposal-host.json` — отдельный pin checkpoint13, budget868e730, исходника5589939 и всех подтверждённых переходов грантов; без OWNER commentId и без activation. Последний переход b0eab60 →392dc0d уже произошёл; он только читается, не повторяется.
- `orchestration/projectRejectedProposalHost.ts` — manifest/context, read-only восстановление lineage, свежая native-инспекция evidence, отдельные preflight/live функции. Внутренний host capability используется один раз до первого await. Старые budget OWNER-комментарии доказывают существующую историю грантов; старые replacement/corrective execution admissions не используются. Новый OWNER для rejected initial proposal обязателен.
- `scripts/project-rejected-proposal-host.ts` — явный CLI `--preflight` либо `--live`; требует чистый checkout точного нового SHA, его происхождение от7f9e4de и независимо закреплённый digest scope. Не вычисляет доверенный ожидаемый digest из входного JSON.
- `.github/workflows/stage8-rejected-proposal-preflight.yml` — отдельный workflow исключительно read-only, без provider credentials, write token или live команды. После разрешённого push ждёт точный полноценный CI, затем вызывает только preflight. Существующий replacement workflow и config не трогать.
- `orchestration/projectRejectedProposalHost.test.ts` — тесты guards, stale SHA/CI, параллельного потребления host capability, исключений и границы workflow.

## Preflight

В Actions с frozen-lockfile dependencies: `pnpm exec tsx scripts/project-rejected-proposal-host.ts --preflight`.

Нужны только действующие read credentials и настоящий recovery key. Отсутствие или наличие лишних provider/live/write variables останавливает preflight. GH event push допустим только для preflight; live допускает только workflow_dispatch. Повторный run_attempt запрещён. Программа проверяет текущую Factory-ветку, exact-source Agent Factory CI (включая Install/Typecheck/Test), исходный Calculator CI, актуальные ledger/state protection/archive/source и AES-GCM evidence. Выполняются только удалённые GET; временная локальная расшифровка удаляется существующим inspector. Grant init/extension/reset, durable claim, provider readiness и model generation не вызываются.

Возвращаются только диагностика, pins, draft нового admission и счётчики0 provider/budget/archive writes. Draft и metadata не являются permit. При несовпадении digest, изменении state или истечении срока — остановка, без автоматического renewal. Никакие исходники или plaintext ответа Coder в artifact не попадают.

## Отдельная граница live

В этом патче **нет live workflow**. Подготовлена только native Host-функция и CLI. Новую публикацию/live launcher/настоящую попытку требуется согласовать отдельно. Обычный push не имеет live-команды или AI-ключей и не может активировать режим.

Даже из отдельно доверенного workflow_dispatch CLI `--live` требует FACTORY_REJECTED_LIVE_CONFIRMATION=ONE_REJECTED_PROPOSAL_AND_SUCCESSOR_MAX_8, обычные existing Factory live guards, точный code/config SHA и FACTORY_REJECTED_OWNER_COMMENT_ID настоящего нового OWNER. Значение из чата не заменяет GitHub OWNER comment. Host сравнивает body с native-generated admission, проверяет erman-ksv/User/OWNER, неизменность, PR75, digest и expiry через существующий authorizer. Никакого нового разрешения самостоятельно не выдаёт.

После проверки: единственный existing CAS claim → recover(ticket) → Coder и3 независимые проверки → existing native Node/browser → Draft → runProjectCiContinuation на точном candidate SHA с настоящим lineage → следующая из2 утверждённых задач. Внутреннего corrective retry нет. При отрицательном результате или неопределённом HTTP исходе — остановка. Потеря ACK/crash после claim не даёт новый permit. Все старые расходы сохраняются.

## Ограничение расходов и срок

На входе необходим точный остаток15/186739/92790. Recovery максимум4 запроса /48000 bytes /24000 tokens, successor максимум4 /48000 /24000: всего8 /96000 /48000, консервативный остаток7/90739/44790. Ограничение обеспечивают2-task manifest, один rejected proposal ticket, стандартные четыре роли каждой задачи и отсутствие corrective options. Лимиты и grant не изменяются. Срок existing budget/нового draft — 30.10.2026 23:59:59 UTC; после него остановка, не renewal.

## Что ещё требует доказательств

До приёмки необходимы typecheck и весь pnpm test именно нового SHA, настоящий read-only preflight с ключом и свежими pins; затем отдельный новый OWNER admission и отдельно разрешённый live запуск. Даже полностью зелёный CI этого патча не закрывает этап8. Реальные native/browser тесты результата AI и автоматическое продолжение после настоящего candidate CI пока не выполнены.
