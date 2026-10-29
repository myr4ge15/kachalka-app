#!/usr/bin/env bash
# Загрузка source maps сборки в Sentry (читаемый стек ошибок, lib/errorReport.js).
# Запускается в CI сразу после `npm run build` с SENTRY_SOURCEMAPS=1. Нужно в окружении:
#   SENTRY_AUTH_TOKEN  — токен организации Sentry (секрет Actions);
#   APP_BASE           — база сайта: /kachalka-app/ у прода, / у беты (как VITE_APP_BASE).
# Релиз = версия из dist/version.json — ровно то, что клиент шлет в `release` (__APP_VERSION__).
# Файлы .map на сайт не публикуются: их удаляет отдельный шаг workflow после этого скрипта.
set -euo pipefail

: "${SENTRY_AUTH_TOKEN:?нет SENTRY_AUTH_TOKEN}"
export SENTRY_URL="${SENTRY_URL:-https://de.sentry.io}"
export SENTRY_ORG="${SENTRY_ORG:-kachalka}"
export SENTRY_PROJECT="${SENTRY_PROJECT:-kachalka-app}"

base="${APP_BASE:-/}"
base="${base%/}"
release="$(node -p "require('./dist/version.json').version")"

# Адрес в кадре стека — https://<хост><база>/assets/<файл>.js; «~» = любой хост.
npx --yes @sentry/cli@3.8.1 sourcemaps upload \
  --release "$release" \
  --url-prefix "~${base}/assets" \
  dist/assets

echo "Source maps релиза ${release} загружены в Sentry."
