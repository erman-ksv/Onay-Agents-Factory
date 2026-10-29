# Factory — настоящая удалённая блокировка исправления

25 октября 2026. Продолжение [проверенного перехода к следующей задаче](FACTORY_CORRECTED_TASK_SUCCESSOR_2026-10-25.md).

## Реализация

Добавлен `createCalculatorRecoveryGitHubClaim` — конкретный GitHub transport для двух callback основного runtime: `claimRecovery` и `assertRecovery`. Ранее этот контракт проверялся на подставных функциях. Новый адаптер работает только с `erman-ksv/Onay-Agents-Factory`, не содержит модели/публикатора приложения и сохраняет только metadata.

Ключ `state/calculator-recovery/<hash>` привязан к плану, задаче, исходному base SHA и устойчивому executionId исправления. Новый worker, другой runtime/CI или другой хеш сериализованного архива не создают вторую возможность для той же ошибки. В metadata сохраняются task/commit/digest и provenance проверенного runtime; исходников, ответов модели и ключей в записи нет.

До записи читается native source CI: конкретные run ID, commit SHA, repo, путь `.github/workflows/ci.yml`, первый attempt, success и успешные Typecheck/Test. При неполном списке steps однократно читается та же native job. Отсутствие доказательств приводит к отказу.

GitHub получает отдельный orphan commit с одним metadata blob. Ref создаётся атомарно, никогда не обновляется/удаляется и не включает историю приложения или workflow. После создания перечитываются ref, commit, tree и blob, проверяются идентичность, структура и Git SHA. При последующих проверках повторяются native CI и remote metadata проверки. Перемещение ref, испорченный blob, отзыв CI или несовпадающий binding дают терминальный отказ. При конфликте или потере подтверждения автоматического повтора нет; свежий процесс видит занятую ссылку.

Это **блокировка новой фазы**, а не подтверждение приватного архива, owner approval или модельный grant. Адаптер намеренно не реализует `assertSourceRemote`: приватный checkpoint/receipt всё ещё должен поступать из отдельно проверенного архива. Пока такого host-источника нет, подключать его вместо настоящей проверки нельзя.

## Проверки

Локально: восемь новых тестов и **300/300** связанных проверок без установки зависимостей. Покрыты конкурентные клиенты, свежий worker, потеря ACK, неверный CI/run attempt/skipped Test, binding, раскрытие HTTP-ошибок, перемещённый ref, lazy поля и секретоподобные строки. Скрипт audit прошёл `node --check`.

Полный [GitHub CI 40226257446](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40226257446) для кода `349d4e549a2f7df976ed94c8e2f34646d81a314c`: **pnpm typecheck — success; pnpm test — 2366/2366, ошибок 0**. Проверены завершённая job `121268166280` и её логи.

Настоящий [Actions audit 40226436989](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40226436989), job `121268688281` — **success**. Два клиента конкурировали за одну ссылку: успешных claim **1**, свежий клиент отказал без новой записи. В логах подтверждены 21 GET и 8 POST-запросов metadata API (включая конфликт, это не восемь успешных новых ссылок). Сохранён orphan ref `refs/heads/state/calculator-recovery/3ebd11595eae039546c88d40dd3bfc092dd044c4a4a0a76a8eddc1cb418417dc`. Artifact `12610938973`, 492 байта; GitHub сообщает digest `7e9fc55edd989d9b331af589e38fe99dc446f623b70eb3f18909e5bfe3e59236` — ZIP локально повторно не хешировался. В job отсутствовали provider keys и Calculator token; model calls 0. Это реальная проверка native блокировки на синтетических metadata, **не проверка получения приватных исходников**.

## Новые файлы

- `github/calculatorRecoveryClaim.ts` — native GitHub CI/ref/commit/tree/blob transport.
- `github/calculatorRecoveryClaim.test.ts` — восемь регрессий.
- `scripts/calculator-recovery-claim-native-audit.mjs` — синтетическая настоящая проверка GitHub, без provider keys и app tokens.
- `.github/workflows/recovery-claim-native-audit.yml` — запуск конкретного протестированного commit, без установки зависимостей; запись разрешена только job проверки metadata.
- `.factory/recovery-claim-native-audit-request.json` — trigger синтетической проверки, не запрос запуска модели.
- Этот отчёт и `.factory/native-recovery-claim-proof-20261025.json`.

`git diff --check` выполнен в отдельном сравнительном index, поскольку рабочая копия частичная и без `.git`. Полный diff сохранён отдельно.

## Осталось

Нужны подлинная загрузка/проверка приватных checkpoint/receipt из артефактов и сборка production host/workflow с этой проверкой, native claim и существующим runtime. Синтетическая native проверка не доказывает получение реального приватного архива, не продолжает старый пилот и не выполняет задачу Calculator. Связь исправления с successor уже реализована для одного проверенного head; перенос на последующие изменённые head остаётся отдельной проверкой.

Для реального HTTP модели по-прежнему обязательны owner-approved цель/общий лимит и явная инициализация полной истории. Оператор остаётся `inspect`, `ownerDecision: null`, ledger не активирован; дополнительного разрешения — 0. Реальных model calls — **0**, main и Calculator/Onay не менялись, merge/deployment не выполнялись. Codespaces, платные API и новые агенты не использовались; юридический агент отключён. Шаг 9 целиком не закрыт.
