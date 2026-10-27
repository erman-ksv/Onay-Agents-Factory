# Этап10.13 — исполнитель следующей задачи и удалённые encrypted checkpoints

Дата:27.10.2026. Factory feature-ветка `feat/calculator-t02-charge-reconcile-20261022`, Draft PR75. Main, Onay, Calculator и действующий project-model-budget ref не изменяются.

## 1. CI → реальный путь исполнения следующей задачи: код соединён

`projectCiDelivery` выдаёт только genuine one-use host notice после записи claim. Копия/JSON не может запустить worker. `createProjectCiRuntime` соединяет этот путь с genuine archive и fixed native `projectNextTaskWorker`: fresh source snapshot на parent candidate → проверка dependency CI и durable claim → новое admission/стабильный executionId с запретом прежних WAL reservations →60s cooldown →author →Security →Reviewer →Tester →native host Node tests →publication approval →leased Draft publisher →encrypted candidate receipt. При публикации следующего кандидата он ещё НЕ считается CI-прошедшим. Новый exact-candidate CI доставляется отдельно; последняя задача завершает журнал без нового callback.

Никаких произвольных команд, модели-оркестратора с полным private source, changes to expected answers или обхода ролей. Author/review contexts проходят существующие лимиты. Native composition не принимает simulated archive/notice/test proof. На любом 429/отрицательном review/unverified tests/неподтверждённом persist — остановка, расходы и claim сохраняются. Это one-pass successor worker: существующий qualified correction механизм остаётся отдельным, здесь отрицательное review не запускает автоматически новое исправление. Произвольный crashed in-flight task не переигрывается.

Важно: эта generic policy пока проверяет Node contracts. Для frontend Calculator, browser/Expo/device потребуются соответствующие immutable host acceptance policies. Сам факт Node PASS не разрешает объявить UI/мобильное приложение готовым.

## 2. Удалённое хранение: реализован GitHub encrypted archive

`projectCheckpointArchive`: отдельный fixed Factory ref `state/project-checkpoints/<projectKey>`, только зашифрованные checkpoint envelopes, task/sequence/hash/previousHead metadata. Git blob/tree hashes проверяются. Каждый immutable event — новый commit; ref advance только non-force CAS с уникальным commit nonce. Два конкурента не могут оба подтвердить одну append. При unknown acknowledgement writer permanently stops; автоматических retry/reset/ref recreation нет. Model-budget/source/main refs этим адаптером не используются.

К началу HTTP или push worker ожидает подтверждение сохранения соответствующего encrypted checkpoint. HTTP WAL reservation остаётся до checkpoint; потеря его подтверждения не вызывает HTTP и не возвращает расход. CI claim сохраняется до запуска worker. `materializeProjectRuntimeArchive` проверяет genuine store, ciphertext/key/GCM/task/plan/grant/high-water и создаёт только encrypted files в свежих приватных journal/runtime каталогах. Capabilities не десериализуются и HTTP не повторяется.

Reopen требует trusted latest pin `{head,sequence}`. Отсутствующий/откаченный ниже pin ref отказывает, pin=null допускает только явно отсутствующий archive. Git CAS и pin не доказывают отсутствие привилегированного отката после устаревшего pin: production обязан сохранять latest pin вне rollback-prone caches и/или защищать ref от force/delete. Эта часть deployment policy пока не подтверждена.

`loadProjectRuntimeRecoveryKey`: только отдельный persistent32-byte canonical base64 secret, без генерации/fallback/provider/Git token reuse/неявной ротации. Repository secret: `FACTORY_RECOVERY_KEY_BASE64`; key ID в readiness workflow: `onay-runtime-key-v1`. Key values не печатаются и не попадают в артефакты/приложение. Отдельная readiness job проверяет только наличие/формат, без модели или изменения ключа.

## 3. Проверки и область подтверждения

Source `2b2b058727f5ac170ffd064357e40b723c91e134`: [CI40444959205](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40444959205), job121993912409: **pnpm typecheck PASS; pnpm test2620/2620 PASS**, failures0.12 новых cases:5 successor и7 archive/key. Local related24/24. Exact isolated diff-check PASS; исходный локальный каталог не git checkout. Локальных dependency installs и Codespaces не было.

В локальном составном сценарии:2 задачи,8 MOCK replies,2 LOCAL Git pushes, fixture CI, encrypted archive9 events и rehydrate9files; второй candidate проходит отдельную CI delivery, duplicate не вызывает модель. Неуспехи проверяют429, отрицательный review, unverified isolation, persistence failure после WAL, конкурентное создание, lost acknowledgement, missing/rollback ref, key/source corruption и authority copies. Внешний GitHub/owner/CI пока MOCK в этих локальных тестах.

Native audit: [Native40445190178](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40445190178), verify job121994667850 SUCCESS:2actual Docker checks,2actual LOCAL Git pushes,8MOCK model replies,10reachable native Factory SYNTHETIC encrypted state events,1CAS winner/1loser,rehydrated9encrypted files. Archive state pin ebe365ae0f9fc3cfcc7234bd3f01cd1768849557/sequence10. Synthetic key создан в памяти fixture и не предназначен для дальнейшего production восстановления. Native audit не активирует рабочий production executor. Он предназначен для2 реальных Docker проверок и native GitHub writes ТОЛЬКО в synthetic Factory state namespace; app Git/PR/модели/CI остаются fixtures. Native storage proof не означает реальную публикацию приложения или живую работу специалистов модели.

## Фактические блокеры запуска

- Persistent recovery key: **не настроен**: readiness job121994668123, recoveryKeyConfigured=false, runtimeBlocked=true, key/provider calls/writes0. Межмашинное восстановление production key/latest pin и branch protection ещё не подтверждены; ключ не генерируется этим запуском.
- Проверен действующий owner comment6413719353: `mode=read-only-review`, expires2026-11-01T00:00:00Z, maxRequests65. Все65 запросов уже заняты/израсходованы; remaining.requests0. Для реального написания кода нужен новый точный development допуск на выбранный plan/tasks/profile с ограниченным allowance. Continue не расширяет этот grant.
- Production entrypoint/live next-task acceptance ещё не активированы. Нужно зафиксировать реальную следующую задачу и её host acceptance policies, durable key/latest-pin/ref policy, подключить native CI event к этому fixed runtime и подтвердить реальный полный цикл. Node fixture не заменяет browser/Expo/device проверки. Завершённый T05 не переигрывать; Calculator input defects остаются новой недиспетчеризованной задачей.

Итого: код generic successor execution и encrypted remote persistence реализован; подтверждение полной production автономности и всех3 пунктов НЕ заявляется. Реальных provider calls/app writes/реальных budget writes0; legal=false. Ни merge, ни deployment не выполнены. Исторические расходы/ошибки сохранены.
