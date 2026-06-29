# Lime — Roadmap до запуска

> Дорожная карта подготовки продукта к публичному запуску. Обновлено: **2026-06-28**.
> Это не учебный проект — оценка и приоритеты по меркам production-SaaS.

**Легенда статуса:** ✅ сделано · 🟡 частично · 🔜 следующее · ⛔ запарковано (нужна внешняя инфра/решение) · 🧹 тех-долг

---

## 0. Уже закрыто (контекст)

Периметр надёжности/безопасности (zero-infra) закрыт и проверен (`dotnet test` 167/167, node-самотесты 7/7):

- ✅ **Hardening** — парольная политика 8+цифра, lockout 5/15 мин, `AllowedHosts` fail-closed (`localhost` дефолт + dev `*` + прод `${DOMAIN}`).
- ✅ **GDPR-аккаунт** — `ExportMyData` (выгрузка всех данных), `DeleteMyAccount` (подтверждение паролем, каскад + чистка подписок/счётчиков/файлов).
- ✅ **Восстановление доступа** — `IEmailSender`/`EmailSender` (SMTP через env, иначе лог-режим), forgot/reset-password flow, anti-enumeration, rate-limit.
- ✅ **Tenant-изоляция в архитектуру** — EF global query filter на `Site` + точечные `IgnoreQueryFilters` в кросс-тенантных чтениях.
- ✅ **Media за абстракцией** — `IMediaStorage`/`LocalDiskMediaStorage` (готова точка подключения S3 без правок контроллеров).
- ✅ **Чистка legacy-фронтенда** — удалено 223 мёртвых файла (уязвимый jQuery 3.x, bootstrap, vendor-template). Продукт на чистом vanilla.

---

## Milestone 1 — Перед приватной бетой (первые реальные пользователи)
**Цель:** можно доверить чужие данные. Без этих пунктов нельзя пускать никого, кроме себя.

### 1.1 🟡 Бэкапы Postgres + медиа — **БЛОКЕР**
- **Что:** автоматический бэкап БД и пользовательских медиа с проверкой восстановления.
- **Сделано (zero-infra, 2026-06-29):** сайдкар `backup` в `compose.prod.yml` (образ `postgres:16`) — раз в `BACKUP_INTERVAL` (по умолчанию сутки) делает `pg_dump -Fc` + `tar` медиа в volume `backups_data`, retention `BACKUP_RETENTION_DAYS` (14 дн). Скрипты `ops/backup/{backup,entrypoint}.sh` (LF форсирован через `.gitattributes`), инструкция восстановления `ops/backup/RESTORE.md` (pg_restore БД, распаковка медиа, квартальная проверка). Env-переменные в `.env.example`.
- **Осталось (нужна внешняя инфра/решение):** off-site-синк volume `backups_data` (rclone в S3/R2 — нужен бакет/аккаунт); первая фактическая проверка восстановления на staging.
- **Когда:** **до** первого пользователя. Самый дешёвый и самый критичный пункт.
- **Готово когда:** есть восстановленная из бэкапа копия в staging.

### 1.2 🟡 Observability: error-tracking + лог-агрегатор
- **Что:** узнавать об инцидентах из мониторинга, а не от пользователей.
- **Сделано (zero-infra):** correlation-id middleware — каждый запрос получает `X-Request-Id` (из заголовка или сгенерированный), он попадает в Serilog LogContext (виден в консольных логах) и возвращается клиенту. Связать обращение пользователя с логами можно уже сейчас.
- **Осталось (нужны внешние сервисы):** `Sentry.AspNetCore` + DSN через env, Serilog sink в агрегатор (Seq / Grafana Loki), алерты на 5xx и падение `/health`.
- **Когда:** до приватной беты (наблюдаемость нужна с первого пользователя).
- **Зависимость:** аккаунт Sentry (или self-hosted GlitchTip).
- **Готово когда:** тестовое исключение видно в Sentry с correlation-id и стектрейсом.

### 1.3 🟡 Email-подтверждение (код готов, осталось включить enforcement)
- **Что:** перекрыть регистрацию на чужие адреса и спам-аккаунты.
- **Сделано:** письмо с подтверждением шлётся при регистрации (через `IEmailSender`, в dev — лог-режим), есть экшен `ConfirmEmail`, enforcement за флагом `Identity:RequireConfirmedEmail` (по умолчанию `false`). Включение боевого режима = флаг в `true` + SMTP, без правок кода.
- **Осталось:** подключить боевой SMTP (env `SMTP_*`) и выставить `Identity:RequireConfirmedEmail=true`.
- **Когда:** как только есть боевой SMTP; до публичного запуска.
- **Зависимость:** SMTP-провайдер (Resend/SES/Mailgun или корпоративный).
- **Готово когда:** новый аккаунт не входит до клика по ссылке из письма.

