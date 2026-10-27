# Этап10.13 — установленная защита подтверждена native API

27.10.2026. Factory feature-ветка `feat/calculator-t02-charge-reconcile-20261022`, Draft PR75. Main, приложения и действующий project budget не изменены.

## Результат

Владелец включил ruleset25942828. Connector GET подтвердил active, branch target, оба точных state pattern, deletion/non_fast_forward, bypass_actors=[] и current_user_can_bypass=never. Последующий [native Actions40484076762](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40484076762), readiness job122121353479, **SUCCESS**: genuine native `prepareProjectStateProtection` и fresh verification приняли реальные effective rules для обоих state namespace.

Native positive probe использовал genuine SYNTHETIC host controller/profile только для read-only проверки конфигурации. Fixture теперь имеет отдельный host-only constructor:0 MOCK replies/0charged synthetic requests, без запуска моделей/host sandbox/publisher. Это НЕ реальный development grant и НЕ выполнение новой app задачи.

Проверен реальный grant/ledger: owner comment6413719353, mode=read-only-review,65used/0remaining. Реальный budget ref до/после — b139646c2f359fe23f213e0a3227aa99dd84f369. Все13 native запросов — GET;0provider/app/state/budget writes. Правила не изменялись этим запуском.

## Найденная причина отказов и исправление

Предыдущие native попытки40482110627/40482448825 и40483350990 не прошли strict guard. Диагностика подтвердила200/нужные effective rules, но installation token GitHub Actions скрывал поле bypass_actors. Считать отсутствующее поле пустым списком нельзя — отказ был корректным. Увеличение contents permission не дало пригодного proof; временное write permission удалено.

Отдельная попытка40483703928 показала пустой FACTORY_READ_TOKEN в Actions. Существующий CALCULATOR_GITHUB_TOKEN доступен и позволяет читать нужные Factory metadata. Workflow выбирает уже настроенный credential: FACTORY_READ_TOKEN→CALCULATOR_GITHUB_TOKEN→github.token. Это выбор источника GitHub authentication, НЕ fallback на пустую/неполную защиту: strict native guard остаётся обязательным. Значения credential не выводились и не использовались как recovery key.

`factoryReadOnlyProbe` ограничивает все native fetch в probe процессe: только HTTPS GET с redirect=error к фиксированному Factory repository prefix, без request body;64requests/120s; запрет любых mutation/foreign host/repo/credential URL/Request object; ошибка latch без retry. Даже credential с write scope в этом read-only процессе не может отправить write через transport. Полученный native proof:13GET/0native writes. Source/app runtime permissions не расширены.

## Проверки

Исходники dca52ea14be52008ca890f585069e87a43efd2a2: [CI40483037312](https://github.com/erman-ksv/Onay-Agents-Factory/actions/runs/40483037312), job122117847758: **pnpm typecheck PASS; pnpm test2634/2634 PASS**, failures0.5новых transport regressions; local14/14 protection+GET cases. Native readiness использует этот immutable source. Source e2b51e3 до transport fix отдельно прошёл2629tests; его failed native attempt не выдана за success.

Cross-job persistence probe подготовлен условно: если key валиден, первая job шифрует synthetic nonce, вторая job читает ciphertext с тем же repository secret. В artifact допускаются только ciphertext и hashes, не ключ. Сейчас recoveryKeyConfigured=false; cross-job job122121428737 SKIPPED. Это **не** подтверждение межмашинной сохранности ключа.

Exact isolated diff-check PASS. Local source directory не git checkout; diff сформирован по before/current в отдельном каталоге. Никаких локальных installs, Docker повторов, Codespaces, paid APIs или новых агентов в этом этапе.

## Что осталось и что нужно владельцу

1. Actions сейчас не получает корректный FACTORY_RECOVERY_KEY_BASE64. Нужен отдельный persistent32-byte canonical base64 recovery key, ID onay-runtime-key-v1. Не подменять его GitHub/Groq/Gemini token. Ключ в чат не отправлять. Для первой настройки подготовлен отдельный локальный HTML helper: crypto.getRandomValues на устройстве пользователя, CSP connect-src none, без storage/network/console. В среде агента ключ не генерировался; helper JS syntax проверен, реальная проверка на телефоне ещё нужна. Это не frontend приложения и не deployment сайта.
2. После настройки key повторить условный cross-job proof и materialized archive restore. Сохранять trusted latest pin; при unknown HTTP/push/PR/checkpoint никаких автоматических replay/reset.
3. Для настоящей app задачи нужен отдельный точный OWNER development grant с task/profile/acceptance и ограниченным allowance. Текущий read-only-review исчерпан. Production entrypoint пока не активирован; generic Node contracts не заменяют browser/Expo/device gates. Завершённый CalculatorT05 не переигрывать.

Защита state refs теперь подтверждена и конфигурационно, и native guard. Все3 пункта/полная production автономность ещё НЕ закрыты. Legal=false, история расходов/ошибок сохранена.
