# ONAY Factory — дополнительная проверка текущего corrective loop

29.10.2026. Продолжение существующей ветки, не новый проект. Исходный HEAD ffb02d3c55ec57859e5d5d33a84112999727abf4. Main/commit/push/merge/deploy/real AI/OWNER permissions не менялись.

## Подтверждённый дефект и минимальный фикс

`prepareProjectCorrectiveTaskPermit` в orchestration/projectCorrectiveAuthorization.ts проверял `r.used.has(taskId)` до `await controller.inspectExecution(...)`, затем выдавал permit. Два concurrent caller проходили проверку до await и получали два разных permit на одну задачу/одну OWNER capability. Дефект воспроизведён отдельным регрессионным тестом в github/projectSourceSnapshot.test.ts: до фикса 2 fulfilled вместо1, FAIL; после фикса1 fulfilled+1 rejected, PASS; расходы неизменны, corrective model calls0. Повторная выдача после победителя также отклоняется.

Проверка и установка одноразовой отметки теперь расположены вместе ПОСЛЕ всех await. OWNER/model/grant/evidence guards, archive claim, replay prohibition и ledger не ослаблялись. Это исправление внутри процесса. До него архивный CAS claim и reserve-before-HTTP ledger уже защищали дальнейшее исполнение; двойных live HTTP/списаний этим тестом не доказано и не заявляется.

## Окружение и штатные команды

Пользователь подтвердил: другой среды сейчас нет. Environment status сообщает unrestricted/enforced, однако доступная shell sandbox не соединяется со штатным proxy8080. Кэш компилятора/tsx отсутствует. Повторные запросы снятия sandbox-ограничений не отправлялись.

Frozen offline install с неизменённым pnpm-lock.yaml: ERR_PNPM_NO_OFFLINE_META, отсутствует metadata @esbuild/aix-ppc64; supply-chain policy не обходилась. package.json/lockfile не изменялись. pnpm typecheck фактически выполнен:tsc not found, BLOCKED. pnpm test фактически выполнен:tsx not found,BLOCKED. Native Node transform410TS — только синтаксическое преобразование, не typecheck. SDK-заглушки и фиктивные пакеты не создавались.

Тринадцать исходных failures объяснены и ранее повторно воспроизведены на точном исходном SHA:8missing tsx,2Node spawn EPERM,3TCP listen EPERM. Полный список и baseline evidence сохранены в environment-comparison.json и приложенных TAP. Их нельзя считать PASS/SKIPPED; неподтверждённые дефекты в недоступных проверках не исключены.

## Бюджет и два пункта

Расчёт worst case прежний:2tasks×(4initial+4correction)=16новыхrequests,192000bytes,96000reservedTokens. Учтённые70/650605/278665 сохраняются. Proposed total minimum ceilings86/842605/374665, actual requests remaining7. Это DATA, никаких изменений actual limits/permissions.

Пункт1 BLOCKED: нужна среда npm registry+дочерний Node+localhost; frozen install, настоящий typecheck и полный pnpm suite; отдельно проверенный ограниченный development budget transition (текущее правило+1 не подходит); актуальный pinned manifest. Только после разрешения пользователя commit/push и CI exactSHA. Нынешние DRAFT OWNER JSON не активировать.

Пункт2 BLOCKED: native Docker/Node/browser acceptance и отдельное реальное разрешённое AI correction → fresh independent roles → exactCI → automatic successor. Локальные simulated AI/GitHub/Docker receipts этого не доказывают.

Последний полный патч и proof его применения к чистому исходному SHA будут в последнем архиве OneNote вместе с проверочными логами. Оригинальные архивы сохранены как история.

## Фактический итог повторного прогона после исправления

172 файла, **2639tests /2626PASS /13FAIL /0SKIPPED /0cancelled**. Все13failures по именам совпадают с сохранённым неизменённым baseline; необъяснённых0. Новый permit-race тест и13corrective-loop tests PASS. Полный pnpm suite не подтверждён;17SDK-dependent файлов не запускались, число их test cases не объявляется SKIPPED/PASS. git diff --check PASS. Новых application failures в доступном наборе не выявлено, но недоступные проверки не заменены синтетическими доказательствами.

Для CI сначала требуется работоспособная среда и штатные frozen install/typecheck/test. Истинного CI текущего кода нет, поскольку commit/push не разрешены. После этого остаются bounded budget transition/pinned manifest и отдельно разрешённая native/live приёмка. Новые этапы не вводились.

## Последняя безопасная локальная проверка: permit → admission → execution → ledger

Защита check+mark после всех await уже была в production code и сохранена. Добавлен отдельный регрессионный тест в github/projectSourceSnapshot.test.ts, который проверяет весь путь:

- Два одновременных запроса одной OWNER capability → один permit и один отказ, без расходов.
- Два admission на один permit из отдельных managers → один admission и один отказ, без расходов.
- Повторный запуск transport на том же admission отклонён.
- Один запрос к имитированному провайдеру → ровно одна новая резервация; requests +1, requestBytes ровно packet.requestBytes, reservedTokens ровно packet.estimatedReservedTokens. Все прежние reservations сохранены побайтово по значениям.
- Replay packet и повторная выдача permit отклонены; модельных запросов по-прежнему1, ledger и бюджет после этого не изменились.

Целевой прогон2PASS/0FAIL/0SKIPPED. Связанные регрессии162PASS/0FAIL/0SKIPPED, включая оба atomic tests,13corrective-loop tests и существующие OWNER/budget/checkpoint/replay/initial-host concurrency guards. Эти результаты не прибавлять друг к другу:2целевых теста входят в162. git diff --check PASS.

Атомарность check+mark доказана для одного event loop. Межхостовые ограничения остаются за durable archive CAS и reserve-before-HTTP ledger; новая проверка не является OS-process crash/native доказательством. Все provider/OWNER/GitHub adapters тестовые. Реальных AI-вызовов и изменений actual project budget0.

Новые typecheck и штатный pnpm test не запускались повторно в этом продолжении: tsc/tsx/SDK остаются недоступны. Native Docker/browser, отдельные дочерние OS-process и CI нового кода заблокированы окружением/отсутствием разрешения на публикацию. Прежние13environment failures не объявлены прошедшими. Оба оставшихся пункта этапа8 остаютсяBLOCKED. Main/commit/push/merge/deploy не выполнялись.