---

## Milestone 2 — Перед публичным запуском (масштаб и нагрузка)
**Цель:** приложение переживает >1 инстанса и всплеск трафика. Сейчас — **single-instance only**.

### 2.1 ⛔ Stateless-инстанс: Redis для session/cache/rate-limit — **БЛОКЕР масштаба**
- **Что:** вынести состояние из памяти процесса, чтобы запускать ≥2 инстансов и катить без даунтайма.
- **Как:** `AddStackExchangeRedisCache` вместо `AddDistributedMemoryCache`; session-store на Redis; rate-limiter перевести на Redis-backed (общий лимит, а не на инстанс). Hosted-service `OrphanMediaCleanup` сделать **leader-only** (env-флаг `RUN_BACKGROUND_JOBS=true` на одном инстансе или distributed-lock в Redis) — иначе каждый инстанс чистит параллельно.
- **Когда:** перед публичным запуском / перед rolling-deploy.
- **Зависимость:** Redis (контейнер в compose или managed).
- **Готово когда:** 2 инстанса за балансировщиком держат общую сессию и общий лимит; фон-задача стартует ровно на одном.

### 2.2 ⛔ Объектное хранилище медиа (S3/R2)
- **Что:** отвязать загрузки от диска инстанса (сейчас гибнут при пересоздании контейнера, ломают масштаб).
- **Как:** реализовать `S3MediaStorage : IMediaStorage` (абстракция готова — Фаза 5): AWS SDK или Minio-клиент, бакет через env, `PublicUrl` → CDN/бакет-URL, `LocalRootForMaintenance => null` (orphan-cleanup сам отключится, его роль берут lifecycle-правила бакета). Поменять одну строку регистрации в `Startup`.
- **Когда:** вместе с 2.1 (multi-instance без общего хранилища невозможен).
- **Зависимость:** S3-совместимый бакет (R2/Spaces/Minio).
- **Готово когда:** загрузка/отдача/удаление работают через бакет; контроллеры не правились.

---

## Milestone 3 — Монетизация (биллинг)
**Цель:** принимать оплату. **Отложено пользователем** — не начинать, пока сам не вернётся к теме.

### 3.1 ⛔ Реальный платёжный провайдер
- **Что:** заменить заглушку `ManualPaymentProvider` (сейчас `VerifyAndParse` всегда отклоняет вебхук → денег принять нечем).
- **Как:** провайдер с оплатой из РФ (YooKassa) или Stripe; проверка подписи вебхука; идемпотентность (`BillingEvent` с уникальным индексом уже есть); связать успешный платёж с `Subscription`. Обвязка тарифов/лимитов (`EntitlementService`) уже готова.
- **Когда:** после закрытия M1+M2 (сначала надёжность, потом деньги).
- **Готово когда:** тестовый платёж в sandbox апгрейдит тариф через вебхук, повтор события не дублирует подписку.

---

## Milestone 4 — Технический долг (continuous, не блокеры)
**Цель:** управляемость кода. Делается параллельно/после запуска, по приоритету.

### 4.1 🟡 Разбить god-files
- **Что:** `wwwroot/js/lime/lime-doc-editor.js` (было 6285 строк; сейчас 5629) и `HomeController` (CRUD сайтов + профиль + auth в одном).
- **Как:** редактор — выделить модули (toolbar/inspector/canvas/dnd) через ES-модули или namespaced-IIFE, по одному срезу за раз с прогоном Playwright editor-v2 после каждого. Контроллер — вынести Site-CRUD в `SiteService`, профиль/аккаунт в отдельный контроллер.
- **Сделано 2026-06-28:** `HomeController` разрезан до 276 строк; auth/profile/GDPR-account вынесены в `AccountController` со старыми URL `/Home/*`; Site-CRUD/ownership/dashboard/slug вынесены в `SiteService`; из редактора вынесены первые namespaced-IIFE модули `lime-editor-utils.js` (path/id/csrf/html helpers), `lime-editor-components.js` (component target/source/design/style helpers), `lime-editor-command-palette.js` (Ctrl+K UI/search/keyboard handling), `lime-editor-inspector-controls.js` (style inspector control rendering/registry helpers), `lime-editor-layers.js` (layer tree labels/flattening/virtualized rendering), `lime-editor-context-menu.js` (block context menu rendering/positioning/close handling), `lime-editor-media-picker.js` (media modal tabs/list/upload/stock/select handling) и `lime-editor-sidebar.js` (sidebar rail panels/block search wiring). Затем вынесен
  `lime-editor-onboarding.js` (coachmark-тур этапа 9.4 — полностью изолирован от состояния редактора),
  а затем группой `lime-editor-topbar.js` (overflow-меню «⋯») и `lime-editor-intro.js` (стартовый
  промпт пустого документа; deps totalBlocks/runGenerate, hide+dismiss для skip/тура).
