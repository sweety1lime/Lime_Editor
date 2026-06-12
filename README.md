# Lime · конструктор сайтов без кода

[![CI](https://github.com/sweety1lime/Lime_Editor/actions/workflows/ci.yml/badge.svg)](https://github.com/sweety1lime/Lime_Editor/actions/workflows/ci.yml)
![.NET](https://img.shields.io/badge/.NET-8.0-512BD4)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

**Lime** — SaaS-конструктор лендингов и сайтов без кода на ASP.NET Core (MVC + Razor, server-rendered).
Опиши идею словами — AI соберёт первый вариант, дальше правишь блоки в drag-and-drop редакторе и публикуешь в один клик.

> Сигнатурный стиль — lime-зелёный по «чернильному» тёмному фону. «No code. Just creativity.»

<!-- TODO: добавь скриншоты в docs/screenshots/ и раскомментируй -->
<!--
![Лендинг](docs/screenshots/landing.png)
![AI-конструктор](docs/screenshots/constructor.png)
![Дашборд](docs/screenshots/dashboard.png)
-->

## Возможности

- 🧱 **Drag-and-drop конструктор** — JSON-движок (Track B): страница хранится как документ, рендерер компилирует её в HTML (compile-on-save). Адаптив по брейкпоинтам (desktop / tablet / mobile), вложенные блоки и колонки.
- ✨ **AI-генерация** — описываешь бизнес, модель собирает лендинг из блоков прямо на холсте (skeleton → материализация → готово). Через OpenAI-совместимый агрегатор; ключ только на сервере.
- 🎨 **Шаблоны** — галерея готовых стартовых точек, каждый полностью редактируется.
- 🚀 **Публикация в один клик** — сайт живёт по адресу `/u/{user}/{slug}`; есть экспорт в ZIP.
- 🖼 **Медиа-менеджер** — загрузка изображений со сжатием, выбор из конструктора.
- 🌐 **Сообщество** — галерея опубликованных сайтов.
- 📨 **Формы и заявки** — блоки-формы собирают лиды в инбокс.
- 👤 **Аккаунты и роли** — ASP.NET Identity, личный кабинет, админка.

## Стек

| Слой | Технологии |
|---|---|
| Backend | ASP.NET Core 8 (MVC, Razor), C# |
| Данные | PostgreSQL + EF Core (миграции), ASP.NET Identity |
| Frontend | server-rendered Razor, ванильный JS, CSS-переменные (тёмная lime-тема) |
| AI | OpenAI-совместимый провайдер (VseGPT / ProxyAPI / OpenRouter и т.п.) |
| Инфра | Docker, docker-compose, Caddy (reverse-proxy + TLS), GitHub Actions CI |
| Тесты | xUnit (integration + unit), Playwright (UI) |

## Быстрый старт

Нужны **.NET 8 SDK** и **PostgreSQL** (или Docker).

```bash
git clone https://github.com/sweety1lime/Lime_Editor.git
cd Lime_Editor

# строка подключения и (опц.) AI-ключ — через env / user-secrets, см. SETUP.md
dotnet restore Lime_Editor.sln
dotnet ef database update --project Lime_Editor
dotnet run --project Lime_Editor
```

Приложение поднимется на `http://localhost:8000`.

### Через Docker

```bash
cp .env.example .env   # заполни значения
docker compose up --build
```

Подробная настройка окружения (БД, AI, секреты) — в [SETUP.md](SETUP.md).

## Структура

```
Lime_Editor/            # основное приложение (MVC)
  Controllers/          # Home, Template, Ai, Media, Community, Form, Admin, PublishedSite
  Models/               # доменные модели + EF-контекст
  Services/             # рендер документов, AI-провайдер, сборка publish-HTML
  Views/                # Razor (Home, Shared/_Lime*, Template, ...)
  Migrations/           # EF Core миграции
  wwwroot/css/lime/     # дизайн-система (tokens / base / components / pages / constructor)
  wwwroot/js/lime/      # движок конструктора (lime-doc*) + UI-поведение
Lime.Tests/             # integration + unit тесты
tests/                  # Playwright UI-тесты
docs/ROADMAP.md         # план развития
```

## Тесты

```bash
dotnet test Lime_Editor.sln       # backend
npm install && npx playwright test # UI (см. playwright.config.ts)
```

## Роадмап

План развития — в [docs/ROADMAP.md](docs/ROADMAP.md).

## Лицензия

[MIT](LICENSE) © sweety1lime
