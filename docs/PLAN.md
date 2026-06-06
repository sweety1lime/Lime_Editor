# План модернизации Lime_Editor → production-ready fullstack SaaS

## Context

**Lime_Editor** — веб-конструктор сайтов (дипломный проект) на ASP.NET Core 5.0 MVC: пользователь
выбирает один из 3 готовых HTML-шаблонов, редактирует контент в браузере через `contenteditable`,
сохраняет в SQL Server и выгружает готовый сайт папкой на диск сервера.

Сейчас это рабочий прототип «фронт + бэк» с серьёзными проблемами: пароли в открытом виде,
строка подключения с паролем `sa` в репозитории, отсутствие авторизации по владельцу,
хрупкий парсинг HTML строковыми `.Replace`, дублирование кода экспорта, .NET 5 (EOL),
нет сервисного слоя, тестов, миграций, контейнеризации и CI/CD.

**Цель** (по выбору пользователя): превратить проект в полноценный fullstack-продукт
production-уровня — сохранить монолит ASP.NET Core, но поднять до .NET 8 LTS, добавить
слоистую архитектуру, нормальную безопасность, тесты, DevOps-обвязку и SaaS-фичи
(хостинг сгенерированных сайтов, медиа, роли). Итог должен выглядеть как настоящий
законченный стек, а не «фронт + бэк из мема про вайбкодеров».

Решения пользователя: **Архитектура** = модернизировать монолит; **Цель** = довести до продакшена;
**Объём** = все 4 пилона (безопасность+auth, тесты+качество, DevOps/CI-CD/Docker, архитектура+фичи).

---

## Часть 1. PRD (Product Requirements Document)

### 1.1 Видение
Lime — SaaS-конструктор лендингов и сайтов: пользователь регистрируется, создаёт сайт из
шаблона, редактирует визуально, публикует по ссылке (хостинг внутри платформы) и/или
скачивает архив. Цель — самодостаточный продукт, который можно задеплоить в облако.

### 1.2 Роли
- **Гость** — видит лендинг, регистрируется/входит.
- **Пользователь** — CRUD своих сайтов, редактирование, публикация, скачивание, профиль.
- **Админ** — управление шаблонами, пользователями, модерация опубликованных сайтов.

### 1.3 Функциональные требования
| # | Эпик | Требование |
|---|------|-----------|
| F1 | Auth | Регистрация с подтверждением email, вход, выход, сброс пароля, хеш паролей |
| F2 | Сайты | Создать из шаблона, список, переименовать, удалить, дублировать — **только свои** |
| F3 | Редактор | Визуальное редактирование контента, автосохранение, версия/история (опц.) |
| F4 | Медиа | Загрузка изображений с валидацией типа/размера, привязка к пользователю |
| F5 | Публикация | Публикация сайта по URL `/{username}/{slug}`, превью, снятие с публикации |
| F6 | Экспорт | Скачивание готового сайта **ZIP-архивом** (не папкой на диск сервера) |
| F7 | Шаблоны | Каталог шаблонов из БД, превью, метаданные, добавление через админку |
| F8 | Профиль | Редактирование профиля, смена пароля, удаление аккаунта (GDPR-friendly) |
| F9 | Админка | Управление пользователями, шаблонами, статистика |

### 1.4 Нефункциональные требования
- **Безопасность**: OWASP Top-10, хеш паролей (ASP.NET Identity / BCrypt), authZ по владельцу,
  antiforgery, валидация загрузок, секреты вне репозитория, HTTPS/HSTS.
- **Надёжность**: миграции БД, транзакции, корректная обработка ошибок (без 500 наружу).
- **Тестируемость**: unit + integration тесты, ≥ базовое покрытие сервисов.
- **Наблюдаемость**: структурированное логирование (Serilog), health-checks.
- **Деплой**: Docker + docker-compose, CI/CD пайплайн, конфиг по окружениям.
- **Производительность**: устранить N+1 запросы, async везде, отдача статики через CDN-ready пути.

