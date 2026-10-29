# Factory: единый read-only preflight восстановления

26.10.2026. Рабочая ветка: `feat/calculator-t02-charge-reconcile-20261022`. Draft PR75, база прежняя. Main и приложения Onay/Calculator не менялись; merge/deployment нет.

## Что соединено

`runCalculatorRecoveryPreflight` — конкретная GET-only композиция проверенных модулей, а не ещё одно разрешение исполнения. На входе ограниченный data-only запрос: версия, операция preflight, digest полной истории и source/null. Getters, циклы, неизвестные верхние поля, ownerDecision и операция run отвергаются. Модельные и writer credentials не принимаются. Все HTTP проходят охрану: только GET, фиксированные Factory/Calculator API либо разрешённый storage download без Authorization; лимит запросов.

При source=null результат честно сообщает `blocked-source-missing` и читает только существующее состояние ledger. Нет создания бюджета или блокировки, исходника, генерации, публикации или повтора задачи.

При подлинном source композиция выполняет:

1. Инспекцию ledger с полной закреплённой историей; owner approval остаётся unverified.
2. Native загрузку/аутентификацию архива, его run/head/workflow/attempt, ZIP и selected-file SHA.
3. Проверку checkpoint против owner/plan/task/base и текущего branded snapshot Calculator. Только исходная Frontend generate-validation failure подходит текущей policy. Контекст исправления подготавливается приватно, HTTP модели отсутствует.
4. Read-only проверку закреплённого успешного Factory CI с Typecheck/Test и отсутствия стабильного recovery claim. Новый `inspectReady` использует тот же native adapter; claimRecovery не вызывается.
5. Восстановление плана и терминальных receipts в НОВЫЙ приватный каталог с проверкой полного ZIP inventory, без перезаписи.
6. Повторную проверку source provenance, текущего commit, отсутствия claim и состояния ledger после асинхронных операций.

Даже положительный source результат называется `source-verified-execution-checks-pending` и явно содержит executionAuthorized:false, modelCalls:0, githubWriteRequests:0, ownerApprovalVerified:false, sourceCollectionCompletenessVerified:false, dependencyAcceptanceVerified:false, sandboxVerified:false. Ни прочитанная строка ledger, ни отсутствие remote claim не разрешает исполнение.

## Actions

Добавлен `calculator-recovery-preflight.yml`: только contents:read/actions:read, immutable checkout проверенного runtime, отдельный checkout metadata запроса по event SHA, Node24 transform без установки пакетов. Из секретов передаётся только read-only github.token; provider/state writer ключей нет. Загружается исключительно source-free result.json, каталог private-state в upload не входит. Ручной workflow_dispatch не нужен: разрешённый push metadata request запускает проверку.

Текущий request source=null. Это преднамеренная фактическая блокировка: пригодный новый приватный источник не выбран. Успех Actions job означает успешную инспекцию, а не готовность запуска команды. Native результат и CI фиксируются ниже после чтения логов.

## Проверки

Исходный код: `c4bc50f2d15aabe7b3cb970769ee1c933329ad27`.

Локально **54/54** связанных теста. Пять новых сценариев проверяют полную композицию реальных модулей через mock GET transport, отсутствие source без записи состояния, stale head/ineligible failure/занятый claim/красный CI, отказ при provider credentials/неверной истории/операции run и data-only envelope без getters. Это не новая живая задача. `node --check` script успешен; точный `git diff --check` выполняется в отдельном сравнительном индексе. Локальная копия частичная и не является checkout репозитория.

Настоящий source CI [40288806670](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40288806670), job `121458748954`: **pnpm typecheck PASS, pnpm test 2392/2392 PASS, ошибок 0**. Лог прочитан.

Настоящий новый preflight [40289056515](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40289056515), job `121459550690`, event commit `72184e41523a55d70bc4f5e52aa5a1237b673412`: техническая инспекция PASS; итог **blocked-source-missing**, sourceVerified:false, ledgerPresent:false/budgetStatus:not-initialized. 3 GitHub GET, 0 storage GET, 0 GitHub API mutation requests в инспекции, 0 model calls. Source collection, host tests, sandbox, owner approval и execution остаются false. Runtime source CI проверен до инспекции.

Отдельно upload-artifact сохранил source-free метаданные: artifact `12635104022`, 579 байтов, GitHub-reported ZIP SHA256 `079ce0718910ff9ff141875d95d3af92c41b3fa736a620fdb0771e1966d2bc80`. Этот output ZIP не скачивался и локально не пересчитывался; содержание отчёта проверено по native job log. Подлинный приватный архив задачи не выбран и в этом запуске не загружался.

## Что остаётся

Этот этап соединяет source/state/budget ИНСПЕКЦИЮ. Он не заменяет производственный исполнитель: надо закрепить полный подлинный сбор исходного состояния (ZIP inventory не доказывает полноту сборщика), выбрать пригодную ошибку, проверить фактических предшественников реальными Node/browser tools и sandbox, затем связать подлинный owner-budget controller и обязательный project runtime с атомарным claim на момент исполнения. Нельзя превращать read-only результат в capability исполнения.

Для живого HTTP модели дополнительно нужны точное новое согласование бесплатного бюджета, подлинный owner comment и отдельная инициализация ledger полной историей. T05 по-прежнему исчерпан 11/11; operator inspect/ownerDecision:null. История неизменна: 59 запросов, 553908 байтов, 230413 reserved tokens. Это консервативные резервы, не счёт провайдера. Новых вызовов модели в этом этапе нет.

Юридический агент выключен. Codespaces, платные API и новые вспомогательные агенты не использовались. Универсальная автономность и полный шаг 9 не закрыты.
