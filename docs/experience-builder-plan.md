# Lime: план развития конструктора с низким входом и высоким потолком

Дата: 2026-07-01 · Ревизия: 2026-07-03 (сверка с кодом после разбивки god file; embed/asset-факты проверены разведкой backend'а)

## Summary

Цель: развить Lime так, чтобы новичок начинал с простого холста и готовых experience packs, а продвинутый пользователь постепенно доходил до уровня интерактивных брендовых сайтов вроде ChainZoku: сильные ассеты, сцены, слои, motion, 3D/embed, компоненты и кастомизация.

Первый фокус: curated showcase-вертикаль для креаторов, Web3, игр и брендов, вдохновленная уровнем ChainZoku, но без копирования его ассетов, текста или айдентики. Результат первого этапа: демо + reusable-инструменты, production-ready по адаптиву, безопасности и скорости.

## Реальность и границы (честная рамка)

Этот раздел важнее остального документа: без него план превращается в обещание, которое движок не сдержит.

- ChainZoku — это НЕ вывод конструктора. Это bespoke creative-dev работа студии: кастомный Three.js/WebGL, собственные GLSL-шейдеры, GSAP ScrollTrigger с посекционным пиннингом и синхронизацией камеры со скроллом, кастомный курсор, прелоадер, звук, сквозная арт-дирекция (каждая секция уникальна, а не «сетка карточек»). Такое пишется руками неделями под конкретный проект. Ни Webflow, ни Framer, ни Wix Studio не генерируют это из шаблонов — на них делают близкое, но всегда руками дизайнера-разработчика поверх движка.
- Реалистичная цель Lime: не копия, а «сайт, который обычного посетителя впечатляет не меньше» — ~70–80% воспринимаемого «вау» через embed-first + сильные motion-рецепты + хорошие ассеты.
- Жёсткий потолок embed-подхода (принять как данность на первом этапе): embed живёт в отдельном iframe и НЕ синхронизируется со скроллом хост-страницы без кастомного кода, которого в конструкторе нет. Значит: бесшовной хореографии «камера+текст+переходы в одном тайминге», кастомных шейдеров, вплетённых в скролл страницы, и уникальной по-секционной арт-дирекции первый этап не даёт.
- Бутылочное горлышко — не движок, а ассеты и арт-дирекция. Результат на ~80% зависит от того, появится ли сильная Spline-сцена, кастомный 3D-персонаж, продуманная палитра и типографика. Движок — множитель качества ассетов, а не его источник. Строка из Assumptions «уровень ChainZoku = качество композиции и ассетов, а не копирование» — самая точная в документе; держимся за неё.

## Key Changes

- Добавить слой Experience Packs поверх текущих `LimeTemplates` и `LimePresets`: статические curated-паки без новой БД на первом этапе.
- Формат пака: `key`, `name`, `category`, `level`, `theme`, `sections`, `assetSlots`, `motionProfile`, `preview`.
- Первый пак: `neo-lore-drop`: hero, lore intro, factions/clans, vision cards, customization embed, team, FAQ, Discord/CTA, footer.
- ВНИМАНИЕ: часть секций пака — это НОВЫЕ типы, а не композиция. Текущие 14 пресетов (navbar, hero, logos, features, stats, steps, split, pricing, testimonials, team, faq, contact, cta, footer) НЕ содержат `lore intro`, `factions/clans`, `vision cards`, `customization embed`. Их надо спроектировать и добавить в `LimePresets` как новые пресеты — это отдельная работа, а не «расширить существующие». Переиспользуем: navbar, hero, team, faq, cta(→Discord), footer.
- Перестроить вход в редактор под canvas-first: пустой документ открывает холст и стартовую панель "Выбрать пак / начать с секции / AI-идея", без обязательного мастера.
- Существующий редактор остается единым, но получает уровни UI: `Basic`, `Design`, `Motion`, `Pro`.
- Сделать раскрытие функций обучающим, не paywall:
  - `Basic`: текст, картинки, секции, тема.
  - `Design`: layout, free-mode, reusable classes, компоненты.
  - `Motion`: сцены, parallax, marquee, reveal, декоративные слои.
  - `Pro`: custom CSS/head, export, embed/3D, advanced SEO.
- Новых тарифных гейтов не добавлять; существующие ограничения custom code оставить как есть.
- Усилить motion/scene UX поверх уже существующих `scene`, `parallax`, `marquee`, `layers`.
- Добавить готовые рецепты сцен: pinned hero, horizontal cards, layered parallax, reveal sequence, marquee strip.
- В инспекторе показывать человеческие пресеты вместо голых чисел там, где это возможно.
- Улучшить media/asset workflow: добавить asset slots для паков: logo, hero character, background, decor layer, video/poster, 3D/embed.
- Для каждого asset slot показывать требования: формат, прозрачность, рекомендуемые размеры, mobile-safe crop.
- AI-ассеты делать смешанно: Lime предлагает промпты, идеи или генерацию, но пользователь может загрузить свои медиа.
- 3D в первом этапе делать embed-first: улучшить текущий `embed` как управляемый блок для Spline/Rive/Lottie/iframe-сцен.
- Embed — точная делта (проверено 2026-07-03). УЖЕ сделано: sandbox (`allow-scripts allow-same-origin allow-popups`), `loading="lazy"`, https-only regex на вводе и рендере, host-allowlist, `provider`/`aspect`/`poster`/`fallbackTitle`/`fallbackText` в контенте, aspect ratio на wrapper, poster/fallback до загрузки iframe, provider-пресеты в `promptEmbed` (Spline/Rive/Lottie/YouTube/Vimeo/Sketchfab/Figma вместо голого URL-prompt). ОСТАЛОСЬ: подобрать реальный hero-embed/постер для эталона и замерить publish.
- ✅ СДЕЛАНО 2026-07-03 (безопасность): host-allowlist для embed-URL — `LimeDoc.isAllowedEmbedUrl`/`EMBED_HOSTS` (spline.design, rive.app, lottie.host, lottiefiles, youtube, vimeo, sketchfab, figma; домен или поддомен, порт/user@-трюки отклоняются). Проверка в общем рендере → действует в редакторе, node-тестах и на publish (Jint) одинаково; плюс валидация на вводе в `promptEmbed` с человеческим сообщением. Произвольный https-iframe запрещён (пользователей ещё нет — ослабить можно позже). Тесты: 8 проверок в `tests/lime-doc.selftest.cjs`, dotnet 250/250 (паритет цел), editor-v2 41/41.
- Native Three.js/GLB viewer не входит в первый этап.
- Расширить AI из генератора базового лендинга в creative assistant — но фазами, а не одним прыжком. Каждый новый навык AI = новая командная поверхность со своей валидацией в allowlist `LimeCommands.validateAiCommands`; нельзя открывать всё сразу.
  - Фаза A: «заполнить секции пака текстом» (уже близко к текущему `setContent`/`aiSuggest`).
  - Фаза B: «выбрать experience pack + применить theme/motion-команды» (новые типы команд, расширить allowlist и dry-run).
  - Фаза C: «предложить asset prompts под слоты» (текстовый вывод-бриф, без генерации файлов).
  - Фаза D: «адаптировать mobile» (уже есть `aiAdaptMobile`, только довести под новые секции).
- Ответы AI по-прежнему только JSON/commands, без произвольного HTML; каждый новый тип команды проходит validate → dry-run на клоне → preview → один undo (инвариант текущего пайплайна не ослаблять).

## Implementation Notes

- Основной путь (актуализировано 2026-07-03, после разбивки god file 2625→1456 / 38 модулей): паки и шаблоны → `lime-editor-presets.js` — runtime-применение пака это буквально готовое API `LimeEditorPresets.applyTemplateByKey`/`insertPreset` (spec `blockFromSpec` поддерживает styles/css/anim/layers/scene/fx; stale-doc фикс под runtime-вызов сделан, регрессия покрыта `tests/lime-presets.selftest.cjs`); данные секций → `lime-presets.js`/`lime-templates.js`; motion-рецепты → `lime-editor-effects.js`; embed UI → `lime-editor-media-actions.js` (`promptEmbed`); панель/инспектор → `lime-editor-inspector.js`/`lime-editor-inspector-events.js`; запись стилей → `lime-editor-style-engine.js`; AI → `lime-editor-ai-pipeline.js` + `AiContentService`. В `lime-doc-editor.js` (композиционный корень) — только инъекции.
- Тесты новых модулей — по установленному паттерну node-селфтестов `tests/lime-*.selftest.cjs` (22 существующих как образец) + editor-v2 Playwright после каждого среза.
- Не ломать текущий JSON-документ: новые поля должны быть additive и безопасно игнорироваться старым рендером.
- Showcase pack должен использовать только свои, свободные или сгенерированные заглушки, не ChainZoku assets.
- Публикация должна оставаться безопасной: sandbox для embed, sanitize custom head, без editor-only атрибутов в publish.
- Asset-пайплайн (backend) — ПРОВЕРЕНО 2026-07-03. Что уже есть и достаточно: аплоад 5 MB с трёхслойной валидацией (расширение/MIME/magic-bytes: jpg/png/gif/webp), ImageSharp resize до 1920 по большей стороне, jpeg q82, decompression-bomb guard. Три именованные дыры до «уровня ChainZoku»:
  - ✅ (а) СДЕЛАНО 2026-07-03: `/media/**` отдаётся с `Cache-Control: public, max-age=31536000, immutable` (`Startup.UseStaticFiles.OnPrepareResponse`; имена — GUID, контент по URL неизменен). dotnet build/tests зелёные.
  - (б) видео загрузить НЕЛЬЗЯ вообще: видео-блок = только YouTube, фон-видео секции (`bg.videoSrc`/`poster`) рендерится, но принимает только внешний URL. Слот «video/poster» из asset slots требует либо видео-аплоада (mp4/webm, отдельный лимит и валидация), либо честной пометки «v1: видео только внешним URL».
  - (в) avif не принимается (webp есть) — опционально, не блокер.

## Milestones и секвенсинг

Порядок обязателен: сначала доказываем потолок одним ручным эталоном, только потом строим переиспользуемую инфраструктуру.

- Milestone 0 — эталонный спайк (1–2 недели, приоритет №1). Собрать ОДИН `neo-lore-drop` ВРУЧНУЮ на текущем движке, выжав максимум: настоящая Spline-сцена в hero, реальные ассеты, все motion-рецепты, mobile-fallback, publish без ошибок. Цель — не код на переиспользование, а честный ответ «дотягивает ли embed-first до того, что я представлял». Definition of done: опубликованная страница, на которую не стыдно смотреть, с зафиксированным перф-замером. Это gate: если результат не убеждает — паузим инфраструктуру и пересматриваем подход.
  - Статус 2026-07-03: НАЧАТ — кодовый эталон `neo-lore-drop` добавлен как стартовый template + curated `neo-*` секции; embed-slot поддерживает provider/aspect/poster/fallback, horizontal scene имеет mobile fallback. Не закрыто: реальные ассеты/Spline-сцена, опубликованная страница и перф-замер.
  - Перф-замер спайка: cache-headers для медиа закрыты 2026-07-03 (дыра «а») — замер будет честным.
- Milestone 1 — извлечь эталон в Experience Pack: вынести новые секции в `LimePresets`, оформить формат пака, canvas-first вход с панелью «Выбрать пак».
- Milestone 2 — уровни UI (Basic/Design/Motion/Pro) как прогрессивное раскрытие, без новых paywall-гейтов.
- Milestone 3 — motion/scene UX: готовые рецепты сцен + человеческие пресеты в инспекторе.
- Milestone 4 — asset slots + требования к слотам + backend-пайплайн ассетов.
- Milestone 5 — AI creative assistant по фазам A→D (см. Key Changes).

## Перф-бюджет и доступность (design-constraints, не тесты)

Это ограничения на этапе проектирования, а не только строки в Test Plan.

- Embed грузится лениво и defer до попадания во вьюпорт; до загрузки — обязательный poster/fallback, чтобы не бить LCP.
- Целевой LCP showcase-страницы ≤ 2.5с на среднем мобильном; hero-poster виден мгновенно, тяжёлая сцена догружается после.
- `prefers-reduced-motion` — поведение по умолчанию, а не галочка: pinned/horizontal/parallax при reduced-motion деградируют в статичный читаемый контент.
- Mobile-деградация pinned/horizontal сцен — жёсткое правило: на узком экране они не должны ломать чтение или ловить jank; при сомнении — статичный fallback.
- ✅ Cache-Control для `/media/**` (public, max-age=31536000, immutable) — сделано 2026-07-03, prerequisite бюджета закрыт.

## Критерии успеха (измеримые)

- Новичок публикует приличный showcase за < 10 минут, ни разу не открыв Motion/Pro.
- Опубликованный `neo-lore-drop` проходит перф-бюджет выше на реальном мобильном.
- Продвинутый пользователь может заменить hero-embed и все asset slots своими медиа без правки кода.

## Связь с запуском и Editor V2 roadmap

- Это крупный scope-add рядом с launch-очередью `ROADMAP.md`. Обновление 2026-07-03: код-конкуренция снята — M4.1 (god-files) закрыт, оставшиеся ship-блокеры M1 (бэкапы off-site / Sentry / SMTP) ждут внешних сервисов, а не кода. Спайк (Milestone 0) можно делать сейчас, не вытесняя запуск; Milestones 1–5 — по-прежнему после закрытия M1.
- Явно зафиксировать, что здесь «до запуска» (максимум — спайк), а что «после». Не заводить вторую параллельную дорожную карту: место этого плана — рядом с `ROADMAP.md` (M-вехи запуска там; файла `EDITOR_V2_PLAN.md` в репо нет — прежняя ссылка была битой).
- Биллинг не трогаем (заморожен): никаких новых тарифных гейтов, ограничения custom code — как есть.

## Test Plan

- Unit/selftests: проверить рендер нового showcase-документа: layers, scenes, embed, mobile CSS, отсутствие editor-only hooks.
- Unit/selftests: расширить AI tests на новые разрешенные block/command типы и asset prompt output.
- Unit/selftests: ✅ embed покрыт в `lime-doc.selftest.cjs` и `lime-media-actions.selftest.cjs`: host-allowlist, provider autodetect/presets, aspect fallback, poster sanitize, fallback markup, publish без editor-only hooks, prompt validation.
- Playwright: сценарий "пустой холст -> выбрать `neo-lore-drop` -> заменить hero media -> включить Motion mode -> publish".
- Playwright: сценарий progressive UI: Basic не перегружен, Design/Motion/Pro открывают нужные панели.
- Playwright: mobile viewport: showcase не разваливается, текст не перекрывается, horizontal/pinned scenes имеют fallback.
- Visual/a11y: добавить визуальный snapshot для showcase pack.
- Visual/a11y: прогнать `test:e2e:visual`, `test:e2e:a11y`, `test:e2e:editor-v2`.
- Production acceptance: publish-страница загружается без JS-ошибок, embed lazy/fallback работает, reduced-motion не ломает контент.

## Assumptions

- "Уровень ChainZoku" означает качество композиции, motion, ассетов и интерактивности, а не копирование сайта.
- Первый релиз делает одну сильную showcase-вертикаль, потом подход масштабируется на SMB, портфолио и ecommerce.
- Вход остается через холст, но с сильными стартовыми подсказками и experience panel.
- Генерация ассетов не обязана полностью заменять художника; Lime должен честно помогать брифом, слотами, промптами и загрузкой.
