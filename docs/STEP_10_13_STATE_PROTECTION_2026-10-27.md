# Этап10.13 — обязательная проверка защиты состояния перед native activation

27.10.2026. Изменения только в Factory feature-ветке `feat/calculator-t02-charge-reconcile-20261022`, Draft PR75. Main, приложения и реальный бюджет не изменены.

## Что исправлено

До этого production activation зависел от заявленного trusted latest pin/ref policy, но сам native worker не требовал проверяемого подтверждения no-force/no-delete правил. Теперь `projectStateProtection` получает effective rules из GitHub для двух точных ref имён текущего projectKey: `state/project-checkpoints/<projectKey>` и `state/project-model-budget/<projectKey>`. Для каждого нужны `deletion` и `non_fast_forward`, с подтверждёнными repository ruleset details, enforcement=active и пустым bypass_actors.

Подготовленный capability genuine, связан с тем же development controller и native/test provenance. JSON/копии/getters/foreign controller и simulated proof не могут разрешить native runtime. Native adapter фиксированный, GET only, без redirect/retry, bounded18requests/30s/64KiB-response. Missing/403/pagination/malformed/oversized/foreign/disabled/evaluate/bypassable rules — отказ без fallback.

Native worker требует этот capability при конструировании. Fresh verification выполняется перед исполнением, в source/dependency admission guards и перед checkpoint persistence; coordinator проверяет также перед сохранением CI claim. Изменение правил/отзыв owner authority вызывает latched stop. Уже зарезервированные расходы сохраняются; новые роли/push не продолжаются. Штатные independent roles/host tests/budget/CI не ослаблены.

Для просмотра подготовлен `.factory/runtime-state-ruleset-template.json`: active branch ruleset с пустыми bypass actors, ровно два state namespace, запрет deletion и non-fast-forward. **Шаблон НЕ применён.** Он не нацелен на main/feature source refs и не расширяет model allowance. Ключи/секреты в нём отсутствуют.

## Проверки

Source `742ddfd3906653cce4553efebb960a42c40897b2`. [CI40447777826](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40447777826), job122003038716: **pnpm typecheck PASS; pnpm test2629/2629 PASS**, failures0..

Local14/14 related tests PASS,9 новых protection cases. Проверены happy path с обычным4-role successor и host test, отсутствие одного правила/одного namespace, inactive/evaluate/bypass/foreign rules, revocation/drift latch, forged/native-test separation, permission/pagination/size failures. При удалении защиты во время model response останавливается уже после1 MOCK запроса, temporary charge4→5 сохраняется, следующей роли и второй публикации нет.

Native positive protected-rules activation **не подтверждена**: в реальном репозитории пока нечем подтвердить active rules. Предыдущий native Docker/archive proof40445190178 остаётся отдельным доказательством своей версии/fixture, а не проверкой нового native positive guard. Новых model calls/app/budget/state writes в этом этапе0; legal=false. Локальные зависимости не устанавливались, Codespaces и новые агенты не использовались.

Exact isolated diff-check PASS. Исходный local source directory не git checkout: diff сформирован по before/current в отдельном каталоге.

## Реальное состояние конфигурации

Native GitHub connector GET `/repos/erman-ksv/Onay-Agents-Factory/rulesets?includes_parents=true&per_page=100` вернул `[]`27.10.2026. Значит repository/inherited rulesets пока отсутствуют. Это не утверждение об отсутствии любых legacy branch protections; новый activation guard специально требует effective active no-bypass rulesets на state refs.

Последняя secret readiness121994668123 показала recoveryKeyConfigured=false для `FACTORY_RECOVERY_KEY_BASE64`. Никакой recovery key не генерировался и не печатался. Действующий owner comment6413719353 — read-only-review, remaining.requests0. Continue не меняет этот допуск.

Административные изменения rulesets и Actions secrets недоступны через предоставленные GitHub mutation tools. Доступный connector fetch поддерживает для этих правил GET; изменение кода/PR не включает правила репозитория автоматически. Поэтому template подготовлен для просмотра/импорта владельцем через Settings→Rules→Rulesets. Отдельно остаются persistent recovery key, актуальный trusted latest pin/ref policy, точный development grant и real task/acceptance/event entrypoint. Для UI/Expo Node contracts не заменяют browser/device acceptance. Production autonomy/все3 пункта целиком НЕ закрыты.
