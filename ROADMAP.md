# Lime — Roadmap до запуска

> Дорожная карта подготовки продукта к публичному запуску. Обновлено: **2026-07-06**.
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
- **Что:** `wwwroot/js/lime/lime-doc-editor.js` (было 6285 строк; сейчас **1456** — цель <1500 ДОСТИГНУТА 2026-07-03, ни один файл в `js/lime/` не превышает 1500) и `HomeController` (CRUD сайтов + профиль + auth в одном; сейчас ~284 строки).
- **Как:** редактор — выделить модули (toolbar/inspector/canvas/dnd) через ES-модули или namespaced-IIFE, по одному срезу за раз с прогоном Playwright editor-v2 после каждого. Контроллер — вынести Site-CRUD в `SiteService`, профиль/аккаунт в отдельный контроллер.
- **Сделано 2026-06-28:** `HomeController` разрезан до 276 строк; auth/profile/GDPR-account вынесены в `AccountController` со старыми URL `/Home/*`; Site-CRUD/ownership/dashboard/slug вынесены в `SiteService`; из редактора вынесены первые namespaced-IIFE модули `lime-editor-utils.js` (path/id/csrf/html helpers), `lime-editor-components.js` (component target/source/design/style helpers), `lime-editor-command-palette.js` (Ctrl+K UI/search/keyboard handling), `lime-editor-inspector-controls.js` (style inspector control rendering/registry helpers), `lime-editor-layers.js` (layer tree labels/flattening/virtualized rendering), `lime-editor-context-menu.js` (block context menu rendering/positioning/close handling), `lime-editor-media-picker.js` (media modal tabs/list/upload/stock/select handling) и `lime-editor-sidebar.js` (sidebar rail panels/block search wiring). Затем вынесен
  `lime-editor-onboarding.js` (coachmark-тур этапа 9.4 — полностью изолирован от состояния редактора),
  а затем группой `lime-editor-topbar.js` (overflow-меню «⋯») и `lime-editor-intro.js` (стартовый
  промпт пустого документа; deps totalBlocks/runGenerate, hide+dismiss для skip/тура).
