# Этап 10.13 — устойчивый приём CI: механизм уведомления планировщика

Дата: 27.10.2026. Область: Factory, feature-ветка `feat/calculator-t02-charge-reconcile-20261022`, Draft PR75. Main, Onay, Calculator и реальный бюджет не изменены.

## Сделано

- `projectCiDelivery.ts`: принимает genuine successful exact-candidate CI confirmation; production отказывает simulated/copy/pending/failed evidence. Проверяет plan/controller/profile/owner/grant, непрерывность parent SHA и зависимости задач.
- До вызова host scheduler сохраняется immutable AES-256-GCM запись: exact candidate, workflow policy digest, plan/task identity, SHA предыдущей записи, project budget high-water и единственная заявка на следующую задачу. Каталог0700, файлы0600, exclusive creation, file/directory fsync и exclusive lock. Source/ключ/модельные ответы в журнал не записываются.
- Повторное событие возвращает already-recorded, включая новый экземпляр сервиса и уже изменённую ветку. Два конкурентных события не вызывают scheduler дважды. Неизвестный результат callback остаётся claimed/dispatch-uncertain и автоматически не повторяется. Оставшийся после аварии lock автоматически не удаляется.
- При недостатке бюджета CI записывается как budget-blocked без callback/новой квоты/reset. Последняя задача сохраняется без запуска следующей.
- Scheduler получает только notice с executionAuthorized=false, требованиями fresh source/admission и cooldown. Это ещё не разрешение выполнения: fixed worker обязан самостоятельно получить genuine admission и повторно проверить зависимости.
- Primary admission поддерживает только добавление conservative cooldown. Перед первым запросом successor —60 секунд с fresh guards каждые≤15 секунд. Независимые Security/Reviewer/Tester, host tests, owner/authorization и terminal429 сохранены. Publication preflight повторяет admission dependency guards.

## Проверки

Исходники: `fe1fdf093a77480af1282e28d5e45a3c2bf810f2`. [Полный CI40440924319](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40440924319), job121980806855: **pnpm typecheck PASS; pnpm test2595/2595 PASS, failures0**. Предыдущая промежуточная версия имела два неправильно подготовленных теста повторного admission; тестовая подготовка исправлена без ослабления защиты.

Связанный локальный набор133/133; затем окончательный source/context набор90/90, включая2 новых cooldown cases. Новых регрессий всего14:12 delivery+2 cooldown. Exact isolated `git diff --check` PASS. Локальный каталог исходников не git checkout: diff сформирован по сохранённым before/current файлам в отдельном каталоге. Зависимости локально не устанавливались.

Fixture использует4 MOCK model replies, MOCK owner/CI/PR и реальный LOCAL bare Git. Для этого этапа новые native Docker/model/application runs не проводились. Никакого дополнительного подтверждения полной автономности эта проверка не даёт.

## Что ещё открыто

1. Read-only восстановление genuine publication после потери процесса/неизвестного push/PR outcome. Новый encrypted codec сам по себе не восстанавливает capability из JSON. При неоднозначности остаётся остановка без повторной публикации.
2. Соединение notice с fixed worker: cold source/controller reconstruction, fresh dependency/CI checks, genuine next admission, полная следующая4-role задача и её exact CI. Сейчас проверен callback только тестового планировщика; production Actions entrypoint не подключён.
3. Production key provisioning и durable storage между машинами, защита от удаления/отката всего журнала внешним monotonic store. Локальный каталог должен сохраняться доверенным host. GCM+chain обнаруживают изменения/разрывы, но не доказывают отсутствие удаления последних файлов или потери всего каталога.
4. Реальный новый модельный прогон требует отдельного точного owner allowance: existing remaining.requests=0. Разрешений продолжения для этого недостаточно. Все прошлые расходы сохранены; legal=false.

Этап10.13 в целом НЕ закрыт; завершена проверяемая часть durable CI→scheduler notice. Уведомление не объявляется реальным автоматическим запуском следующей задачи. Generic full-project autonomy, browser/Expo/device и полный Calculator release остаются unverified.
