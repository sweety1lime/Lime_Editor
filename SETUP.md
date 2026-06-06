# Lime_Editor — инструкция по настройке окружения

Документ для разворачивания проекта на новой машине (ПК / ноутбук) и работы над ним с
нескольких компьютеров. Проект — веб-конструктор сайтов на **ASP.NET Core (.NET 8) + PostgreSQL**,
основная IDE — **VS Code** с C# Dev Kit.

> Синхронизация между машинами — через GitHub: `https://github.com/sweety1lime/Lime_Editor.git`.
> Всё, что в этом файле, должно работать одинаково и на ПК, и на ноутбуке.

---

## 1. Что нужно установить (Windows)

Все команды — в **PowerShell**. Менеджер пакетов `winget` есть в Windows 10/11 из коробки.

| Компонент | Зачем | Команда установки |
|-----------|-------|-------------------|
| **Git** | контроль версий | `winget install --id Git.Git --silent` |
| **.NET 8 SDK** | сборка/запуск проекта | `winget install --id Microsoft.DotNet.SDK.8 --silent --accept-package-agreements --accept-source-agreements` |
| **PostgreSQL 16** | база данных | `winget install --id PostgreSQL.PostgreSQL.16 --silent --accept-package-agreements --accept-source-agreements` |
| **Node.js LTS** | фронтенд-тулинг (позже) | `winget install --id OpenJS.NodeJS.LTS --silent` |
| **VS Code** | IDE | `winget install --id Microsoft.VisualStudioCode --silent` |

После установки .NET **перезапусти терминал** (обновится `PATH`), затем поставь инструмент миграций
и доверь dev-сертификат HTTPS:

```powershell
dotnet tool install --global dotnet-ef --version 8.*
dotnet dev-certs https --trust
```

Проверка, что всё встало:

```powershell
dotnet --version      # ожидается 8.0.x
dotnet ef --version   # ожидается 8.0.x
git --version
node --version
```

### Расширения VS Code
Обязательные (C# Dev Kit ставит остальное автоматически):

```powershell
code --install-extension ms-dotnettools.csdevkit
code --install-extension ms-dotnettools.csharp
```

---

## 2. Настройка PostgreSQL

### 2.1 Узнать порт ⚠️
По умолчанию PostgreSQL слушает **5432**, но если на машине уже стоит другая версия Postgres,
установщик возьмёт **5433** (так на ноутбуке). Узнать реальный порт:

```powershell
Get-Content "C:\Program Files\PostgreSQL\16\data\postgresql.conf" | Select-String "^port"
```

> На **ноутбуке** порт = **5433** (т.к. рядом стоит PostgreSQL 15).
> На **чистом ПК** скорее всего будет **5432**. Запомни свой порт — он пойдёт в строку подключения.

### 2.2 Задать пароль суперпользователя (если он пустой/неизвестен)
Silent-установка через winget оставляет пароль `postgres` пустым. Если `psql` не пускает —
сбрось пароль (выполнять в PowerShell **от администратора**, подставь свой порт):

```powershell
$data = "C:\Program Files\PostgreSQL\16\data"
$psql = "C:\Program Files\PostgreSQL\16\bin\psql.exe"
$port = 5432   # <-- ВАШ порт

# временно разрешить вход без пароля
Copy-Item "$data\pg_hba.conf" "$data\pg_hba.conf.bak" -Force
(Get-Content "$data\pg_hba.conf") -replace '^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)scram-sha-256','${1}trust' |
  Set-Content "$data\pg_hba.conf" -Encoding ascii
Restart-Service postgresql-x64-16 -Force

# задать пароль
$env:PGPASSWORD=""
& $psql -U postgres -h 127.0.0.1 -p $port -c "ALTER USER postgres PASSWORD 'postgres';"

# вернуть защиту
Move-Item "$data\pg_hba.conf.bak" "$data\pg_hba.conf" -Force
Restart-Service postgresql-x64-16 -Force
```

### 2.3 Создать базу данных

```powershell
$env:PGPASSWORD = "postgres"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 `
  -c "CREATE DATABASE limeeditor;"
```

> Если IPv6 (`::1`) даёт `Permission denied 10013` — используй явно `-h 127.0.0.1` (IPv4).

---

## 3. Строка подключения (секреты — НЕ в git!)

`appsettings.json` сейчас **коммитится** в репозиторий, поэтому пароль БД туда писать **нельзя**.
У каждой машины свой порт/пароль, поэтому храним строку подключения в **User Secrets**
(локально, вне git):

```powershell
# из папки с .csproj (Lime_Editor\Lime_Editor)
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:connect" "Host=127.0.0.1;Port=5432;Database=limeeditor;Username=postgres;Password=postgres"
```

> Подставь свой порт (5432 или 5433). В `appsettings.json` оставляем только плейсхолдер без пароля.
> User Secrets лежат в `%APPDATA%\Microsoft\UserSecrets\` — на каждой машине настраиваются отдельно.

---

## 4. Клонирование и запуск

```powershell
git clone https://github.com/sweety1lime/Lime_Editor.git
cd Lime_Editor\Lime_Editor

dotnet restore
dotnet ef database update   # применить миграции (после перехода на code-first)
dotnet run                  # запуск; адрес будет в консоли (https://localhost:xxxx)
```

В VS Code: открыть папку репозитория, дождаться загрузки C# Dev Kit, `F5` — запуск с отладкой.

---

## 5. Работа на двух машинах (ПК ↔ ноутбук)

Синхронизация через GitHub. Простое правило: **начинаешь работу — `pull`, закончил — `commit` + `push`.**

```powershell
# в начале сессии на любой машине
git pull

# в конце сессии
git add -A
git commit -m "что сделал"
git push
```

**Что НЕ должно попадать в git** (у каждой машины своё):
- строка подключения с паролем → только в User Secrets (см. §3);
- `bin/`, `obj/`, `.vs/` → уже в `.gitignore`;
- локальные данные PostgreSQL.

**Если работаешь над разными задачами параллельно** — заводи ветки, чтобы не ловить конфликты:
```powershell
git checkout -b feature/название
# ... работа, коммиты ...
git push -u origin feature/название
```

> На каждой новой машине пункты 1–3 (установка SDK/Postgres, пароль, User Secrets) делаются
> **один раз**. Дальше — только `git pull` / `push`.

---

## 6. Отложено: Docker

Docker Desktop пока не ставим (нужен WSL2 + виртуализация в BIOS). Он понадобится на этапе
деплоя — инструкция по нему будет добавлена отдельно. Для локальной разработки достаточно
нативного PostgreSQL из §2.

---

## 7. Шпаргалка проверки окружения

```powershell
dotnet --info                                   # SDK 8.0.x
dotnet ef --version                             # 8.0.x
Get-Service postgresql-x64-16 | Select Status   # Running
# проверка подключения (подставь порт):
$env:PGPASSWORD="postgres"; & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d limeeditor -c "SELECT version();"
```

Полный план модернизации проекта — см. отдельный файл плана (или попроси Claude показать его).
