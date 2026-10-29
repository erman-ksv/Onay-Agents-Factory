# Этап10.11 — зашифрованное восстановление перед исправлением

26.10.2026. Продолжение этапа10.10. Реальные модели, новый owner grant, приложение Onay и Calculator не используются.

## Реализованная точка восстановления

Состояние genuine correction handoff и bounded selected context можно сохранить **до квалификации/отправки второй попытки** и восстановить в новом host-процессе. Записываются только AES-256-GCM ciphertext, nonce/tag и идентификатор ключа. Ключ, полный текст предложения и замечаний не записываются открытым текстом и не становятся Commander metadata. Изменение ciphertext, tag, nonce, keyId или внешнего SHA даёт отказ. Нужен отдельный host-owned32-byte secret; нет fallback на API token, plaintext или автоматически сгенерированный production key.

Файл создаётся однократно с O_EXCL/O_NOFOLLOW,0600 и file/directory fsync в private0700 parent. Symlink/hardlink, неизвестная схема, слишком большой/обрезанный файл, permissive mode и traversal path отказываются. Частичный или существующий файл не перезаписывается на retry.

При сохранении запоминаются binding проекта/плана/владельца/профиля, base SHA, genuine rejected proposal/failure evidence и high-water counters/grant digest. После расшифрования снова проверяются current owner approval, native controller, исходники и тот же ledger; оригинальный bounded patch проходит валидацию заново. SHA восстановленного model request должен полностью совпасть с сохранённым. JSON checkpoint без host key/capability не создаёт authority; старые положительные review не восстанавливаются как разрешение.

Новый read-only inspectExecution проверяет наличие reserve для стабильного correction-1 execution ID. **Любой резерв второй попытки, в том числе uncertain checkpoint перед HTTP, блокирует восстановление.** Ledger не инициализируется заново, прежние расходы не сбрасываются. Восстановленный handoff проходит обычный qualified admission,4 независимые фазы и реальные host tests. Два recovered worker не могут отправить два первых запроса: общая WAL/CAS и одинаковый reservation ID разрешают не более одного.

## Проверки

- Локально **221/221** целевых тестов, **20 новых** regression tests; source/context/reply/Node group97/97.
- Typecheck/полный CI: [CI40386189954](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40386189954), source `1502dac7ed6061b62e6d555fa4cee1a3e49c61ce`, job121794965871: **pnpm typecheck PASS; pnpm test2557/2557 PASS, failures0**.
- Настоящий cross-process Docker audit: [Audit40386663143](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40386663143), job121796630464: **SUCCESS**.4 отдельных процесса save→tamper/wrong-key refusal→resume→post-reservation refusal; temporary ledger4→4→8→8,8 MOCK replies,2 настоящих Docker checks (failed→passed), один неизменный oracle. Request SHA до/после restore совпал: `82de2613e11cac4efae72c881dc3a5d54968c6e202642bfc933bd588f1b16fc4`. Checkpoint3208bytes, ключ/исходник не попали в metadata/artifact.
- Точный diff: **git diff --check PASS**; 13 files changed, 426 insertions(+), 20 deletions(-)..

Проверены encryption/privacy и отсутствие ключа в файле, exact context reproduction/new controller, новый четырёхролевой цикл с прежними расходами, неверный/copied/destroyed/mutated key, tampering даже при заново вычисленном внешнем SHA, filesystem bounds, owner/source loss, ledger rollback, too-late/sealed save, успешный или uncertain reserve, racing recovered workers, forged native controller и authenticated-but-inconsistent stage/identity/proposal/request.

## Границы и оставшаяся работа

В native audit модель, approval и исходники синтетические;4 отдельных host-процесса используют один private filesystem одного GitHub runner, один временный ledger и fixture key вне приложения/checkpoint. Docker tests настоящие. Это не реальный Groq прогон, не cross-machine deployment и не production provisioning ключа/хранилища. Реальных model calls, grants, remote budget/app writes0.

**После начала второй попытки автоматического продолжения/повтора нет:** при любом reserve механизм безопасно останавливается. Этот этап не восстанавливает произвольный mid-HTTP ответ, опубликованный candidate или уже исполненные review по недоверенному JSON. Для таких состояний нужна отдельная подтверждённая reconciliation.

Смена grant digest или версии ключа требует отдельной миграции; автоматический перенос такого checkpoint не выполняется.

Для постоянной эксплуатации обязательны независимый persistent host secret и durable ciphertext storage; их production-настройка этим этапом не подтверждается. Следующий инженерный блок — generic candidate publication/exact-CI delivery/deduplication и итоговое восстановление безопасных состояний. Затем отдельный реальный planning/live allowance и полноценный прогон; настоящая remaining.requests0 сохраняется. Browser/device/Expo/выпуск Onay отдельно не подтверждены.

Main, приложения и настоящий project ledger не меняются. No merge/deployment, paid APIs, Codespaces, локальных dependency installs или новых агентов; legal disabled. Исторические failures/reservations сохраняются. GitHub audit получает только read token, использует тот же pinned Node image и не получает provider/writer secrets; fixture key уничтожается вместе с приватным временным каталогом.

[Машинный отчёт](../.factory/project-correction-recovery-proof-20261026.json).
