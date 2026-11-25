#!/usr/bin/env bash
# Start (or rebuild) Z PM on Lightsail. Run from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f server/.env ]]; then
  echo "Missing server/.env"
  echo "Copy server/.env.example to server/.env and set OPENAI_API_KEY (and optionally POSTGRES_PASSWORD)."
  exit 1
fi

if ! grep -qE '^OPENAI_API_KEY=.+' server/.env; then
  echo "server/.env has no OPENAI_API_KEY value. Chat and meeting drafts will fail until you set one."
fi

if ! grep -qE '^POSTGRES_PASSWORD=.+' server/.env; then
  echo "Tip: set POSTGRES_PASSWORD in server/.env before the first start so the DB is not left on the demo password."
fi

docker compose \
  --env-file server/.env \
  -f docker-compose.yml \
  -f docker-compose.lightsail.yml \
  up -d --build

IP="$(curl -s --max-time 2 ifconfig.me 2>/dev/null || true)"
echo
echo "Z PM is up."
if [[ -n "${IP}" ]]; then
  echo "Open http://${IP}/"
else
  echo "Open http://YOUR_LIGHTSAIL_IP/"
fi
echo "Logs: docker compose --env-file server/.env -f docker-compose.yml -f docker-compose.lightsail.yml logs -f app"
