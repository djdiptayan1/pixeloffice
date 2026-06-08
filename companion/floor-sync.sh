#!/usr/bin/env sh
# Convenience wrapper for the PixelOffice floor-sync companion (Linux/macOS).
# Honors all FLOOR_SYNC_* env vars; just runs the Node script next to it.
#
#   FLOOR_SYNC_SERVER=http://<office-server>:2567 ./floor-sync.sh
#
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$DIR/floor-sync.mjs" "$@"
