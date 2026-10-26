# Этап 10.8 — настоящие host-проверки точного предложения

26.10.2026. Продолжение Factory после этапа10.7. Onay и Calculator не редактируются.

## Что добавлено

Host-only политика задаёт закреплённый digest Node image, проверяемые экспорты функций, входные значения, ожидаемые ответы и связь с критериями задачи. Политика неизменяема, связана с genuine планом/задачей и не принимается из ответа модели. Произвольных команд, установки зависимостей и callback «тесты прошли» в production API нет. Этот механизм рассчитан на небольшие JavaScript/Node контракты, а не на сборку React Native/Expo, физический GPS или браузерную приёмку.

Проверяемые файлы собираются из verified snapshot и точного prepared proposal; хешируются все файлы, включая неизменённые зависимости. При изменении исходного ref результат теряет силу. Проверки выполняются в Docker без сети, root, capabilities и записи в source/root filesystem; ограничены время, память, процессы и вывод. Секреты и среда host не передаются. Недоступный Docker не заменяется запуском исходника на host.

Фиксированный trusted supervisor смонтирован отдельно от приложения и read-only. Он проверяет syntax и результаты вызовов экспортов в ограниченных дочерних процессах. Ожидаемые ответы сравниваются в supervisor, не передаются приложению как часть входных данных. Проектный stdout не является готовым receipt. Ошибки, повреждённый вывод и неизвестные проверки не могут разрешить успех; наружу выходят только фиксированные коды и metadata, без исходников, stack traces или сырых сообщений процесса.

Receipt привязан к plan/task/base commit, точному proposal, политике и digest всего набора файлов. Genuine receipt хранится в приватном реестре. Копия JSON, чужое предложение и устаревшая версия отклоняются. Test-only process injection всегда помечает receipt как simulated; production verifier не может принять его как настоящий.

После четырёх независимых положительных мнений transport принимает host-test proof только через этот verifier и только для собственного genuine предложения. Ранее runtimeTestsVerified всегда оставался false; теперь он может быть установлен по настоящему успешному Node receipt. При этом coverage явно ограничено host-selected-node-contracts-only, а browserTestsVerified, ciVerified, publicationAuthorized и wholeAppCompleted остаются false.

## Проверки и доказательства

- Локально: **177/177** целевых тестов; **12 новых** regression tests. Из них source/context/replies + Node suite:53/53.
- Typecheck и полный CI: [CI40376173448](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40376173448), source `f0ecc1d9c2c6f2effb7dbc4e86785669451ff729`, job121759705193: **pnpm typecheck PASS; pnpm test2513/2513 PASS, failures0**.
- Настоящий Docker: [Audit40376621059](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40376621059), job121761299795: **SUCCESS,6/6 ожидаемых исходов**. Правильный контракт passed; wrong-result, early-exit, forged-project-output, outside-app-read и незавершённый async — failed. Genuine native receipt прошёл verifier, copy/foreign proposal/stale source/replay отклонены. Кейс с именем timeout использует незавершённый Promise; отдельный native wall-time timeout этим не подтверждается, соответствующая обработка проверена на process mocks.
- Точный diff: **git diff --check PASS**; 12 files changed, 489 insertions(+), 4 deletions(-)..

В локальной среде доступ к Docker socket запрещён (operation not permitted). Поэтому локальные process mocks не объявляются настоящими проверками. Для native доказательства используется отдельный GitHub runner и тот же закреплённый Node image, что у прежнего пилота; никаких provider/writer secrets и package installs в audit job. Исходники — небольшой синтетический host fixture, а не приложение владельца. Успех такого audit не является реальным запуском команды на втором проекте.

Новые regression tests проверяют immutable policy/criteria coverage, запрет getters/commands/неизвестных путей/moving image, точный overlay с зависимостями и file digest, mock/native разделение, failed/unverified результаты, отказ без Docker/подходящего runtime, timeout/oversized/malformed output, stale source, удаление временных файлов, запрет повторного запуска и подмены host proof после всех model opinions. Старые эталоны Calculator и проверки Security/Reviewer/Tester/CI не ослаблялись.

## Что ещё осталось

1. Ограниченный самостоятельный цикл исправления по отрицательным review/host test результатам и восстановление без повторного расхода.
2. Generic publication, exact-candidate CI и доставка результата с защитой от дубликатов.
3. Отдельная native planning/live квота и реальный полный прогон; remaining.requests сейчас0.

Для React Native/Expo, браузера, устройства и зависимостей потребуются отдельные host-политики/адаптеры. Их прохождение здесь не заявлено. Полная универсальная автономность, выпуск Onay и устранение новых ошибок Calculator ещё не подтверждены.

No real model calls, budget writes, application changes, merge/deployment, Codespaces, paid APIs, local dependency installs or new agents. Main и ledger сохраняются; legal disabled. Обычный полный CI использует существующий install на GitHub runner. Audit runner только готовит ранее используемый pinned image; сам production sandbox не выполняет pull и не устанавливает зависимости.

[Машинное доказательство](../.factory/project-node-tests-proof-20261026.json).
