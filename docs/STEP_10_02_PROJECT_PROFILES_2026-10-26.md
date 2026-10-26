# Этап10.2 — разрешённые профили и независимый бюджет проектов

26.10.2026. Реализован фундамент переноса Factory на другие проекты. Универсальный авторский executor ещё не подключён: второй проект не запускался, новый production target не зарегистрирован.

## Что изменилось

`orchestration/projectTargetRegistry.ts` — host-only реестр. Доверенный код Factory явно регистрирует профиль с репозиторием, разрешёнными файлами, feature-prefix веток, обязательными CI names/steps, Security/Reviewer/Tester и ограничениями объёма. Профили/списки immutable, fingerprint детерминированный. Неизвестный ID, JSON-копия и поддельный target не дают capability. Нет автоматической загрузки из Commander, модели или env. Пустой/опасный профиль, повтор ID/repository, скрытые поля/getters, traversal, .github/.env/AGENTS/dependency manifests, main, merges/legal и отказ от обязательных ролей отклоняются. Реестр не даёт разрешения на исполнение или оплату модели.

`orchestration/projectBudgetAuthorization.ts` — прежний Calculator путь без профиля сохранён. Другой репозиторий допускается только с подлинной host capability и отдельным настоящим неизменённым OWNER комментарием, в котором дополнительно подписан `targetProfileSha256`. Сохраняются checks автора/ассоциации/issue/body digest/срока, полный исторический digest и разрешённый mode. Scope передаёт immutable capability host-инструментам. Произвольный JSON или env не заменяет native approval.

Project ledger namespace по-прежнему зависит от projectId/repository/planFingerprint/ownerFingerprint. Разные проекты изолированы; новая редакция профиля ТОГО ЖЕ проекта не меняет адрес ledger и не сбрасывает reservations. Новый profile fingerprint должен быть одобрен отдельно, но не создаёт новый allowance. Старый Calculator key `30aba2ef57704b41551ee67ae250315a8ec6a83963987f2e6533dbc20f7f70f0` не меняется.

## Проверки

Source `c393769bba4f8d520ff8aba41b4ba26067eb9039`, [CI40321529096](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40321529096), job121567387135: **pnpm typecheck PASS; pnpm test2428/2428 PASS**, failures0. Предыдущая версия также прошла2428; после внутренней проверки namespace уточнён так, чтобы изменение профиля сохраняло тот же ledger. Регрессия действительно проверяет сохранение уже списанного резерва и отказ повторной initialize.

[Настоящий новый worker40321794272](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40321794272), job121568294217 — SUCCESS, runtime закреплён на c393769. Native OWNER/controller прочитал старый Calculator ledger: used65/626530/263359, remaining.requests0, отказ до source/model,14GET/0write/0model, ledgerUnchanged:true. Ledger commit по-прежнему `b139646c2f359fe23f213e0a3227aa99dd84f369`. Совместимость проверена реально; новая production регистрация/owner approval другого проекта не заявляются.

[Machine proof](../.factory/project-target-profiles-proof-20261026.json). Полный exact isolated git diff --check PASS. Native check не имеет модельных ключей/write permission, не инициализирует бюджет и не меняет приложение.

14 новых regression cases: immutable/unknown/copied capability; fingerprint scope; unsafe profiles; getters/sparse input; repo/branch/path guard; genuine target + owner; missing/swapped signed profile; owner edits; native author/issue/grant restrictions; per-project keys; stable scope after mutation; charges isolated and retained across profile revisions; legacy key; native store namespace/injection refusal.

Связанный локальный прогон123/123 PASS. Первый широкий локальный прогон остановил два файла тестов из-за отсутствующего history fixture в временном compile каталоге; после копирования исходного .factory/project-budget-history.json все123 прошли. Зависимости локально не устанавливались.

## Что не подтверждено

Новый реестр не выдаёт модели произвольный выбор репозитория. Нет нового OWNER grant/production profile/инициализации ledger/модельного HTTP/изменения приложения. Новая авторская команда ещё использует Calculator-specific planning, tools, sandbox и CI adapter. Для полного переноса нужно соединить профиль со всеми этими gate, затем проверить второй явно выбранный проект по цели владельца и отдельному бюджету. Нельзя просто подменить CALCULATOR_PROFILE или снять allowlist.

Настоящая новая author/native-approved цепочка второго проекта пока не выполнялась. Проверки нового профиля и новых native approvals в unit tests используют синтетические данные и mock HTTP; их не выдаём за реальные owner решения. Реальная проверка ниже относится к совместимости старого Calculator ledger.

Main, Onay/Calculator, эталонные сценарии, текущие workflows разработки приложения, прежние reservations и роль юридического агента не меняются. Merge/deployment/Codespaces/платные API/новые агенты отсутствуют. Текущий Calculator budget остаётся исчерпанным; новых модельных запросов0.
