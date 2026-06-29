# Восстановление из бэкапа

Бэкап-сайдкар (`backup` в `compose.prod.yml`) раз в сутки кладёт в volume `backups_data`:

- `db/limeeditor-YYYYMMDD-HHMMSS.dump` — дамп Postgres в custom-формате (`pg_dump -Fc`).
- `media/media-YYYYMMDD-HHMMSS.tar.gz` — архив пользовательских медиа (том `media_data`).

Retention — `BACKUP_RETENTION_DAYS` (по умолчанию 14 дней). Интервал — `BACKUP_INTERVAL` (сек, по умолчанию 86400).

## Где лежат файлы

```sh
# Список дампов внутри volume
docker compose -f compose.prod.yml exec backup ls -1sh /backups/db /backups/media

# Скопировать дамп на хост (для off-site/проверки)
docker compose -f compose.prod.yml cp backup:/backups/db/limeeditor-YYYYMMDD-HHMMSS.dump ./
```

## Восстановление БД

> ⚠️ `pg_restore --clean` дропает и пересоздаёт объекты в целевой БД. Выполнять только на staging
> или при осознанном откате прода. Перед этим лучше снять свежий дамп текущего состояния.

```sh
# 1. Остановить приложение, чтобы не писало во время восстановления (postgres оставить).
docker compose -f compose.prod.yml stop app

# 2. Восстановить дамп в существующую БД (--clean пересоздаёт объекты, --if-exists без ошибок на отсутствующих).
docker compose -f compose.prod.yml exec -T postgres \
  pg_restore --clean --if-exists --no-owner -U postgres -d limeeditor \
  < ./limeeditor-YYYYMMDD-HHMMSS.dump

# 3. Поднять приложение.
docker compose -f compose.prod.yml start app
```

Полностью чистое восстановление (новая БД):

```sh
docker compose -f compose.prod.yml exec postgres dropdb -U postgres limeeditor
docker compose -f compose.prod.yml exec postgres createdb -U postgres limeeditor
docker compose -f compose.prod.yml exec -T postgres \
  pg_restore --no-owner -U postgres -d limeeditor < ./limeeditor-YYYYMMDD-HHMMSS.dump
```

## Восстановление медиа

```sh
# Распаковать архив в том media_data (через временный контейнер, смонтировав том в /media).
docker run --rm -i \
  -v lime_editor_media_data:/media \
  -v "$PWD":/restore alpine \
  sh -c "cd /media && tar -xzf /restore/media-YYYYMMDD-HHMMSS.tar.gz"
```

> Имя тома (`lime_editor_media_data`) зависит от имени проекта compose — проверь `docker volume ls`.

## Проверка восстановления (раз в квартал)

1. Поднять отдельный staging-compose (другой проект: `-p lime_staging`).
2. Восстановить последний дамп БД и архив медиа по инструкции выше.
3. Открыть приложение, залогиниться, проверить что сайты/медиа на месте.
4. Зафиксировать дату успешной проверки.

## Off-site (нужна внешняя инфра)

Volume `backups_data` живёт на том же хосте — при потере сервера бэкапы пропадут вместе с ним.
Для настоящей сохранности синхронизировать его off-site (вне этого репозитория, т.к. нужен аккаунт):

```sh
# Пример: rclone в S3/R2-совместимый бакет по cron на хосте.
rclone sync /var/lib/docker/volumes/lime_editor_backups_data/_data remote:lime-backups
```
