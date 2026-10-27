# Следующая реальная задача: ввод калькулятора

Это отдельная новая задача для агентов, не повтор завершённого T05. Продуктовый код меняют агенты после действующего development разрешения. В этом этапе host готовит критерии и read-only baseline.

## Цель и scope

Исправить накопление повторных/заменённых операторов и ведущих нулей. Предлагаемые writable paths: src/app.mjs и test/ui.test.mjs. index.html, styles.css и src/calculator.mjs остаются read-only dependencies; включать их в writable scope только ради чтения нельзя. Источник зафиксирован на Calculator558993981c9bbb7c6100c8335860ac5668768314.

Новые host cases лежат отдельно в config/calculator-input-browser/cases.json; SHA256=8c4ddb579b3aa548561013d5a986afd306e0da6fff0b59dd0dd2b2b83659de6c. Агент не может менять этот oracle. Прежний config/calculator-browser/check.mjs не изменён (SHA25654e61e318091922258cf77f3df4a052830fdb3a85b5e0599c90d99eca88fbf01); все11 исходных критериев остаются обязательными, ожидаемые ответы не переписаны.

| Ввод | Ожидаемое отображение |
| --- | --- |
| 6**2= | 12 |
| 6*+2= | 8 |
| 6//2= | 3 |
| 6++2= | 8 |
| 00005 | 5 |
| 000 | 0 |
| 2+005= | 7 |
| 0.05 | 0.05 |
| 2*-3= | -6 |
| 7-10= | -3 |
| 2+3= | 5 |
| 8/2= | 4 |
| 0.1+0.2= | 0.3 |

11 сценариев проверяются кнопками и настоящими keyboard events;2 десятичных — кнопками. Отдельно проверяется отсутствие горизонтальной прокрутки на360px. Всего25 checks. Decimal keyboard input не объявлен проверенным. Это браузерный viewport, не физический Android/iPhone.

## Безопасная проверка

Создан отдельный calculatorInputBrowserProbe: pinned Chromium image, обязательный namespace/seccomp sandbox, network=none, non-root/read-only mounts, закрытые credentials, отсутствие no-sandbox/privileged/remote-Docker fallback. Полный source остаётся только в host-private памяти и изолированном контейнере. В proof — candidate/source-set/contract SHA, номера checks и failures, без кода или model replies.

Native baseline сверяет HEAD и Git blob hashes четырёх прочитанных файлов с фиксированным Calculator SHA, запускает Chrome и после проверок подтверждает чистый рабочий каталог. Ошибки сценариев возвращаются как failed; недоступная изоляция/неполные checks/неверный contract/сетевые запросы дают unverified, а не acceptance. Ни JSON-копия отчёта, ни simulated process не дают разрешения на публикацию.

Probe всегда возвращает executionAuthorized=false/publicationAuthorized=false. Он пока НЕ подключён к native publication gate. Наличие browser proof без этой связи не разрешает публикацию. Workflow baseline может успешно подтвердить наличие дефектов — это не зелёная приёмка приложения.

## Оставшиеся реальные блокеры

1. Связать browser evidence с genuine snapshot/proposal и потребовать его до публикации. Нынешние generic Node contracts не доказывают UI-поведение.
2. Подключить read-only зависимости без расширения writable scope. Создать точный production plan/manifest и старт первой задачи, а не подменять уже завершённый T05 или synthetic fixture.
3. Зафиксировать историю65 расходов и получить отдельный ограниченный OWNER development grant. Текущий mode=read-only-review, remaining0. До этого никаких запросов Groq и app writes.
4. Проверить настоящий цикл агентов и после ошибок только допустимое ограниченное исправление: существующий one-pass worker останавливается на отрицательном verdict/429; нельзя выдавать это за полное автоматическое самоисправление.

Файл .factory/proposed-calculator-input-repair-20261027.json — review proposal, не executable runtime manifest и не разрешение на расходы.

Локальные6 тестов probe PASS; script/harness syntax и isolated exact diff-check PASS. Полный TypeScript/test CI и native baseline фиксируются отдельно по фактическим результатам. Main/Calculator/Onay/current model ledger не изменялись; legal=false.


Первый native browser run40498049392/job122168421650 подтвердил основные дефекты, но сообщил14failures:12input failures и2ошибочных отрицательных сценария из-за locator, не распознававшего U+2011 на кнопке минуса. Последние2 не являются доказательством дефекта приложения. Исправлен только host locator, добавлена отдельная regression для типографских знаков; cases.json и expected answers не изменены. Обязательна повторная native проверка исправленного source.

Исправленный source bbc87dff0c3c85e2ee5775736e33b69f530d8b55: [CI40498422831](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40498422831), job122169679234 — pnpm typecheck PASS; pnpm test2662/2662 PASS, failures0; local6/6 PASS. Первый source a78fcb46 отдельно прошёл2661tests, но его native вывод про2negative button cases признан некорректным и не используется для приёмки.

## Исправленный native baseline

[Actions40498736443](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40498736443), job122170731826: настоящий Chrome/141.0.7390.37 с включённым sandbox, network isolation, без credentials. На том же candidate5589939 и source-set47bfa1b678f1a659e8419a41577ad2baeacd3a19089ccc93e9c90d75718e468e выполнены25checks:13PASS/12FAIL. Все12FAIL относятся к четырём повторным/заменённым операторам и двум вариантам leading zeros (кнопки и клавиатура). Отрицательные operands/results, десятичные, обычные расчёты и narrow-layout теперь PASS. Дефекты не исправлены: цель baseline — показать, что новый oracle их обнаруживает.

Case SHA остался8c4ddb57; исходные expected answers не менялись. App HEAD и рабочий каталог до/после неизменны. Model/app/budget writes0. Workflow SUCCESS означает успешное воспроизведение дефектов, а browser acceptance остаётся FAILED.
