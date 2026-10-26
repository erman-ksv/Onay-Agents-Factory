# Этап10.12 — общий Draft publisher и exact-candidate CI

26.10.2026. Продолжение Factory. Реальные Onay/Calculator, модельный бюджет, grants, merge/deployment не меняются.

## Что добавлено

После genuine author→Security→Reviewer→Tester и настоящего прошедшего host test pipeline выдаёт одноразовый publication approval. Модельное мнение/JSON не заменяет host evidence. Отдельный test-only approval всегда simulated и production writer его отказывается принимать. Root owner/controller/source checks остаются свежими; callback или сериализованный объект не могут создать native authority.

Общий publisher использует фиксированный Git/HTTP, host-approved target/profile/feature branch, native development approval и отдельные write/free-tier/legal/workflow opt-in. Новая ветка создаётся с пустым lease; существующая должна точно совпасть с parent SHA. Bare Git не запускает project hooks/submodules/filters и не checkout-ит приложение; token доступен только изолированным сетевым Git-командам через askpass для точного github.com target.

Проверяются весь parent tree в пределах host caps, единственный parent нового commit, точный список изменённых файлов, Git blob hashes и свежие опубликованные bytes. Перед push обязателен checkpoint; неизвестный результат push/PR сохраняет известный candidate/phase и запрещает повтор. PR только open Draft, same repo/base/head, без merge/deployment. Duplicate/foreign/non-Draft/неожиданный base PR, гонка другой ветки, stale source или owner revocation останавливают операцию.

После движения feature-ref проверяется неизменный owner root и точный новый head; законное движение anchor не подменяется старым source assertion. Это не разрешение игнорировать stale root или другое содержимое кандидата.

## CI gate

Новый reader сохраняет строгую provenance/pagination/run-attempt логику прежнего Calculator reader: exact branch+SHA, pinned workflow ID/path/blob, active workflow, same repo/head repo, допустимый push/dispatch event, свежая run_attempt, job/head identity, собственные required steps каждого job. Неуспешный или ещё работающий workflow не скрывается другим зелёным job. Повторное чтение подтверждает стабильность ref, run list и attempts. Unknown/malformed/лишние страницы отказываются; только GET, без retry ошибок или модельных запросов.

Требования job/step берутся из host target profile, а workflow pins из immutable host policy. Production CI evidence нельзя подменить simulated/скопированным metadata. Confirmation связывает CI с genuine publication и повторно проверяет PR/ref/attempt. Повторные успешные наблюдения дают то же одноразовое подтверждение, без нового push или PR; pending/failed/копия/simulation не разрешают native advancement. Это ещё не durable доставка события следующей задаче.

## Проверки

- Локально **245/245** целевых тестов; **24 новых** regression tests. Использован настоящий локальный bare Git; GitHub/owner/model имитируются. Исходная проблема sandbox с child stdin устранена только в test fixture через private file descriptor; production Git runner не изменялся.
- Typecheck/полный CI: [CI40392916653](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40392916653), source `6a067b57ca4e44f4c7e9ad8c06e4d384509fd2f4`, job121818300445: **pnpm typecheck PASS; pnpm test2581/2581 PASS, failures0**.
- Native audit: [Audit40393362970](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40393362970), job121819863833: **SUCCESS**.1 actual Docker check,1 actual local Git push,1 MOCK Draft PR request,4 MOCK model replies, simulated CI confirmation; repeat publication refused. Отдельный native read-only collector подтвердил Task CI40178095158 для неизменённого Calculator5589939 по workflow blob45fae4a292a04e89a631ad7ff2469a3af7265e70 из bootstrap2c1218f2.0 actual model/budget/app writes/new app PR.
- Точный diff: **git diff --check PASS**; 16 files changed, 613 insertions(+), 13 deletions(-)..

Новые тесты покрывают create/update Draft, exact blobs/lease, competing writer, lost push acknowledgement, pre/post checkpoint failure, unsafe/duplicate PR, owner revoke, write opt-ins, no native approval without host tests, exact CI fields/pins/attempts/steps, skipped/missing jobs, fork/merge run, pagination, rerun/head movement, forged capabilities, чужую profile capability и одноразовое CI confirmation.

## Что ещё не подтверждено

Реальная публикация нового приложения через generic publisher не выполнялась: native audit использует Docker и локальный Git, но модель/owner/PR/fixture CI имитируются. Отдельная настоящая проверка существующего Calculator candidate — read-only Task CI probe по original bootstrap workflow pin; это не полный Calculator release gate, не устранение багов ввода и не новый PR.

Остаются durable publication/CI receipt, безопасная reconciliation неизвестного push/PR, автоматическая доставка exact-CI результата и next-task deduplication между процессами. Потребуются production recovery key/storage integration, отдельный настоящий planning/live allowance и реальный полный прогон. Сейчас actual remaining.requests0. Browser/device/Expo/релиз Onay отдельно не подтверждены.

Не заявлять универсальную автономность. Main и настоящий ledger сохранены, legal disabled; no paid APIs, Codespaces, локальных installs или новых агентов. Старые scenarios/expected answers и отдельные legacy Calculator guards не ослабляются.

[Машинный отчёт](../.factory/project-publication-ci-proof-20261026.json).
