#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# PixelOffice — one-click local launcher (Docker).
#
#   ./start-office.sh           build the image + (re)start the office, open it
#   ./start-office.sh stop      stop & remove the running office container
#   ./start-office.sh logs      follow the office logs
#   ./start-office.sh --full    full stack (app + Postgres + Redis) via compose
#   ./start-office.sh restart   stop then start again
#
# The default runs the self-contained single container (in-memory, zero-config):
# the server + the built client are served together on http://localhost:2567.
# Drop an .env file next to this script to configure anything (OFFICE_SUBNETS,
# SSID_FLOOR_MAP, FLOOR_SYNC_SECRET, GOOGLE_CLIENT_ID, AUTH_REQUIRED, ...);
# it is passed straight into the container when present.
# ---------------------------------------------------------------------------
set -euo pipefail

IMAGE="pixeloffice:latest"
NAME="pixeloffice"
PORT="2567"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

c_green=$'\033[32m'; c_blue=$'\033[34m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_reset=$'\033[0m'
say()  { printf '%s\n' "${c_blue}▸ $*${c_reset}"; }
ok()   { printf '%s\n' "${c_green}✓ $*${c_reset}"; }
warn() { printf '%s\n' "${c_yellow}! $*${c_reset}"; }
die()  { printf '%s\n' "${c_red}✗ $*${c_reset}" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "Docker is not installed or not on PATH."
docker info >/dev/null 2>&1 || die "Docker daemon is not running. Start Docker and retry."

# LAN IP so teammates / other floors can connect from their own machines.
lan_ip() { hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1; }

open_browser() {
  local url="$1"
  ( command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 ) \
    || ( command -v open  >/dev/null 2>&1 && open "$url" >/dev/null 2>&1 ) \
    || true
}

wait_healthy() {
  say "Waiting for the office to come up…"
  for _ in $(seq 1 60); do
    if curl -fs -m 2 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

cmd="${1:-start}"

case "$cmd" in
  stop)
    say "Stopping the office…"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker compose --profile app down >/dev/null 2>&1 || true
    ok "Stopped."
    exit 0
    ;;

  logs)
    exec docker logs -f "$NAME"
    ;;

  --full|full)
    say "Starting FULL stack (app + Postgres + Redis) via docker compose…"
    docker rm -f "$NAME" >/dev/null 2>&1 || true   # avoid port clash with the single container
    docker compose --profile app up --build -d
    wait_healthy && ok "Full stack up." || die "Health check timed out — see: docker compose --profile app logs"
    ;;

  restart)
    "$0" stop || true
    exec "$0" start
    ;;

  start)
    say "Building the PixelOffice image (first run takes a minute)…"
    docker build -t "$IMAGE" . || die "Image build failed."
    say "(Re)starting the office container…"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    # If our canonical port is busy (e.g. a dev/verification server is running),
    # walk up to the next free host port instead of failing.
    while ss -tln 2>/dev/null | grep -q ":${PORT} "; do
      warn "Port ${PORT} is busy — trying $((PORT+1))…"
      PORT=$((PORT+1))
    done
    envfile_arg=()
    if [[ -f "$HERE/.env" ]]; then envfile_arg=(--env-file "$HERE/.env"); warn "Using .env"; fi
    # Map the chosen host port -> the container's internal 2567. The client is
    # served same-origin, so the browser connects back on the same host port.
    docker run -d --name "$NAME" --restart unless-stopped \
      -p "${PORT}:2567" "${envfile_arg[@]}" "$IMAGE" >/dev/null
    wait_healthy || die "Health check timed out — see: ./start-office.sh logs"
    ;;

  *)
    die "Unknown command '$cmd'. Use: start | stop | logs | restart | --full"
    ;;
esac

ip="$(lan_ip || true)"
echo
ok "PixelOffice is running 🏢"
echo "   • This machine:  http://localhost:${PORT}"
[[ -n "$ip" ]] && echo "   • Same network:  http://${ip}:${PORT}   (share with teammates / other floors)"
echo "   • Stop:          ./start-office.sh stop"
echo "   • Logs:          ./start-office.sh logs"
echo
open_browser "http://localhost:${PORT}"
