#!/bin/sh
# Демон бэкапа: первый прогон сразу (можно отключить BACKUP_ON_START=false),
# далее раз в BACKUP_INTERVAL секунд (по умолчанию сутки). Без cron — простой sleep-цикл,
# переживает рестарт контейнера (restart: unless-stopped).
set -eu

INTERVAL="${BACKUP_INTERVAL:-86400}"
export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD не задан}"

echo "[backup] старт демона. интервал=${INTERVAL}s, retention=${BACKUP_RETENTION_DAYS:-14}d"

if [ "${BACKUP_ON_START:-true}" = "true" ]; then
  sh /scripts/backup.sh || echo "[backup] стартовый прогон упал — продолжаю по расписанию"
fi

while true; do
  sleep "${INTERVAL}"
  sh /scripts/backup.sh || echo "[backup] прогон упал — повтор по расписанию"
done