### 1.5 Вне рамок (первая версия)
Биллинг/платежи, кастомные домены пользователей, командная работа над сайтом, A/B-тесты.
(Оставить задел в архитектуре, но не реализовывать.)

---

## Часть 2. Технический план (по фазам)

### Фаза 0. Подготовка и гигиена репозитория
- Поднять таргет до **.NET 8.0 LTS** в `Lime_Editor.csproj`, обновить EF Core / пакеты до 8.x.
- **Сменить провайдера БД на PostgreSQL**: убрать `Microsoft.EntityFrameworkCore.SqlServer`,
  добавить `Npgsql.EntityFrameworkCore.PostgreSQL`; в `Startup` заменить `UseSqlServer` на
  `UseNpgsql`. Причина — российские облака дают managed PostgreSQL, а managed SQL Server почти
  никто не предлагает. Детали миграции данных/схемы — в Фазе 5 (миграции) и Части 3 (деплой).
- Убрать секреты из [appsettings.json](Lime_Editor/Lime_Editor/appsettings.json):
  строку подключения вынести в **User Secrets** (dev) и переменные окружения (prod);
  в `appsettings.json` оставить плейсхолдер. Добавить `.gitignore` для секретов;
  при необходимости — `git rm --cached` и ротация пароля БД.
- Удалить мёртвый код: пустую заглушку [CheckImages.cs](Lime_Editor/Lime_Editor/Controllers/CheckImages.cs).
- Навести порядок в `wwwroot/js`: убрать дублирующиеся копии jQuery/Bootstrap (несколько версий),
  зафиксировать единые версии вендоров (через libman или npm).
- Включить `<Nullable>enable</Nullable>` и `<TreatWarningsAsErrors>` постепенно.

### Фаза 1. Безопасность и аутентификация (пилон 1)
- Внедрить **ASP.NET Core Identity** поверх существующей `User` (или, если хочется минимализма —
  BCrypt.Net для хеширования + сохранить свою таблицу). Рекомендация: Identity ради сброса
  пароля, подтверждения email, lockout «из коробки».
