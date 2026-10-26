# Этап10.5 — проверенные исходники и подготовка изменений

26.10.2026. Реализованы source snapshot/guard и proposal validator общего исполнителя; реальное чтение существующего Calculator проверено на GitHub. Это не новый model run, не второй проект и не исправление приложения.

## Реализовано

- `github/projectSourceSnapshot.ts`: genuine plan/profile/task задают разрешённые пути. Native reader использует только фиксированные GitHub GET с read token, без redirects/fallback/retry. Проверяются текущий owner root ref и anchor ref, commit/tree/blob links, полный tree, canonical base64, реальный git blob SHA, UTF8, размер, суммарный объём и secrets. Новый task base допускается на plan.branch только с проверяемым предком owner base (до32 посещённых коммитов). Симлинки/gitlinks, неизвестные/дублированные paths, несуществующий parent tree, truncated list и read error не дают absence proof.
- Полный source остаётся в private WeakMap. JSON snapshot содержит только paths, existence, commit/blob/source SHA и bytes. HOST-only accessor возвращает копию map; JSON-копия snapshot не воспроизводит authority. Непроверенные source/dependency/runtime/review/CI области перечислены явно.
- `createProjectSnapshotSourceGuard` — реальная callback для существующего generic task admission: genuine plan/task identity и повторная проверка ref. Потеря актуальности terminal/latching: возвращение ref назад не оживляет прежний capability.
- `commander/projectChanges.ts`: clone input до await, exact schema, genuine snapshot, только task paths, подтверждённая absence для create либо exact source SHA/unique non-overlapping old anchors для patch. Новые вставки не могут стать основанием следующего patch. No-op, stale/ambiguous/foreign/secret/invalid UTF8/oversized изменения отклоняются. Сохраняются прежние static Security и Reviewer policy checks без workflow/build-config opt-in. Результат снова проверяет ref.
- Полные новые файлы, summary и messages остаются private; default proposal JSON — только digest/hashes/bytes/paths и required gates. Independent Security/Reviewer/Tester, host tests и exact CI НЕ считаются пройденными от одной static подготовки. publicationAuthorized:false. После stale-source failure старый prepared output также не доступен для дальнейшего host использования.

Bounded patch helper не ослаблен: не более3 изменённых файлов,8 edits/file и128KiB patch file; profile может ужесточать лимиты. Чтение ограничено1024 tree entries и profile aggregate source bytes. Неподдерживаемые/слишком большие случаи отклоняются, не выдаются за полноту.

## Проверки кода

Source `7ad340f064454a869d4933d365c26a54dae2a1d5`. [CI40341767562](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40341767562), job121638057912: **pnpm typecheck PASS; pnpm test2476/2476 PASS**, failures0. Связанный локальный прогон **201/201**,16 новых source/proposal cases. Native script syntax и exact isolated git diff --check PASS. Локальные зависимости не устанавливались.

Тесты проверяют source privacy/forgery, absence без404, ancestry, ref races/latching, digest/base64/UTF8/size/secrets, symlink/gitlink/duplicate/parent evidence, fixed native API behavior/errors, positive patch/create, protected paths/test config, malformed/ambiguous/overlap/no-op/introduced anchors, getters/mutation и stale prepared files. Положительные patch/create выполнены на синтетическом notes fixture; реальный Calculator не переписывался.

## Настоящая проверка GitHub

[Native audit40342235253](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40342235253), job121639716202 — SUCCESS. Workflow закреплён на протестированный source SHA, передаёт только read token, повторно проверяет exact runtime CI Typecheck/Test; не имеет модельных ключей или write permission и не устанавливает пакеты.

- Actual Calculator commit `558993981c9bbb7c6100c8335860ac5668768314`.
- 6 существующих файлов: index.html,src/app.mjs,src/calculator.mjs,styles.css,test/calculator.test.mjs,test/ui.test.mjs. Всего11284 source bytes; git blob/source SHA проверены реально.
- Отсутствие src/__onay_readonly_probe_absent__.mjs подтверждено полным деревом этого коммита. Сам файл не создавался.
- Genuine source callback прошла текущие refs. Скопированный snapshot и чужой workflow-path proposal отклонены.
- **22 GitHub GET,0 API mutations,0 model calls,0 budget writes,0 application changes.** Публичный artifact содержит только metadata JSON; source остаётся в памяти worker.

Probe создаёт временный HOST profile/goal для read-only инспекции уже существующего разрешённого репозитория, не native development grant и не production target/branch. Он не доказывает actual role reviews/positive proposal/sandbox/CI второго проекта и не разрешает выполнение модели.

## Что дальше

Следующий блок — связывание выборочных контекстных пакетов с проверенным snapshot/proposal, затем общий author→bounded correction→independent Security/Reviewer/Tester→real sandbox/browser→candidate→exact CI/delivery/restart. Полная generic pipeline и второй живой проект остаются открыты. Настоящая до-плановая/исполнительная квота выдаётся отдельным native решением; текущий used65 и remaining.requests0 не меняются.

Ошибки Calculator (повторные операции/ведущие нули) остаются новой неисполненной repair задачей, не поводом повторять завершённую T05. Хост не пишет приложение вместо агентов. Main и приложение не менялись; бюджет и старые receipts сохранены. Legal disabled; без merge/deployment, Codespaces, платных API, локальных installs или новых агентов.

[Machine proof](../.factory/project-source-gates-proof-20261026.json).
