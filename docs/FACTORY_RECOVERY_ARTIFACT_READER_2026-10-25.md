# Factory — проверенная загрузка архива восстановления

25 октября 2026. Продолжение [native блокировки](FACTORY_NATIVE_RECOVERY_CLAIM_2026-10-25.md).

## Реализация

Добавлен `loadCalculatorRecoveryArtifact`: конкретный read-only GitHub загрузчик с независимо закреплёнными ожиданиями. До и после скачивания проверяются native run ID/attempt, commit SHA, workflow path, ожидаемый completed conclusion, репозиторий, artifact ID/name, отсутствие expiry, размер и платформенный digest. Ожидаемые ZIP/file SHA и пути должны поступать из проверенного host-конфига, а не из скачанного manifest или ответа модели.

Загрузчик **сам пересчитывает SHA256 фактически скачанного ZIP** и сравнивает размер. При native 302 допускается только HTTPS object-storage адрес GitHub/Azure без credentials/port; GitHub-токен на него не пересылается. Автоматических повторов нет. API-ответы и ZIP ограничены по объёму и времени; endpoint фиксирован на Factory, методов записи нет.

ZIP остаётся в памяти, на диск ничего не распаковывается и содержимое не исполняется. Проверяются central/local заголовки, диапазоны и пересечения, UTF-8 пути, типы, дубли, symlink, шифрование, методы сжатия и лимиты. Поддержаны stored/deflate и data descriptors. ZIP64 и другие неподдержанные форматы отклоняются; они не принимаются по предположению. Только выбранные независимо закреплённые файлы распаковываются в память: для каждого проверяются точный размер, CRC и SHA256. Невыбранные файлы не выдаются наружу, их содержимое не исполняется.

Наружу возвращается genuine in-memory capability: только metadata плюс методы приватного чтения/повторной проверки. Чтение отдаёт копии Buffer. JSON/копия capability не могут подменить проверенный источник. После потери remote provenance capability останавливается и не возвращает старые байты как основание продолжить выполнение.

`createCalculatorRecoveryArtifactHost` связывает эту capability с существующим runtime: берёт только закреплённые checkpoint/receipt, проверяет их прежним парсером и предоставляет настоящий `assertSourceRemote`. Изменение mapping после подготовки не меняет проверяемые task/base SHA. Native claim/assert остаются отдельным адаптером. Owner/controller, полный бюджет, разрешения инструментов, роли, реальные тесты и CI сохраняются; загрузка архива не выдаёт эти права.

## Проверки

Локально до TypeScript-аннотации: **307/307** связанных тестов; после исправления только типовой аннотации повторно **7/7** тестов загрузчика. Скрипт audit прошёл `node --check`. Зависимости локально не устанавливались. Семь новых сценариев покрывают stored/deflate/descriptor ZIP, опасные и дублирующиеся пути, symlink, опасный невыбранный файл, несоответствие header/digest, expired/rerun/wrong-head, redirect и отсутствие token forwarding, потерю remote proof, защиту от mutable expectations и genuine capability/host связь. ZIP fixtures созданы стандартной Python zipfile заранее; сами тесты Python не требуют.

Первый CI выявил пропущенную аннотацию типа callback; она исправлена до native audit, без изменения runtime поведения.

Полный [CI 40227769306](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40227769306) для кода `5d0801884483af5290f6344c3170388cc79bcf04`: **pnpm typecheck — success; pnpm test — 2373/2373, ошибок 0**. Проверены завершённая job `121272718895` и её логи.

Настоящий [read-only Actions audit 40227911953](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40227911953), job `121273168379` — **success**. Скачан artifact `12610938973`: SHA256 всего ZIP (492 байта) фактически пересчитан и совпал с `7e9fc55edd989d9b331af589e38fe99dc446f623b70eb3f18909e5bfe3e59236`; SHA256 выбранного `result.json` (603 байта) пересчитан и совпал с `2c0516cc9f5d62a0a6bb69935f98215006e6852807f12db4b5522381dc0d00c2`. Подтверждены 8 GET к GitHub, 1 GET к object storage, 0 GitHub write requests, отсутствие передачи GitHub-токена на storage и 0 model calls. Отчёт сохранён artifact `12612485726`; его собственный ZIP не скачивался повторно, GitHub сообщает digest `28f800ae556db73995fab2ca9ef70b0bdedeb6c6d924e4e43f674e10ec1d2ba4`. Это проверка реального транспорта/ZIP на синтетическом источнике, не приёмка приватного source новой задачи.

## Файлы

- `github/calculatorRecoveryArtifact.ts` — native metadata/download проверки и ограниченное ZIP-чтение в памяти.
- `github/calculatorRecoveryArtifact.test.ts`, `github/fixtures/calculatorRecoveryZip.json` — семь регрессий и независимые ZIP fixtures.
- `orchestration/calculatorRecoveryArtifactHost.ts` — genuine artifact capability → runtime source assertion.
- `scripts/calculator-recovery-artifact-native-audit.mjs` и `.github/workflows/recovery-artifact-native-audit.yml` — конкретная read-only проверка в Actions, без package installation/provider keys/app token/state writer.
- `.factory/recovery-artifact-native-audit-request.json` — trigger проверки metadata-архива, не разрешение модели.
- Этот отчёт и `.factory/recovery-artifact-reader-proof-20261025.json`.

`git diff --check` выполнен в отдельном сравнительном index, поскольку рабочая копия частичная и без `.git`. Полный diff сохранён отдельно.

## Граница готовности

Native audit читает существующий **синтетический metadata artifact**, а не приватные исходники приложения или реальную новую задачу. Его выбранный file hash независимо получен из аутентичного лога job `121268688281`, чей закреплённый скрипт записывал тот же объект JSON. Загрузчик не доказывает конфиденциальность публичного artifact и не меняет доступ к хранилищу; приватные исходники в публичный Factory не загружались.

Готовы конкретные archive-source и native-claim адаптеры. Для живого восстановления ещё нужна сборка production workflow с настоящим защищённым источником checkpoint/receipt и проверенными pin/identity, реальным host-check runner и обязательным проектным runtime. Такой источник для нового bounded recovery этим этапом не выбран и не объявлен проверенным. Дальнейшие изменённые head требуют отдельной проверки интеграции.

Реальный model HTTP не запускался. Дополнительного разрешения — 0; общий ledger не активирован, operator остаётся `inspect`, `ownerDecision: null`. Main и Calculator/Onay не изменены, пилот не повторялся; merge/deployment, Codespaces, платные API и новые агенты не использовались. Юридический агент отключён. Шаг 9 целиком не закрыт.
