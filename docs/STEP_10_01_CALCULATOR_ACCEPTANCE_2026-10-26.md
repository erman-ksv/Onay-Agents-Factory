# Этап10.1 — техническая приёмка Calculator

26.10.2026. Проверен существующий кандидат, приложение не переписывалось. Модельных запросов0, новых Actions запусков0, платных API/Codespaces/новых агентов0.

## Итог

Все11 исходных acceptance IDs покрыты положительными автоматическими проверками на кандидате `558993981c9bbb7c6100c8335860ac5668768314`. Это техническая приёмка Draft-кандидата в указанном объёме. Она не означает11 отдельных сценариев в реальном браузере, ручную приёмку владельцем, merge, публикацию или готовое мобильное приложение.

| Исходный критерий | Подтверждение | Граница |
|---|---|---|
| addition |2+3=5, независимый host harness и Node UI| UI с mock DOM |
| negative-result |7−10=−3, host + Node UI| UI с mock DOM |
| multiplication |6×4=24, host + Node UI| UI с mock DOM |
| division |9÷3=3, host + Node UI| UI с mock DOM |
| decimals |0.5×4=2, host + Node UI| UI с mock DOM |
| decimal-display |0.1+0.2=0.3 без хвоста, host + Node UI| UI с mock DOM |
| zero-recovery |Ошибка деления на0 и следующий корректный расчёт, host + Node UI| UI с mock DOM |
| clear |Новый расчёт после очистки ввода/результата| Реальный Chrome, два сценария |
| backspace |123→12| Реальный Chrome |
| keyboard |Клавиатура и кнопки дают один результат| Реальный Chrome и Node UI |
| narrow-screen |360px, работающий расчёт, нет горизонтального переполнения| Реальный Chrome; другие размеры не проверены |

Примечание: Node тест с названием «narrow-screen» сам не измеряет браузерную геометрию; для этого критерия учитывается настоящее Chrome evidence. Название теста не считается самостоятельным доказательством отсутствия горизонтального scroll.

## Проверенные источники доказательств

- Исходный сохранённый план `orchestration/fixtures/calculatorStep7SavedPlan.json`, fingerprint `1e91cad431880b10b810d1a0bb7fe97c9a5856394d3f10ed100a82f3927b6ed2`. Все11 IDs присутствуют в итоговой T05.
- Текущий native Calculator ref совпал с кандидатом; Git tree полное,9 файлов. SHA каждого blob сохранён в machine matrix. Draft PR1 открыт на том же SHA.
- [Calculator CI40178095158](https://github.com/erman-ksv/Onay-Factory-Calculator/actions/runs/40178095158), job121123061295: SUCCESS, attempt1, exact head; Syntax и Task tests SUCCESS. Лог Task tests прочитан: status:passed, testsExecuted:true.
- [Live40307399306](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40307399306), job121519847360: независимый host arithmetic и project tests, настоящие Chrome141 проверки, все три реальные независимые роли положительные. Это уже завершённый запуск, он не повторялся.
- Factory harness `config/calculator-harness/check.mjs` проверяет семь фиксированных arithmetic criteria вне изменяемого приложения. Node UI тесты кандидата прочитаны; семь arithmetic случаев действительно проверяют display через mock DOM. Эталонные сценарии/ожидаемые ответы не изменялись.

Machine matrix: [.factory/calculator-acceptance-matrix-20261026.json](../.factory/calculator-acceptance-matrix-20261026.json).

## Чего ещё не утверждаем

Каждый из семи arithmetic UI сценариев отдельно в настоящем Chrome, Safari/Firefox, физические телефоны, полная доступность и другие размеры экрана не подтверждены. Владелец ещё не принял внешний вид; приложение не опубликовано по публичному адресу. Draft не объединялся. Старые отрицательные receipts сохранены. Поэтому wholeAppCompleted:false остаётся честным значением.

## Следующий технический барьер Factory

Перенос на другой проект пока ограничен намеренно жёстким Calculator профилем: `orchestration/projectBudgetAuthorization.ts` допускает только erman-ksv/Onay-Factory-Calculator, `config/calculatorProfile.ts` фиксирует пути, branch namespace и CI. Одного нового репозитория или ключа модели недостаточно.

Следующий инженерный этап: host-owned реестр явно одобренных профилей; отдельные project/plan/owner identity и ledger; конфигурация разрешённых путей/веток/CI для каждого профиля; отказ при попытке JSON/модели выбрать неизвестный репозиторий или перенести чужой grant. Затем тесты подмены profile/repository/budget и переносимость на втором проекте по конкретной цели владельца. Нельзя просто снять текущий запрет репозитория.

Код переноса ещё не изменён и новый проект не запускался. Текущий model budget исчерпан: remaining.requests0; этот отчёт не выдаёт нового разрешения на модель. Main/Calculator не изменены, merge/deployment не выполнялись; legal disabled. Общий план Factory0–100 не закрыт.
