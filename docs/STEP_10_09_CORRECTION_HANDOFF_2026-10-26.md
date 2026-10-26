# Этап10.9 — задание на одно исправление по genuine failure

26.10.2026. Продолжение этапа10.8; модель не вызывается, Onay/Calculator не редактируются.

## Решённая часть

Из отклонённого genuine предложения можно подготовить одно проверяемое задание на исправление. Принимаются два вида доказательств: разобранный независимый verdict changes-requested с конкретными warning/error findings в пределах задачи; либо настоящий выполненный native Node test со статусом failed, связанный с тем же предложением и immutable host policy. Для host-test пути предварительно нужны все четыре независимые фазы текущего цикла.

Ready, blocked/нехватка данных, пустые/info-only замечания, повреждённый ответ, HTTP429, произвольный JSON и simulated host result не становятся разрешением на исправление. Контрактные коды ошибок привязываются к файлам через genuine host policy, а не догадкой по первому изменённому файлу. Ошибка за пределами разрешённых файлов не скрывается частичным исправлением: handoff отказывается.

Задание содержит repository/plan/task/base SHA, digest отклонённого предложения и доказательств, число замечаний и детерминированный ID. Исходники и текст замечаний остаются в приватной памяти; наружу выходит metadata. Для одного предложения выдаётся только одно задание.

Для автора можно однократно подготовить bounded correction context: проверенные фрагменты оригинального и отклонённого кода, конкретные причины отказа и точные непоказанные области. Исправление должно заменить всё предложение относительно ОРИГИНАЛЬНЫХ SHA, сохранить критерии владельца/ожидаемые ответы и повторно пройти независимые review и host tests. Повторная, параллельная, поддельная, устаревшая или чрезмерно широкая подготовка отказывается. Все прежние byte/token/source caps сохраняются.

## Граница авторизации

**Это подготовка задания и контекста, а не выполненная попытка исправления.** Handoff явно имеет modelCallsAuthorized0, budgetResetAuthorizedfalse и status needs-qualified-correction-admission. Обычный first-attempt transport отклоняет correction packet до резерва и HTTP. Нельзя обойти четыре запроса первой попытки, открыть тот же scope повторно или превратить сохранённый JSON в разрешение.

Следующий отдельный блок — квалифицированный допуск исправления и его сохранение/восстановление с тем же проектным ledger, отдельными однозначными ID резервов и ограничением попыток. Нужны новые reviews/tests результата и общий бюджет. Никакой новый live allowance здесь не выдан; remaining.requests0. Самостоятельное исправление до публикации ещё не подтверждено.

## Проверки

- Локально: **189/189** целевых тестов, **12 новых** regression tests. Проверены genuine negative review, приватность, original/rejected context, отсутствие нового резерва в fresh worker, copied/edited handoff, ready/blocked/empty/info refusal, single/parallel preparation, injection/getters/full-source/stale отказ, malformed response и fake native failure.
- CI: [CI40378694175](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40378694175), source `7b589b887209161e87d13223f921de8876976560`, job121768694063 — **pnpm typecheck PASS; pnpm test2525/2525 PASS, failures0**.
- Native Docker: [Audit40378985837](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40378985837), job121769748791 — **SUCCESS,6 ожидаемых исходов**; genuine executed-failure verifier и точное сопоставление contract code→policy file прошли. Источник синтетический, Docker настоящий;0 model/budget/app writes. Кейс timeout относится к незавершённому Promise, отдельный native wall-time timeout не заявлен.
- Точный diff: **git diff --check PASS**; 11 files changed, 303 insertions(+), 25 deletions(-)..

Native audit выполняет синтетический host fixture в настоящем Docker и проверяет genuine executed-failure verifier с точным policy→path mapping. Это не реальный новый Groq запуск и не полный native correction loop. Комбинация review handoff проверяется на fake provider/owner и настоящем временном file ledger, с явной меткой локальных имитаций. Сценарии/ожидаемые ответы Calculator не менялись; тестовый helper холодного worker только читает существующий ledger, не инициализирует его заново.

Полный общий pipeline также ждёт generic publication/exact-candidate CI/delivery/deduplication и отдельный planning/live allowance. Browser/device/Expo остаются отдельными непроверенными областями. Все расходы/ошибки сохраняются, no refund/reset/replay. Юридический агент выключен. Без merge/deployment, платных API, Codespaces, локальной установки зависимостей или новых агентов.

[Машинный отчёт](../.factory/project-correction-handoff-proof-20261026.json).