- Заменить `u.Password == model.Password` в
  [HomeController.cs:50](Lime_Editor/Lime_Editor/Controllers/HomeController.cs#L50) на хеш-проверку.
- Добавить `[Authorize]` на все защищённые экшены; убрать ручную проверку сессии `"AuthUser"`.
- **Авторизация по владельцу**: в `DeleteSite`, `UpdateSite`, `ChangeName`, `SavetoUser`
  проверять, что `Site.UserId == currentUserId` (закрыть IDOR). Брать userId из `User.Claims`,
  не из строки в сессии.
- Исправить потерю `ModelState` при ошибке входа: возвращать `View(model)`, а не
  `RedirectToAction` ([HomeController.cs:63](Lime_Editor/Lime_Editor/Controllers/HomeController.cs#L63)).
- Валидация загрузки файлов в `EditTemplates` (тип, размер, расширение, MIME, антипуть-обход).
- Включить antiforgery на всех POST, security-заголовки (CSP по возможности).

### Фаза 2. Архитектура и рефакторинг (пилон 4)
- Ввести **слои**: `Controllers → Services → Repositories → EF Core`.
  Папки/проекты: `Lime.Domain` (сущности), `Lime.Application` (сервисы, DTO, интерфейсы),
  `Lime.Infrastructure` (EF, репозитории, файловое хранилище), `Lime.Web` (контроллеры, views).
  Минимум — папки внутри одного проекта, лучше — отдельные проекты в solution.
- **Дедупликация экспорта**: `SaveRuby` / `SaveSublime` / `SaveCoomingSoon` в
  [TemplateController.cs](Lime_Editor/Lime_Editor/Controllers/TemplateController.cs) почти
  идентичны → вынести в `ITemplateExportService` с конфигом per-template
  (список папок css/js/images/fonts/vendor, правила `.Replace`). Описать шаблоны декларативно.
- **ZIP вместо папки на диске**: заменить запись в `MyDocuments\{user}-...` на генерацию
  `System.IO.Compression.ZipArchive` в память и отдачу `File(...)` пользователю
  (затрагивает `EditTemplatesPost`, `SaveRuby/Sublime/CoomingSoon`). Критично для облака.
- **Устойчивый `TemplateId`**: убрать `html.Substring(... +15, 1)` в
  [HomeController.cs:292](Lime_Editor/Lime_Editor/Controllers/HomeController.cs#L292) —
  передавать `templateId` явным полем формы/DTO.
- Устранить **N+1 и `.First()`-падения**: в
  [MySites](Lime_Editor/Lime_Editor/Controllers/HomeController.cs#L106-L117) заменить вложенные
  `db.Users.First` в цикле на один запрос с `Include`/`join`; использовать `FirstOrDefaultAsync`.
- Сделать все обращения к БД `async`.
- Ввести **DTO/ViewModel** вместо передачи EF-сущностей и сырого HTML через сессию.

### Фаза 3. Фичи SaaS (пилон 4)
- **Хостинг опубликованных сайтов**: роут `/{username}/{slug}` отдаёт сохранённый HTML;
  поля `IsPublished`, `Slug`, `PublishedAt` в `Site`. Снятие/публикация.
- **Медиа-менеджер**: загрузка с привязкой к пользователю, хранение в БД-метаданных + файл/blob,
  очистка осиротевших файлов.
- **Роли и админка**: роль Admin, CRUD шаблонов из БД (сейчас шаблоны захардкожены во Views),
  управление пользователями.
- **История версий сайта** (опционально) — таблица версий для отката.

### Фаза 4. Тесты и качество (пилон 2)
- Проект `Lime.Tests` (xUnit): unit-тесты сервисов (export, auth, ownership-проверки).
- **Integration-тесты** API/контроллеров через `WebApplicationFactory` + EF InMemory/Testcontainers.
- Валидация моделей (DataAnnotations / FluentValidation).
- Линтеры/анализаторы: `.editorconfig`, Roslyn analyzers, `dotnet format` в CI.
- Цель: тесты на критичный путь (auth, ownership, экспорт ZIP) обязательно.

### Фаза 5. DevOps / CI-CD / Docker (пилон 3)
- **EF Core миграции под PostgreSQL**: перевести database-first → code-first миграции
  (`dotnet ef migrations add Init` → `database update`), чтобы схема версионировалась в репо
  (сейчас контекст [LimeEditorContext.cs](Lime_Editor/Lime_Editor/Models/LimeEditorContext.cs)
  scaffold'нут вручную под SQL Server). Учесть отличия Npgsql: имена колонок/таблиц
  (PostgreSQL чувствителен к регистру → задать соглашение через `UseSnakeCaseNamingConvention`
  или явные `HasColumnName`), типы (`Cyrillic_General_CI_AS` collation → `ICU`/`C` collation в pg),
  `IDENTITY`/serial для ключей. Существующие данные перенести скриптом (pgloader или ручной seed).
- **Dockerfile** (multi-stage) + **docker-compose** (app + **postgres** + опц. seq/pgadmin)
  для локального запуска одной командой `docker compose up`.
- **GitHub Actions**: build → test → (lint) → docker build → push; отдельный job для миграций.
- Конфиг по окружениям (`appsettings.{Environment}.json` + env vars), health-checks (`/health`).
- **Serilog** структурированное логирование, опц. seq/console sink.
- Деплой-таргет на выбор (Azure App Service / контейнер в любом облаке) — описать в README.

### Фаза 6. Документация
- `README.md`: описание, стек, как запустить (docker-compose up), архитектурная схема.
- `docs/architecture.md`: слои, диаграмма, модель данных (ER).
- Для диплома: пояснительная записка с описанием решений безопасности и архитектуры.

---

---

## Часть 3. Деплой (с учётом ограничений из России)

### 3.1 Контекст и ограничения
- Международные облака (**Azure / AWS / GCP**) из РФ в 2026 практически недоступны: не принимают
  российские карты, часть регионов/сервисов геоблокирована, аккаунты замораживают. Старый
  Azure-аккаунт с БД, скорее всего, потерян — **переносим всё на доступную из РФ инфраструктуру**.
- Поэтому: провайдеры с оплатой российской картой и доступом без VPN — **Yandex Cloud, VK Cloud
  (Cloud.ru / SberCloud), Selectel, Timeweb Cloud, REG.RU, Beget**.
- БД мигрируем на **PostgreSQL** (см. Фазы 0/5) — он стандартно поддерживается всеми RU-облаками
  как managed-сервис, в отличие от SQL Server.

### 3.2 Что нужно в обоих случаях (общая часть)
- Приложение упаковано в Docker-образ (Фаза 5), конфиги через **переменные окружения**
  (строка подключения, секреты — НЕ в образе).
- Реестр образов: **GitHub Container Registry** (ghcr.io) или Yandex Container Registry —
  CI собирает и пушит образ.
- TLS: **Caddy** или **nginx + Let's Encrypt** как reverse-proxy перед приложением
  (Let's Encrypt из РФ работает).
- Бэкапы БД: `pg_dump` по расписанию (cron) → объектное хранилище (Yandex Object Storage /
  Selectel S3, S3-совместимое).
- Хранение медиа пользователей (Фаза 3): **S3-совместимое объектное хранилище** RU-провайдера
  (Yandex Object Storage / Selectel / VK Cloud) — не локальный диск контейнера, иначе данные
  теряются при пересоздании. Подключение через `AWSSDK.S3`/`Minio` к RU-эндпоинту.

### 3.3 Вариант A — VPS + docker-compose (рекомендуется как старт)
**Провайдеры**: Selectel / Timeweb Cloud / Beget / REG.RU VPS. Ориентир: 2 vCPU / 2–4 GB RAM,
~300–600 ₽/мес. Оплата российской картой, доступ из РФ без VPN.

**Схема**: один VPS, на нём `docker compose` поднимает: `app` (наш контейнер) +
`postgres` + `caddy`(TLS) [+ опц. `seq` для логов].

**Шаги**:
1. Завести VPS (Ubuntu 22.04), поставить Docker + Compose.
2. Прокинуть `compose.prod.yml` (app + postgres + caddy), секреты — в `.env` на сервере
   (не в git).
3. CI собирает образ → `docker compose pull && up -d` по SSH (через GitHub Actions
   `appleboy/ssh-action` или вручную на первом этапе).
4. Миграции EF применяются на старте контейнера (`Database.Migrate()`) или отдельным job.
5. Бэкап: cron `pg_dump` → S3-совместимое хранилище.
6. Домен → A-запись на IP VPS, Caddy сам выпускает Let's Encrypt сертификат.

**Плюсы**: дёшево, полный контроль, просто, всё в одном файле.
**Минусы**: ручное администрирование, резервирование/масштабирование на себе.

### 3.4 Вариант B — RU managed-облако
**Провайдеры**: Yandex Cloud (наиболее зрелый), VK Cloud, Cloud.ru.

**Схема**:
- БД: **Managed Service for PostgreSQL** (автобэкапы, отказоустойчивость, мониторинг).
- Приложение: **Serverless Containers** (Yandex) или **Managed Kubernetes** для масштаба;
  на старте достаточно Serverless Containers / Container Solution.
- Образ: **Yandex Container Registry**.
- Медиа: **Object Storage** (S3-совместимое).
- TLS/баланс: Application Load Balancer + сертификат в Certificate Manager.
- Логи/метрики: Cloud Logging + Monitoring.

**Плюсы**: managed-БД с бэкапами, меньше ручного администрирования, готовый мониторинг,
проще масштабировать.
**Минусы**: дороже (managed PG + ALB ощутимо дороже VPS), сложнее первичная настройка
(IAM, сети, terraform-желателен).

### 3.5 Рекомендация по этапности
1. **MVP/диплом** → Вариант A (VPS + compose): быстро, дёшево, демонстрируемо.
2. **Рост/прод** → миграция на Вариант B (managed PG + контейнеры) без изменения кода —
   меняется только строка подключения и место запуска образа (ради этого вся конфигурация
   уже через env vars).
3. IaC: на Варианте B описать инфраструктуру через **Terraform** (Yandex provider) — плюс для
   диплома и воспроизводимости.

---

## Критичные файлы (где будут изменения)
- `Lime_Editor/Lime_Editor.csproj` — таргет .NET 8, пакеты, nullable.
- [appsettings.json](Lime_Editor/Lime_Editor/appsettings.json) — убрать секреты.
- [Startup.cs](Lime_Editor/Lime_Editor/Startup.cs) — Identity, authZ, Serilog, health-checks, DI сервисов.
- [HomeController.cs](Lime_Editor/Lime_Editor/Controllers/HomeController.cs) — auth, ownership, async, ZIP, DTO.
- [TemplateController.cs](Lime_Editor/Lime_Editor/Controllers/TemplateController.cs) — дедуп экспорта в сервис, ZIP.
- [Models/](Lime_Editor/Lime_Editor/Models/) — `User` (хеш/Identity), `Site` (slug/publish), миграции.
- Новые: `Services/ITemplateExportService`, `Services/ISiteService`, репозитории, `Lime.Tests/`,
  `Dockerfile`, `docker-compose.yml` (dev) + `compose.prod.yml` (app+postgres+caddy),
  `Caddyfile`, `.github/workflows/ci.yml`, опц. `infra/` (Terraform для Варианта B), `README.md`.
- Смена БД: `Lime_Editor.csproj` (Npgsql вместо SqlServer), `Startup.cs` (`UseNpgsql`),
  `appsettings.json` (строка подключения PostgreSQL), новые EF-миграции.

## Порядок выполнения (рекомендованный)
Фаза 0 → 1 → 2 → 5 (Docker/CI рано, чтобы тестировать в контейнере) → 4 → 3 → 6.
Безопасность и секреты — самый высокий приоритет.

---

## Verification (как проверять на каждом этапе)
- **Сборка**: `dotnet build` (после .NET 8) без ошибок; `dotnet format --verify-no-changes`.
- **Тесты**: `dotnet test` — все зелёные; покрытие критичных сервисов.
- **Безопасность (ручная)**:
  - пароль в БД хранится как хеш (проверить запись после регистрации);
  - попытка удалить/изменить чужой сайт по чужому `idSite` → 403/404 (проверка ownership);
  - секреты отсутствуют в `git grep -i password`;
  - неавторизованный доступ к `/Home/MySites` → редирект на вход.
- **БД**: миграции применяются к чистой PostgreSQL без ошибок (`dotnet ef database update`);
  приложение стартует на `UseNpgsql` и читает/пишет данные.
- **Функционал E2E** (через `docker compose up` с postgres-контейнером):
  создать пользователя → создать сайт из шаблона → отредактировать → опубликовать →
  открыть `/{username}/{slug}` → скачать ZIP и проверить, что архив открывается с рабочими css/js/images.
- **CI**: green pipeline в GitHub Actions (build + test + docker build + push в ghcr/YCR).
- **Health**: `GET /health` → 200; логи Serilog пишутся структурно.
- **Деплой (Вариант A)**: на тестовом VPS `docker compose -f compose.prod.yml up -d` поднимает
  app+postgres+caddy, сайт открывается по домену с валидным TLS; `pg_dump`-бэкап выгружается в S3.

## Открытые вопросы для следующего шага
- Identity vs кастомный BCrypt — уточнить при старте реализации (рекомендация: Identity).
- Конкретный VPS-провайдер для Варианта A (Selectel / Timeweb / Beget) — выбрать при Фазе 5.
- S3-совместимое хранилище для медиа (Yandex Object Storage / Selectel) — выбрать при Фазе 3.
- Нужен ли Terraform/Вариант B сразу или после MVP — определить после первого деплоя.
