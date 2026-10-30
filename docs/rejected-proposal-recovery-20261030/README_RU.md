# Ограниченное восстановление отклонённого первоначального предложения

Основа — опубликованный `e5a7137d3e4ba853123213de95e78ef6bf52134a`, дерево `55d6d6ec745f484a487ebb51e56e0c0429cc25cd`. Изменения не опубликованы. Этап 8 не закрыт.

Подтверждённый отказ: checkpoint 13, Coder/author-proposal, bounded-patch. SHA исходника верен, единственный before-якорь длиной 5 байт имеет 7 совпадений. Валидатор `commander/boundedPatch.ts` не изменён. Восстановление допускает только этот класс доказанного отказа, не неизвестный HTTP, Security blocked или произвольную ошибку.

## Host-маршрут

1. Загрузить настоящий текущий controller, protected archive, recovery key и свежий source snapshot через существующие native Factory API. Никаких initialize/reset/extension.
2. `inspectProjectRejectedProposal` проверяет tip/pin, AES-GCM, task-start → before-http → reply-rejected, исходный commit и файл, request/response SHA, execution, ledger reservation и настоящую неоднозначность якоря. Результат — непрозрачный evidence, не admission. Старые HTTP и модельный ответ не исполняются.
3. `proposeProjectRejectedProposalAdmission` выдаёт только DATA. Сохранённый OWNER-admission-DRAFT.json не является разрешением: его comment ID отсутствует, реальный OWNER должен отдельно согласовать точный body. Свежая native-проверка обязана заново сформировать evidence и сравнить body/digest.
4. `authorizeProjectRejectedProposal` проверяет отдельный неизменённый комментарий erman-ksv/User/OWNER в PR75, срок, exact body/digest, project/plan/profile/grant и checkpoint/budget pins.
5. `claimProjectRejectedProposal` один раз записывает зашифрованный rejected-proposal-claim с fence `expectedHead`. Permit появляется только после подтверждения записи. Разные процессы получают sibling commits: ref CAS пропускает одного. Если конкурент уже продвинул tip до начала persist, fence останавливает второго до записи. Потеря ACK и crash после claim не разрешают повтор или восстановление permit из JSON.
6. `createProjectRejectedProposalRecoveryRuntime(...).recover(ticket)` входит в существующий Host worker через отдельный `prepareRejectedProposal`. Новый execution ID, новая reservation sequence, cooldown, та же обычная reserve-before-HTTP схема и повторные OWNER/source/ledger проверки. Ticket потребляется атомарно до первого await.
7. Coder получает точную диагностику (число совпадений, размеры, путь и SHA) и требование длинного точного якоря с одним совпадением во всём исходном файле. Raw rejected reply не копируется в новый запрос. Новое тело запроса не может совпасть с priorRequestSha256.
8. Все Security/Reviewer/Tester, native Node/browser, Draft/CI ворота сохранены. Любой повторный invalid/blocked/negative результат останавливает восстановление. Внутренней коррекции в этом маршруте нет, `options.corrective` отвергается.
9. Только после `recover` существующий доверенный Host вызывает `runProjectCiContinuation` с candidate SHA и настоящим grant lineage. Native подтверждение exact CI и обычное новое admission следующей задачи обязательны. Тест проверяет этот составной маршрут, но реальные AI/CI не запускались.

## Безопасность и состояние

Новый вид checkpoint добавлен в whitelist архива и в materialize mapping. Никакие ledger/budget schemas, лимиты, исторические записи, provider replay или валидатор патчей не изменены. Использование ForTests evidence/authority не может создать native permit. Дублированный ticket, параллельные authority и повторная reservation проверены. Claim не выдаёт ни executionAuthorized=true, ни replayAuthorized=true; исполнение проходит обычные branded Factory capabilities.

Два локальных прохода: первый выявил race при конкурентном consume и неверную подготовку budget fixture; второй после исправлений — 15 PASS / 0 FAIL / 0 SKIPPED. Нативные зависимости не установились: штатный proxy недоступен, pnpm frozen install завершился META_FETCH_FAIL. `pnpm typecheck` и `pnpm test` фактически запускались и заблокированы bootstrap/dependencies. Никакой typecheck не подменён stripTypeScriptTypes.

Отдельный dependency-free Node bridge прогнал 191 test-файл: 172 PASS / 19 FAIL / 0 SKIPPED. В чистом baseline e5a7137 — 190 файлов: 171 PASS / те же 19 FAIL. 14 файлов не загрузились без SDK; в остальных 5 совпали 13 ошибок окружения: 8 missing tsx, 2 Node subprocess EPERM, 3 TCP localhost EPERM. Это file-level totals, не количество случаев pnpm suite. Необъяснённых новых FAIL — 0. Полный suite нового TypeScript-кода в штатной среде и новый CI ещё не подтверждены.

## Запросы и оставшаяся приёмка

Новый ограниченный OWNER admission разрешает максимум 1 новое предложение и 4 новых запроса: Coder, Security, Reviewer, Tester. Следующая утверждённая задача после CI требует ещё максимум 4. Итого максимум 8 новых запросов / 96000 request bytes / 48000 reserved tokens. Дополнительные correction attempts здесь не разрешены.

Текущий остаток: 15 / 186739 / 92790. После консервативного максимума останется 7 / 90739 / 44790. Ceilings 86 / 842605 / 374665 и учтённые 71 / 655866 / 281875 не меняются. Повышение OWNER-бюджета не требуется. Фактические запросы начисляются по одному перед HTTP; это верхняя оценка, не произведённый расход.

До реального исполнения: полноценные typecheck/test и exact-SHA CI после отдельного разрешения commit/push; свежая native-проверка evidence и pins; отдельный настоящий OWNER-комментарий; отдельное согласие на реальную попытку. Draft и manifest имеют expiresAt до 30.10.2026 23:59:59UTC и не продлевают старые решения. Если срок истёк, остановиться и заново согласовать действующие разрешения, без автоматического renewal. Не повторять старый replacement-host.json с archive10.

Этап 8 остаётся BLOCKED до реального нового предложения, независимых проверок, native/browser, exact candidate CI и автоматического продолжения. Commit/push/merge/deploy/real AI в этой работе не выполнялись.
