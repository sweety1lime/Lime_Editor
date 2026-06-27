# Lime

[![CI](https://github.com/sweety1lime/Lime_Editor/actions/workflows/ci.yml/badge.svg)](https://github.com/sweety1lime/Lime_Editor/actions/workflows/ci.yml)
![.NET](https://img.shields.io/badge/.NET-8.0-512BD4)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

Конструктор сайтов и лендингов без кода. Бэкенд на ASP.NET Core (MVC + Razor, server-rendered),
данные в PostgreSQL. Страница собирается в drag-and-drop редакторе и публикуется по своему адресу;
есть AI-помощник, который по описанию бизнеса набрасывает первый вариант из блоков.

## Что умеет

- Редактор блоков: страница хранится как JSON-документ, рендерер компилирует её в HTML при сохранении.
  Адаптив по брейкпоинтам (desktop / tablet / mobile), вложенные блоки, колонки, свободная раскладка.
- Генерация по описанию: пишешь пару предложений о проекте — собирается черновик лендинга прямо на холсте.
  Запрос идёт к LLM через OpenAI-совместимый провайдер, ключ хранится только на сервере.
- Шаблоны: набор готовых стартовых страниц, каждую можно править целиком.
- Публикация в один клик по адресу `/u/{user}/{slug}` плюс экспорт статики в ZIP.
- Менеджер медиа: загрузка картинок со сжатием и выбор прямо из редактора.
- Галерея сообщества с опубликованными сайтами.
- Блоки-формы: заявки складываются в инбокс.
- Аккаунты и роли на ASP.NET Identity, личный кабинет, админка.

## Стек

| Слой | Технологии |
|---|---|
| Backend | ASP.NET Core 8 (MVC, Razor), C# |
| Данные | PostgreSQL + EF Core (миграции), ASP.NET Identity |
| Frontend | server-rendered Razor, ванильный JS, CSS-переменные (тёмная тема) |
| LLM | OpenAI-совместимый провайдер (VseGPT / ProxyAPI / OpenRouter и т.п.) |
| Инфра | Docker, docker-compose, Caddy (reverse-proxy + TLS), GitHub Actions |
| Тесты | xUnit (integration + unit), Playwright (UI) |

## Запуск

Нужны .NET 8 SDK и PostgreSQL (или Docker).

```bash
git clone https://github.com/sweety1lime/Lime_Editor.git
cd Lime_Editor

# строку подключения и (опционально) ключ LLM задай через env / user-secrets — см. SETUP.md
dotnet restore Lime_Editor.sln
dotnet ef database update --project Lime_Editor
dotnet run --project Lime_Editor
```

Приложение поднимется на `http://localhost:8000`.

### Docker

```bash
cp .env.example .env   # заполни значения
docker compose up --build
```

Настройка окружения (БД, ключи, секреты) описана в [SETUP.md](SETUP.md).

## Структура

```
Lime_Editor/            # приложение (MVC)
  Controllers/          # Home, Template, Ai, Media, Community, Form, Admin, PublishedSite
  Models/               # доменные модели + EF-контекст
  Services/             # рендер документов, провайдер LLM, сборка publish-HTML
  Views/                # Razor (Home, Shared/_Lime*, Template, ...)
  Migrations/           # EF Core миграции
  wwwroot/css/lime/     # дизайн-система (tokens / base / components / pages / constructor)
  wwwroot/js/lime/      # движок конструктора (lime-doc*) + поведение UI
Lime.Tests/             # integration + unit тесты
tests/                  # Playwright UI-тесты
```

## Тесты

```bash
dotnet test Lime_Editor.sln          # backend
npm install && npx playwright test   # UI (см. playwright.config.ts)
npm run test:e2e:editor-v2           # быстрый Chromium-прогон редактора
```

## Лицензия

[MIT](LICENSE) © sweety1lime
