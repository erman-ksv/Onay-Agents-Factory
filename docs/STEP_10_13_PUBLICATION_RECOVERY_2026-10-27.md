# Этап10.13 — read-only восстановление публикации после остановки процесса

Дата:27.10.2026. Factory feature-ветка `feat/calculator-t02-charge-reconcile-20261022`, Draft PR75. Весь Onay и Calculator отдельно; код приложений вручную не исправлялся.

## Результат

Publisher выдаёт genuine opaque intent после проверки локально созданного exact parent/tree/changed paths/blobs. Host checkpoint может один раз зашифровать intent перед push: plan/task/owner/profile, root/parent/candidate/tree SHA, file blob/SHA256/bytes, proposal digest и budget project/grant/high-water. Исходный код, ответы модели и секреты в intent отсутствуют. Используется существующий AES-256-GCM codec, независимый host key, exclusive0600 файл и0700 каталог с fsync. Скопированный intent не авторизует сохранение.

`restoreProjectPublication` имеет фиксированный production GET-only adapter. Восстановление проверяет живое owner-разрешение и тот же budget grant без уменьшения расходов; genuine plan/profile/task identity; неизменённый owner root; exact feature head; single-parent candidate и ограниченную ancestry≤32 до owner root; parent/candidate trees, точный набор разрешённых изменённых файлов, blob SHA1/SHA256/bytes; единственный открытый Draft PR в том же репозитории и с правильной базой. Запросы ограничены128calls/45s, ответы/деревья/содержимое ограничены по размеру, pagination отказывает. Current guards повторяются перед последующим CI.

Восстанавливается только read-only capability существующей публикации. Это НЕ новое разрешение push/PR/model/deployment и НЕ прохождение CI. После восстановления нужно собрать fresh exact-candidate CI evidence. Production отказывает simulated intent; injected test transport всегда даёт simulated output. CI delivery теперь привязывается к plan/controller существующего или восстановленного кандидата без фиктивного повторного publication approval.

Lost push acknowledgement при уже существующем Draft восстанавливается без repush/PR write. Если PR ещё не создан, SHA сдвинулся, owner отозван, proof повреждён или результаты неоднозначны — остановка для разбора, без автоматического исправления публикации.

## Проверки и точная область доказательств

Исходники c9de9e87ad5a56e0711a047295d33d97da5484f5; [полный CI 40442065048](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40442065048): **pnpm typecheck PASS; pnpm test2608/2608 PASS, failures0**, job121984488595.

13 новых regression cases. Локально связанный набор45/45 на предыдущей редакции; окончательные recovery13/13 PASS, включая проверку2 отдельных новых host processes. Они заново создают genuine plan/controller через trusted fixture и только читают существующий временный ledger: initialize/model execution не вызываются. Первый процесс восстанавливает публикацию→fresh fixture CI→один scheduler notice, второй восстанавливает снова→already-recorded/0callbacks. Временные расходы4→4→4;0model calls в обоих receiver. Проверяются разные PID, отсутствие HTTP mutations/Git push/новых reservations. Test recovery key хранится отдельно от checkpoint/app и удаляется при cleanup; не является production key provisioning.

Owner/model/PR/CI — MOCK; Git remote — настоящий LOCAL bare Git, ledger/checkpoint — реальные локальные файлы, receivers — реальные отдельные Node processes. Это shared-host persistence proof, НЕ реальная native GitHub публикация и НЕ разные машины. Full native publication/recovery/next-task run не заявлен. Secret/private source не выводились. Реальных provider calls, application writes и remote budget writes0; legal=false. Исторические расходы и failures не сбрасывались. Локальных installs, Codespaces, новых агентов и paid APIs нет.

Typecheck первого промежуточного source866c6a8 обнаружил3 ошибки типовunknown HTTP input; они исправлены. Окончательный Typecheck и тесты относятся к c9de9e87ad5a56e0711a047295d33d97da5484f5, не к промежуточной версии. В тесте child worker разрешается tsx loader для CI и используется private stdout file descriptor; production shell/HTTP не менялись.

Exact isolated diff-check PASS. Локальный исходный каталог не git checkout; diff составлен по before/current файлам в отдельном каталоге.

## Что осталось

1. Fixed production worker после CI: durable reconstruction plan/controller, fresh dependency/source/CI guards, genuine admission и cooldown, запуск следующей4-role задачи с host tests/publication/exactCI. Сейчас scheduler notice не равен исполненной следующей задаче. Для повторного старого CI после движения ветки worker должен сначала прочитать durable journal и распознать уже обработанную задачу, прежде чем восстанавливать старый candidate.
2. Production key provisioning и durable state между машинами; внешняя monotonic защита от отката/удаления всего журнала. Потерянные/неоднозначные push/PR и stale lock не разрешают автоматический повтор.
3. Подтверждение реального полного перехода на новой задаче и отдельный точный owner allowance. Действующий бюджет remaining.requests=0; Continue не добавляет квоту. Browser/Expo/device/general project autonomy и полный Calculator release остаются unverified.

Этап10.13 целиком ещё НЕ закрыт. Read-only publication reconciliation реализован и проверен с указанными mock/shared-host ограничениями. Main/Calculator/ledger refs сохранены; merge/deployment не выполнялись.
