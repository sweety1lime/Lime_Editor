#!/bin/sh
# Один цикл бэкапа: дамп Postgres (custom format) + архив пользовательских медиа + чистка старых.
# Запускается из entrypoint.sh по расписанию. Пароль БД берётся из PGPASSWORD (выставляет entrypoint).
set -eu

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

DB_DUMP="${BACKUP_DIR}/db/limeeditor-${STAMP}.dump"
MEDIA_TAR="${BACKUP_DIR}/media/media-${STAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}/db" "${BACKUP_DIR}/media"

echo "[backup ${STAMP}] pg_dump -> ${DB_DUMP}"
# -Fc: custom format (сжатый, восстанавливается через pg_restore). Версия pg_dump = версии сервера (postgres:16).
pg_dump -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" \
        -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-limeeditor}" \
        -Fc -f "${DB_DUMP}"

MEDIA_SRC="${MEDIA_SRC:-/media}"
if [ -d "${MEDIA_SRC}" ] && [ -n "$(ls -A "${MEDIA_SRC}" 2>/dev/null || true)" ]; then
  echo "[backup ${STAMP}] media -> ${MEDIA_TAR}"
  tar -czf "${MEDIA_TAR}" -C "${MEDIA_SRC}" .
else
  echo "[backup ${STAMP}] media: том пуст или не смонтирован — пропускаю"
fi

echo "[backup ${STAMP}] retention: удаляю дампы старше ${RETENTION_DAYS} дней"
find "${BACKUP_DIR}/db" -type f -name '*.dump' -mtime "+${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}/media" -type f -name '*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup ${STAMP}] готово. Последние дампы БД:"
ls -1sh "${BACKUP_DIR}/db" | tail -n 5