- **Сделано 2026-06-29:** вынесены `lime-editor-theme.js` (панель токенов сайта: 5 цветов + шрифт + 8 курируемых палитр; deps doc/defaultTheme/beginCheckpointMutation/render/markDirty/fontOptionsHtml; модальный тоггл оставлен inline — на `themeModal` ссылается command palette), `lime-editor-site-code.js` (модалка «Код сайта»: кастомный CSS живьём + вставка в head; `codeModal` оставлен inline — на него ссылается command palette) `lime-editor-section-bg.js` (фон секции: цвет/градиент/картинка + затемнение + видео + пресеты; изменяемое состояние selectedId/currentBp/cmdStore проброшено ГЕТТЕРАМИ — нужно актуальное на момент async-вызова из обработчика инспектора; `hexToRgba` была объявлена дважды → модулю дана своя копия, box-shadow откатился на эквивалентную раннюю версию) и `lime-editor-ai-pipeline.js` (AI COMMAND PIPELINE этапа 10.1: applyAiCommands + preview-бар + aiSuggest/aiAdaptMobile; cmdStore/selectedId геттерами, leStatus инъектится из main где осталась генерация; тест-шов window.__LIME_AI__ сохранён через var-алиасы. Генерация и shared-хелперы clone/blockFromSpec/materialize НЕ тронуты — они общая инфра, используются пресетами/шаблонами) и `lime-editor-shadow.js` (первый под-срез INSPECTOR: многослойные box-shadow — parse/UI-билдер/compose/add/del; deps toHex/inspectorEl/setStyle/curStyle/byId/refreshInspector + selectedId геттером; `shadowBuilder` инъектится в inspector-controls через THUNK, т.к. create инспектора идёт раньше места модуля — thunk зовётся на рендере, когда shadowFx уже создан). `lime-doc-editor.js` 5629→5282.
- **Сделано 2026-07-01:** вынесен крупный canvas-срез `lime-editor-v2-canvas.js` (viewport pan/zoom, selection overlay, hover/marquee, transform handles, grid span handle, free-block body drag, palette drag/drop, `window.__LIME_SELECTION__`/`window.__LIME_VIEWPORT__` test hooks). Затем вынесены `lime-editor-pages.js` (tabs, modal manager, slug/title/description/collection для страниц), `lime-editor-persistence.js` (save/autosave/status/local draft recovery), `lime-editor-component-actions.js` (make/detach/reset/insert component, variants, component inspector helpers), `lime-editor-block-actions.js` (move/duplicate/delete/unwrap, group/ungroup, copy/paste, selection wrappers), `lime-editor-ai-generate.js` (AI modal/quota/status, generate/rewrite/edit-block requests, materialize/toast flow) и `lime-editor-media-actions.js` (gallery add/delete, media picker binding, image/video/embed/background/layer media apply). Из `lime-doc-editor.js` оставлены callbacks/getters и совместимые wrappers (`refreshPages`, `markDirty`, `scheduleAutosave`, `maybeOfferRecovery`, component/block/AI/media action wrappers), чтобы остальной редактор не зависел от внутренностей модулей. Размеры после срезов: `lime-doc-editor.js` 4522→2760, новые модули `v2-canvas` 1109 строк, `pages` 254 строки, `persistence` 216 строк, `component-actions` 262 строки, `block-actions` 359 строк, `ai-generate` 271 строк, `media-actions` 160 строк.
- **Сделано 2026-07-01 (2):** из инспектора вынесен CMS-срез `lime-editor-content-binding.js` (наполнение select коллекций из `/Data/ApiList`, `editorCollectionData`/`templateSampleRecord` для превью collectionList/страницы-шаблона, `bindingSection` — привязка text/heading/image к полю записи, `contentExtras` — источник collectionList + countdown, `setContentFlag`). Общий `collectionsCache` оставлен в main (его читают render/INIT) и проброшен в модуль get/set-инъекцией; `doc`/`active`/`selectedId` — геттерами. `lime-doc-editor.js` 2760→2625, модуль 205 строк.
- **Сделано 2026-07-01 (3):** вынесен `lime-editor-command-registry.js` (реестр Ctrl+K-команд и wiring `LimeEditorCommandPalette`: вставка блоков, панели сайдбара, брейкпоинты, тема/код сайта, AI, history и block actions). В main оставлена только инъекция зависимостей; `selectedId` читается геттером на момент запуска команды, чтобы палитра не держала устаревшее состояние. `EditDoc.cshtml` подключает registry сразу после `lime-editor-command-palette.js`. Текущий размер `lime-doc-editor.js` 2555→2534, новый модуль 76 строк.
- **Сделано 2026-07-01 (4):** вынесен `lime-editor-breakpoints.js` (переключатели desktop/tablet/mobile, `data-device` на workspace и кнопка preview-анимации через `LimeAnim.play`). В main оставлен совместимый wrapper `switchBreakpoint`, потому его вызывает AI pipeline; состояние `currentBp` меняется через setter-инъекцию. `EditDoc.cshtml` подключает модуль до `lime-doc-editor.js`. `lime-doc-editor.js` 2534→2529, новый модуль 36 строк.
- **Сделано 2026-07-01 (5):** вынесен `lime-editor-add-block.js` (вставка блоков из палитры, добавление внутрь выбранного контейнера, guard от двойного click после palette drag, синхронизация `window.__LIME_SELECTION__`, empty-state add/AI actions). В main осталась только инъекция зависимостей; `selectedId`/`paletteJustDragged` меняются через getter/setter. `lime-doc-editor.js` 2529→2499, новый модуль 83 строки.
- **Сделано 2026-07-01 (6):** вынесен `lime-editor-presets.js` (рендер плиток пресетов, вставка пресета в выбранный контейнер/корень, применение `?template=...`, общий `blockFromSpec` для шаблонов и AI-generate). Раннее применение стартового шаблона оставлено до command history, чтобы baseline истории не изменился; `selectedId` меняется через getter/setter. `EditDoc.cshtml` подключает модуль до `lime-doc-editor.js`. `lime-doc-editor.js` 2499→2458, новый модуль 100 строк.
- **Сделано 2026-07-01 (7):** вынесен `lime-editor-perf.js` (Stage 7 perf-инструмент: `__LIME_PERF__.report/reset/bench/load`, счётчики full/inc render и синтетическая нагрузка). В main остались совместимые wrappers `perfNow()`/`perfRec()` и reset command-store через callback, чтобы render/patch-код не менять. `EditDoc.cshtml` подключает модуль до `lime-doc-editor.js`. `lime-doc-editor.js` 2458→2424, новый модуль 107 строк.
- **Сделано 2026-07-01 (8):** вынесен `lime-editor-inline-edit.js` (contenteditable input без полного render, inline-транзакция command-store, fallback-запись content/override для компонентных инстансов). В main остались wrappers `commitInlineEdit()`/`clearInlineEditPending()`; старые restore/undo пути переведены с прямого `editDebounce` на wrapper, что закрыло зависший rerender после undo. `EditDoc.cshtml` подключает модуль до `lime-doc-editor.js`. `lime-doc-editor.js` 2424→2395, новый модуль 106 строк.
- **Сделано 2026-07-01 (9):** в существующий `lime-editor-layers.js` перенесён glue дерева слоёв: cache виртуальных rows, bind click/keyboard/scroll, node controls hide/lock/rename/z-index и command/fallback применение. В main остался совместимый wrapper `refreshLayers()` для canvas/block-actions. `lime-doc-editor.js` 2395→2310, `lime-editor-layers.js` 153→248 строк. (Фактический итог раунда по `wc -l` — 2376: промежуточные цифры срезов считались до части wrapper'ов.)
- **Сделано 2026-07-02:** из инспектора вынесен gesture-движок стилей `lime-editor-style-engine.js` (транзакции commitStyleEdit/commitBlockEdit, commandStyle/Override/Multi, setStyle/resetStyleProps/setClassStyle, multiStyleModel/v2SelectionIds, commandBlockGesture/commandContentGesture). В main — тонкие function-declaration wrappers (hoisted): их получают по значению модули, создающиеся раньше (inline-edit/effects/shadow). Изменяемое состояние (cmdStore/doc/cmdPrev/selectedId/currentBp/currentClass/currentState) — get/set-инъекциями. Заодно EditorStyleEngine/EditorContentBinding добавлены в guard-блок «module is required». `lime-doc-editor.js` 2376→2097, модуль 387 строк.
- **Проверено 2026-07-02:** `node --check` (style-engine + main); новый node-самотест `tests/lime-style-engine.selftest.cjs` **26/26** (один begin на серию правок, коммит при смене ключа жеста, no-op dispatch без snapshot-fallback, multi fan-out блок+инстанс, reset-транзакция, класс через checkpoint, legacy fallback, multiStyleModel common/mixed); полный `npm run test:e2e:editor-v2` **41/41** (Stage 5 тесты бьют по движку через UI: scrub, override/reset, multi-select, class badge).
- **Сделано 2026-07-03:** три среза. (1) `lime-editor-dnd.js` — SortableJS glue: arrayOfList/subtreeOwnsArray (защита от цикла), onDragEnd (command reorder/move + legacy splice-fallback, design-блок → полный finishMutation), идемпотентный initDnD. (2) `lime-editor-render.js` — render pipeline: полный render (empty-state/L.render), Stage 7 patch/insert/remove/move-DOM с safe-gate'ами, finish*-обвязка, батч-refresh слоёв (rAF), preview-стили (styleBlockEl/applyPreviewStyles/Scoped), ensureDocFonts. (3) `lime-editor-inspector.js` — inspector view: curStyle/bpLabel, провенанс секций (sectionSource/ownOverrideProps/styleSectionHtml, core/adv-группа), refreshInspector (шапка/вкладки/баннеры/склейка секций-модулей); inspectorAdvOpen — приватное состояние модуля. Везде get/set-инъекции для изменяемого состояния; алиасы, присваиваемые ниже точки создания (initLayerDrag/editorCollectionData/templateSampleRecord/bindingSection/contentExtras/bgInspector/populateCollectionPickers/refreshV2SelectionOverlay), — thunk'ами; наружные API — hoisted function-declaration wrappers. `lime-doc-editor.js` 2097→1684; модули 148/307/299 строк.
- **Проверено 2026-07-03:** `node --check` (dnd + render + inspector + main после каждого среза); новые node-самотесты `tests/lime-dnd.selftest.cjs` **14/14** (reorder/move fallback, command-путь без ручной мутации, защита от цикла, design→finishMutation, no-op, идемпотентность initDnD), `tests/lime-render.selftest.cjs` **16/16** (placeholder/render, safe-gates patch/insert/remove, finish*→autosave/dirty, rAF-батч, hover-превью у выбранного, ensureDocFonts), `tests/lime-inspector.selftest.cjs` **17/17** (curStyle класс/hover/bp, sectionSource все ветки, ownOverrideProps-пересечение, core/adv, empty-state/шапка/вкладки/баннеры). Полный `npm run test:e2e:editor-v2` **41/41 после каждого из трёх срезов** (3 прогона).
- **Сделано 2026-07-03 (2):** вынесен `lime-editor-inspector-events.js` — делегированные обработчики панели инспектора: drag-to-adjust скраб (Shift ×10/Alt ×0.1, один change на отпускании), change (юниты/V2-design/component prop/variant), input (стили/анимация/градиент/overlay/motion/слои/тень/CMS-поля/классы), click-диспетчер (reset'ы, вкладки, hover-state, классы, фон включая bg-preset-транзакцию, эффекты/движение/декор-слои, тулбар data-doc-op). Модуль только маршрутизирует в инъектированные экшены (~80 инъекций — все hoisted-обёртки/ранние алиасы, thunk'и не нужны); currentState/currentInspectorTab — через сеттеры. `lime-doc-editor.js` 1684→**1456** — **цель M4.1 <1500 достигнута**, ни один файл в `js/lime/` не превышает 1500 (крупнейший после main — `v2-canvas` 1109).
- **Проверено 2026-07-03 (2):** `node --check` (inspector-events + main); новый node-самотест `tests/lime-inspector-events.selftest.cjs` **15/15** (setStyle с юнитом + сброс mixed, CMS-поля→setContentFlag, reset стилей, вкладки, hover-state, тулбар-ops, bg-preset одной транзакцией + autosave, component prop, скраб pointerdown→move→up = один change); полный `npm run test:e2e:editor-v2` **41/41**.
- **Исправлено 2026-07-02 (ревью раунда):** stale-`doc` в `lime-editor-presets.js` и `lime-editor-perf.js` — оба захватывали `doc` прямой ссылкой (`doc: doc`), а main переприсваивает `doc` на undo/redo/restore (~15 мест, `doc = cmdStore.getDoc()`), из-за чего `applyTemplateByKey` (тема) и `__LIME_PERF__.load()` после первого undo писали бы в мёртвый объект. Для presets это критично на перспективу: runtime-«выбрать пак» из experience-builder-плана зовёт ровно `applyTemplateByKey`. Фикс: `getDoc()`-геттер по образцу остальных модулей; в оба селфтеста добавлены регрессионные проверки с подменой doc (`lime-presets.selftest.cjs` 12/12, `lime-perf.selftest.cjs` 12/12). Полный `npm run test:e2e:editor-v2` **41/41** после всех девяти срезов вместе + новый шаблонный тест `--grep "startup template materializes"` зелёный (в grep `editor-v2` не попадает — имя `editor-b:`).
- **Проверено 2026-06-28:** `node --check` для вынесенных JS; smoke media picker/sidebar; `dotnet build Lime_Editor.sln --no-restore`; `npm run test:e2e:editor-v2` 41/41 (после выноса onboarding — перепрогон зелёный); `dotnet test Lime_Editor.sln --no-build` 172/172.
- **Проверено 2026-06-29:** `node --check` (theme + site-code + section-bg + ai-pipeline + shadow + main); `npm run test:e2e:editor-v2` 41/41 зелёные после каждого выноса (оверлей-тест покрывает bgInspector+liveOverlay+command-gesture; apply/preview/cancel-тесты покрывают AI pipeline). Где editor-v2 путь не трогает — добавлены node-самотесты: `tests/lime-section-bg.selftest.cjs` (8/8), `tests/lime-shadow.selftest.cjs` (7/7).
- **Проверено 2026-07-01:** `node --check` для `lime-doc-editor.js`, `lime-editor-v2-canvas.js`, `lime-editor-pages.js`, `lime-editor-persistence.js`, `lime-editor-component-actions.js`, `lime-editor-block-actions.js`, `lime-editor-ai-generate.js`, `lime-editor-media-actions.js`; smoke для canvas/pages/persistence/component-actions/block-actions/AI-generate/media-actions modules; `node tests/lime-doc.selftest.cjs`, `node tests/lime-design.selftest.cjs`, `node tests/lime-viewport.selftest.cjs`, `node tests/lime-selection.selftest.cjs`, `node tests/lime-layout.selftest.cjs`, `node tests/lime-snap.selftest.cjs`, `node tests/lime-commands.selftest.cjs`, `node tests/lime-section-bg.selftest.cjs`; `dotnet build Lime_Editor.sln --no-restore`. Playwright editor-v2 пытался стартовать на HTTPS и HTTP, но не дошёл до тестов из-за локального DataProtection keyring (`C:\Users\Danil\AppData\Local\ASP.NET\DataProtection-Keys`, Access denied/DPAPI key mismatch), поэтому full e2e нужно повторить после настройки dev keyring.
- **Проверено 2026-07-01 (2):** keyring разблокирован — удалён протухший DPAPI-ключ (`key-fc2e82cb…`), .NET сгенерировал свежий под текущую учётку. `npm run test:e2e:editor-v2` **41/41 зелёные** — это подтвердило и предыдущий (2026-07-01) вынос модулей, и новый content-binding-срез. `node --check` (content-binding + main); новый node-самотест `tests/lime-content-binding.selftest.cjs` **16/16** (editorCollectionData/templateSampleRecord/bindingSection/contentExtras/setContentFlag — CMS-путь editor-v2 не покрывает).
- **Проверено 2026-07-01 (3):** `node --check` для `lime-editor-command-registry.js`, `lime-doc-editor.js`, `tests/lime-command-registry.selftest.cjs`; новый node-самотест `tests/lime-command-registry.selftest.cjs` **10/10** (реестр команд, dynamic selectedId, sidebar/click delegates, save/theme/code actions). Точечный Playwright `tests/flows/editor-b.spec.ts --project=chromium-dark --grep "inspector, command palette"` на `http://localhost:5000` **4/4 зелёные**.
- **Проверено 2026-07-01 (4):** `node --check` для `lime-editor-breakpoints.js`, `lime-doc-editor.js`, `tests/lime-breakpoints.selftest.cjs`; новый node-самотест `tests/lime-breakpoints.selftest.cjs` **6/6** (state setter, active-кнопки, `data-device`, refresh callbacks, `LimeAnim.play`). Точечный Playwright `tests/flows/editor-b.spec.ts --project=chromium-dark --grep "breakpoint switcher changes preview device"` на `http://localhost:5000` **4/4 зелёные**.
- **Проверено 2026-07-01 (5):** `node --check` для `lime-editor-add-block.js`, `lime-doc-editor.js`, `tests/lime-add-block.selftest.cjs`; новый node-самотест `tests/lime-add-block.selftest.cjs` **8/8** (top-level insert, insert into selected container, command payloads, selection sync, drag guard, empty add/AI). Точечный Playwright `tests/flows/editor-b.spec.ts --project=chromium-dark --grep "Stage 9.4: empty-state"` на `http://localhost:5000` **4/4 зелёные**.
- **Проверено 2026-07-01 (6):** `node --check` для `lime-editor-presets.js`, `lime-doc-editor.js`, `tests/lime-presets.selftest.cjs`; новый node-самотест `tests/lime-presets.selftest.cjs` **11/11** (blockFromSpec, clone content/styles/layers, preset tiles/click, insert into container/root, selection reset, applyTemplateByKey). Точечный Playwright `tests/flows/editor-b.spec.ts --project=chromium-dark --grep "startup template materializes"` на `http://localhost:5000` **4/4 зелёные**.
- **Проверено 2026-07-01 (7):** `node --check` для `lime-editor-perf.js`, `lime-doc-editor.js`, `tests/lime-perf.selftest.cjs`; новый node-самотест `tests/lime-perf.selftest.cjs` **11/11** (disabled mode, `__LIME_PERF__`, report/reset/record, load fixture, bench render vs patch). Точечный Playwright `tests/flows/editor-b.spec.ts --project=chromium-dark --grep "Stage 7: perf instrument"` на `http://localhost:5000` **4/4 зелёные**.
- **Проверено 2026-07-01 (8):** `node --check` для `lime-editor-inline-edit.js`, `lime-doc-editor.js`, `tests/lime-inline-edit.selftest.cjs`; новый node-самотест `tests/lime-inline-edit.selftest.cjs` **11/11** (inline transaction, setContent, clear pending timer, local fallback, component override, field-switch commit). Точечные Playwright `--grep "component text and visibility"` и `--grep "command flag keeps structural"` на `http://localhost:5000` **4/4 + 4/4 зелёные**.
- **Проверено 2026-07-01 (9):** `node --check` для `lime-editor-layers.js`, `lime-doc-editor.js`, `tests/lime-layers.selftest.cjs`; новый node-самотест `tests/lime-layers.selftest.cjs` **8/8** (refresh/render rows, click/keyboard bind, command controls, fallback controls). Точечный Playwright `--grep "Stage 3: layers control|Stage 9.6"` на `http://localhost:5000` **5/5 зелёные**.
- **✅ Латентный баг (предсуществующий) ИСПРАВЛЕН 2026-06-29:** в `bgInspector` режим фона «Картинка» зовёт `seg("backgroundSize"/"backgroundPosition", …)`, но top-level `seg` никогда не существовал → переключение фона секции на изображение падало (ReferenceError), тесты не покрывали. Оказалось, нужный билдер — `segmented(prop, opts, cur)` из inspector-controls (рендерит `data-doc-style`/`data-val`, которые уже ловит обработчик инспектора и зовёт `setStyle`). Фикс: экспортировал `segmented` из inspector-controls, в main `var seg = inspectorControls.segmented`, прокинул в section-bg. Регрессия закрыта новым `tests/lime-section-bg.selftest.cjs` (8/8: image-режим рендерит size/position-контролы; без seg падает). Проверено: node selftest 8/8 + editor-v2 41/41.
- **Когда:** continuous; не блокирует запуск. Резать инкрементально, не «большой переписью».
- **Готово когда:** ни один файл > ~1500 строк; тесты/смоки зелёные после каждого среза.

### 4.2 🧹 Включить nullable reference types
- **Что:** `<Nullable>disable</Nullable>` отключает защиту от NRE на весь проект.
- **Как:** включать поэтапно — `#nullable enable` пофайлово на новом/трогаемом коде, затем по проекту, разгребая warning'и. Не флипать глобально одним коммитом (лавина предупреждений).
- **Сделано 2026-07-04:** первые 3 файла — те, что реально трогались в этой же сессии (experience-builder-плана Milestone 5) — переведены на `#nullable enable`: `AiContentService.cs` (27 warning'ов честно разобраны: nullable-возвраты у всех `TryParse*`/`CleanBlock`/`Cap`/`EditBlockAsync`, nullable-параметры у `SlugField`/`IsEditableValue`/`Cap`, безопасные `!`/`?? ""` там, где inbound-JSON-путь уже гарантирует non-null логикой кода), `AiController.cs` (2 warning'а: `int.Parse(GetUserId(User))` — `!` с комментарием про гарантию `[Authorize]`, `breakpoint` параметр → `string?` + `!` на вызове, где `responsive`-флаг уже гарантирует non-null), `Models/UserNamePolicy.cs` (только константы, без правок). Итог: 0 warning на всей solution, `dotnet test` **253/253** без изменений в поведении.
- **Когда:** continuous, начиная с нового кода — на нём и продолжать при следующих правках.
- **Готово когда:** `<Nullable>enable</Nullable>` на уровне проекта, 0 warning.

### 4.3 🧹 Мелочи
- ✅ **Embed host-allowlist + Cache-Control медиа** (2026-07-03, находки ревизии experience-builder-плана): (1) embed-URL раньше не проверялся сервером вообще (только js `^https://` + sandbox) — добавлен allowlist доверенных хостов `LimeDoc.isAllowedEmbedUrl`/`EMBED_HOSTS` в общем рендере (редактор + Jint-publish идентично) и валидация на вводе `promptEmbed`; 8 проверок в `lime-doc.selftest.cjs`. (2) `/media/**` отдавался без кэш-заголовков — добавлен `Cache-Control: public, max-age=31536000, immutable` (GUID-имена → безопасно). Проверено: node selftest зелёный, `dotnet test` **250/250** (Jint-паритет цел), editor-v2 **41/41**.
- ✅ **Playwright auth-флоу** (2026-06-29) — прогнаны sign-up→sign-in→MySites, валидации (mismatch/invalid email/несуществующий логин) и новые forgot/reset-password (anti-enumeration на ForgotPassword + отклонение битого токена на ResetPassword). Починен устаревший селектор приветствия (`.lime-dashboard__welcome` → `.lime-dash-hi`). `tests/flows/sign-up.spec.ts` 9/9 зелёные на dev-Postgres.
- ✅ **csproj cleanup** (проверено 2026-07-04) — пункт неактуален: в текущем `Lime_Editor.csproj` нет `<Folder Include="wwwroot\css\Template_1\">`, папки давно нет, ItemGroup чистый (только `wwwroot\demoimages\`).
- **Парольная политика** — при желании поднять до требования спецсимвола (сейчас 8+цифра). *Когда:* по продуктовому решению — сознательно не трогали, это решение пользователя, а не техдолг.

---

## Milestone 5 — Дифференциация (Wave 1, внешний план `.claude/plans/zany-painting-willow.md`)
**Цель:** отдельная от launch-очереди дорожка продуктовых отличий от конкурентов. Не блокер запуска.

### 5.1 ✅ MCP / AI-agent API (закрыто 2026-07-05)
- **Что:** MCP-сервер (`/mcp`, официальный `ModelContextProtocol.AspNetCore`) с 3 инструментами:
  `list_sites`, `get_site_document`, `apply_commands` — свой AI-агент/скрипт пользователя может
  редактировать сайты тем же безопасным command-конвейером, что и браузерный AI, но без входа
  через cookie-сессию.
- **Аутентификация:** новые персональные API-токены (`ApiToken`, хэш SHA-256, страница `/Home/ApiTokens`),
  отдельная авторизационная схема `"ApiToken"` — не трогает cookie-схему Identity.
- **Применение команд:** новый `JsCommandEngine` — Jint исполняет тот же `lime-commands.js`, что
  браузер (`dryRunAiCommands`), без единой правки JS; переиспользован `AiContentService.TryParseCommands`
  для allowlist-валидации команд от агента.
- **Найдено и исправлено живым E2E (не юнит-тестами):** (1) ambient EF tenant-filter
  (`LimeEditorContext.HasQueryFilter`) оказался no-op внутри MCP-запроса — `SiteTools` теперь
  фильтрует по `ICurrentUser` явно, не полагаясь на амбиентный механизм; (2) версия документа
  (`DateTime.Ticks`, 19 цифр) отдавалась как JSON-число — JS/большинство MCP-клиентов теряют
  точность за пределами 2^53, из-за чего `baseVersion` не совпадал при обратной отправке; передаём
  версию строкой.
- **Проверено:** 20 новых xUnit-тестов (ApiTokenService, JsCommandEngine, tenant-isolation SiteTools,
  auth integration) — `dotnet test` 273/273; живой E2E (токен через браузер → 3 инструмента через
  сырые HTTP-вызовы, как настоящий агент) — list/get/apply/conflict/revoke все корректны.
- **Осталось (Wave 1 item 4, вне этого захода):** GitHub+Vercel eject — код написан (см. 5.2),
  осталась регистрация внешнего OAuth-приложения (решение пользователя, как и M1).

### 5.2 🟡 GitHub+Vercel eject (Wave 1 item 4) — код готов, ждёт OAuth-приложения
- **Что:** «задеплоить сайт в свой GitHub-репозиторий» одной кнопкой из MySites +
  ссылка «Импорт в Vercel»; экспорт — тот же NextExportService (blob/jsx), что и скачивание кода.
- **Сделано (2026-07-05/06):** `GitHubDeploymentService` (OAuth-флоу c PKCE, state подписан
  DataProtection, токен пользователя хранится зашифрованным), `GitHubApiClient` (Git Data API:
  blobs→tree→commit→ref), `GitHubController` (Deploy/QuickDeploy/OAuthCallback, ownership +
  гейт AllowExport тарифа), модели `GitHubConnection`/`GitHubSiteDeployment` + миграция,
  страница Deploy + алерты в MySites. DataProtection-ключи в проде персистятся на volume
  `dataprotection_keys` (compose.prod.yml) — иначе пересоздание контейнера делало бы токены
  нечитаемыми. Конфиг: `GITHUB_OAUTH_CLIENT_ID`/`GITHUB_OAUTH_CLIENT_SECRET` (.env.example);
  без них фича честно пишет «не настроено».
- **Тесты (2026-07-06):** 14 xUnit против скриптованного GitHub API без сети — PKCE/state
  (подделка и чужой пользователь → bad_state до единого HTTP-вызова), guards (not_connected /
  site_not_found tenant-изоляция / export_not_allowed / битый токен), полный первый деплой
  (санитизация имени репо, POST git/refs, строка деплоя в БД) и повторный (PATCH ветки,
  родитель = старый head). `dotnet test` 287/287.
- **Осталось:** зарегистрировать OAuth App (callback `https://${DOMAIN}/GitHub/OAuthCallback`),
  живой E2E на реальном аккаунте; GitHub App-режим (выбор существующего repo) — заготовка
  конфига есть, flow не собран.

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