- **Сделано 2026-06-29:** вынесены `lime-editor-theme.js` (панель токенов сайта: 5 цветов + шрифт + 8 курируемых палитр; deps doc/defaultTheme/beginCheckpointMutation/render/markDirty/fontOptionsHtml; модальный тоггл оставлен inline — на `themeModal` ссылается command palette), `lime-editor-site-code.js` (модалка «Код сайта»: кастомный CSS живьём + вставка в head; `codeModal` оставлен inline — на него ссылается command palette) и `lime-editor-section-bg.js` (фон секции: цвет/градиент/картинка + затемнение + видео + пресеты; изменяемое состояние selectedId/currentBp/cmdStore проброшено ГЕТТЕРАМИ — нужно актуальное на момент async-вызова из обработчика инспектора; `hexToRgba` была объявлена дважды → модулю дана своя копия, box-shadow откатился на эквивалентную раннюю версию). `lime-doc-editor.js` 5629→5466.
- **Проверено 2026-06-28:** `node --check` для вынесенных JS; smoke media picker/sidebar; `dotnet build Lime_Editor.sln --no-restore`; `npm run test:e2e:editor-v2` 41/41 (после выноса onboarding — перепрогон зелёный); `dotnet test Lime_Editor.sln --no-build` 172/172.
- **Проверено 2026-06-29:** `node --check` (theme + site-code + section-bg + main); `npm run test:e2e:editor-v2` 41/41 зелёные после каждого выноса (оверлей-тест покрывает bgInspector+liveOverlay+command-gesture).
- **✅ Латентный баг (предсуществующий) ИСПРАВЛЕН 2026-06-29:** в `bgInspector` режим фона «Картинка» зовёт `seg("backgroundSize"/"backgroundPosition", …)`, но top-level `seg` никогда не существовал → переключение фона секции на изображение падало (ReferenceError), тесты не покрывали. Оказалось, нужный билдер — `segmented(prop, opts, cur)` из inspector-controls (рендерит `data-doc-style`/`data-val`, которые уже ловит обработчик инспектора и зовёт `setStyle`). Фикс: экспортировал `segmented` из inspector-controls, в main `var seg = inspectorControls.segmented`, прокинул в section-bg. Регрессия закрыта новым `tests/lime-section-bg.selftest.cjs` (8/8: image-режим рендерит size/position-контролы; без seg падает). Проверено: node selftest 8/8 + editor-v2 41/41.
- **Когда:** continuous; не блокирует запуск. Резать инкрементально, не «большой переписью».
- **Готово когда:** ни один файл > ~1500 строк; тесты/смоки зелёные после каждого среза.

### 4.2 🧹 Включить nullable reference types
- **Что:** `<Nullable>disable</Nullable>` отключает защиту от NRE на весь проект.
- **Как:** включать поэтапно — `#nullable enable` пофайлово на новом/трогаемом коде, затем по проекту, разгребая warning'и. Не флипать глобально одним коммитом (лавина предупреждений).
- **Когда:** continuous, начиная с нового кода.
- **Готово когда:** `<Nullable>enable</Nullable>` на уровне проекта, 0 warning.

### 4.3 🧹 Мелочи
- ✅ **Playwright auth-флоу** (2026-06-29) — прогнаны sign-up→sign-in→MySites, валидации (mismatch/invalid email/несуществующий логин) и новые forgot/reset-password (anti-enumeration на ForgotPassword + отклонение битого токена на ResetPassword). Починен устаревший селектор приветствия (`.lime-dashboard__welcome` → `.lime-dash-hi`). `tests/flows/sign-up.spec.ts` 9/9 зелёные на dev-Postgres.
- **csproj cleanup** — убрать стэйл `<Folder Include="wwwroot\css\Template_1\">` (папки уже нет). *Когда:* при следующей правке csproj.
- **Парольная политика** — при желании поднять до требования спецсимвола (сейчас 8+цифра). *Когда:* по продуктовому решению.

---

## Порядок и зависимости (кратко)

```
M1 (бэкапы → observability → email-confirm)      ← перед первым пользователем
        ↓
M2 (Redis + S3, идут вместе)                     ← перед публичным запуском / масштабом
        ↓
M3 (биллинг)                                     ← когда продукт готов к деньгам (отложено)

M4 (god-files, nullable, мелочи)                 ← параллельно/постоянно, не блокер
```

**Минимум «можно открыть дверь»:** M1 целиком.
**Минимум «можно пускать толпу»:** M1 + M2.
**Монетизация:** M3 (по готовности).
