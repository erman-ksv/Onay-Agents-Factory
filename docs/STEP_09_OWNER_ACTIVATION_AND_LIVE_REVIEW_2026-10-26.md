# Шаг 9: подлинное разрешение владельца, ledger и ограниченный live review

26.10.2026. Продолжение существующей ветки `feat/calculator-t02-charge-reconcile-20261022`, Draft PR75. T05 остаётся ранее опубликованным кандидатом; её код, план и исторические receipts не переписываются.

## Разрешение владельца — подтверждено

Владелец сам разместил [комментарий 6412067757](https://github.com/erman-ksv/Onay-Agents-Factory/pull/75#issuecomment-6412067757). Native GitHub API подтвердил login erman-ksv, тип User, association OWNER, issue75, created_at=updated_at=2026-10-26T08:56:08Z. JSON точно совпадает с ранее рассмотренным документом, digest `afaf23c899abbd5349787e912e6249092a5e6690d66abc1f3eb5d1adbc8318b6`, режим read-only-review, срок до 01.11.2026 00:00 UTC.

Разрешение: ровно 3 дополнительных Groq Free запроса, до 72000 байтов/18000 reserved tokens. С полной историей пределы 62 запроса, 625908 байтов, 248413 reserved tokens. Исторические 59/553908/230413 не обнулялись. Резервы являются консервативной оценкой, не счётом провайдера.

## 9.3: реальная активация — подтверждена

Изменён только operator request: initialize + подлинный ownerDecision. [Native operator 40295986355](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40295986355), request job121482043811 PASS, initialize job121482095903 PASS, inspect SKIPPED. Итог initialized, 1 state write, 10 GET/4 GitHub API mutation requests, **0 моделей**. Никакой модели/инициализатору не передавалось; использованы права только для state Git metadata.

Независимый native readback подтвердил служебную ref `state/project-model-budget/30aba2ef57704b41551ee67ae250315a8ec6a83963987f2e6533dbc20f7f70f0`, commit `edc200943234709a9b5e438cb57407b3eb17ba7b`, единственный файл project-model-budget.json, grant SHA256 `cd317be0675c6660d080e0ac8c7f85f178d9f62805734de93b20741a8ad52cb9`, reservations []. Это была исходная активация полной истории, не сброс существующего счётчика.

Metadata artifact initialize:12639025444, 634 байта, GitHub-reported ZIP SHA256 f81e43ec0a4efff0c0beb3f103006f56ded797ccd1838559c566b3c8d7e6c73f. Output ZIP не скачивался/не пересчитывался, отчёт прочитан по native job log.

## 9.4: запуск через обязательный общий счётчик

После успешной активации отдельным metadata commit `cecec083337a0a0bdfb68e159a812cd711eaa427` выбран review того же кандидата `558993981c9bbb7c6100c8335860ac5668768314` с тем же подлинным ownerDecision.

Реальный [live run 40296325671](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40296325671): request job121483157902 PASS, review job121483197739 **FAILURE**, inspect SKIPPED. Публичный итог unverified, phase required-project-three-reviews; ownerApprovalVerified:true, projectBudgetActivated:true, **2 фактические отправки Groq**, 218 GitHub GET/12 budget mutation requests. Автоматических повторов нет. Публичный result не содержит канонических индивидуальных assessment ответов; нельзя объявлять весь цикл или Tester успешным и нельзя незаметно восстановить отсутствующие оговорки предыдущих ревью.

Независимо прочитан конечный ledger: commit `906deeb59bc1c67c11da677be7ba3c8424c98e26`, тот же grant hash, **3 сохранённых резерва** одного стабильного execution ID (r1/r2/r3). Их размеры: 12114/12073/12124 байта, 5494/5481/5498 reserved tokens. Дополнительный итог 36311 байтов/16473 токена. Полный used: **62 запроса, 590219 байтов, 246886 reserved tokens**. Remaining: **0 запросов**, 35689 байтов/1527 токенов. Третья отправка до провайдера не дошла, но её резерв не возвращён: расходы могут быть неопределёнными, автокомпенсация запрещена.

Выявлен дефект host конфигурации: для трёх ревью использовался четырёхрольный preset с локальным maxRunTokens=16000; разрешённый owner grant предусматривал 18000. Три реальные записи требуют 16473. После двух запросов третий не прошёл локальную границу. Гарантированный дефект воспроизведён регрессией с реалистичными пакетами (старый код FAIL, исправленный PASS). Старый публичный отчёт слишком общий для полного разбора всех деталей исполнения; новые diagnostics сохраняют только allowlisted stage/role flags/counters, без body/source/key.

Исправлен отдельный `calculator-published-three-reviews` preset: maxRequests **3**, maxRunBytes72000, maxOutput1200; обе локальные context границы согласованы на **18000**. Per-request context/TPM по-прежнему6000, остальные presets и значения по умолчанию не повышались. Security/Reviewer/Tester и native owner проверки не ослаблены. Поправка НЕ расширяет действующий ledger, не удаляет r3 и не перезапускает модель. Локально43/43 связанных проверки, включая test на >16000 и ≤18000, ≥120000ms pacing для трёх крупных пакетов и безопасную диагностику. Новых модельных вызовов после исправления —0.

Исправленный source `0cc520245e3db9e0b922a9a2336271574c5533d7`: [CI 40298235602](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40298235602), job121489445241: **pnpm typecheck PASS, pnpm test 2402/2402 PASS**, ошибок0. Оба script node --check прошли; точный isolated diff проверен.

Новый настоящий worker [40298681929](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40298681929), job121490929285, **PASS**. Подлинный новый native owner controller отказал в повторном запуске ДО source/tools/model: used62, remaining.requests0, counters unchanged, 14 GET/0 mutation/0 source calls/0 model calls. Тестовые пустые source placeholders не принимались как evidence: до них исполнение не дошло, что отдельно проверено. Метаданные artifact12639531330 (402байта) не скачивались/не пересчитывались.

**9.3 закрыт в заявленной области реальной авторизации/инициализации. 9.4 остаётся незавершённым:** успешный проход трёх реальных ревью на исправленной версии не подтверждён. Текущий лимит запросов уже исчерпан; новых разрешений, сброса либо refund не создано.

## Границы

Новый запуск не генерирует, не исправляет и не публикует исходный код Calculator; это три свежих независимых ревью для проверки общего бюджета. Шаг 9 не означает универсальную автономность любых проектов. Main, merge/deployment, Onay и опубликованный Calculator остаются вне изменений. Юридический агент выключен. Codespaces, платные API и новые вспомогательные агенты не использовались. После ошибки/429/отрицательного verdict нет автоматического повторения или возврата резерва.
