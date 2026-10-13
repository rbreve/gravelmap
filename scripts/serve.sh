#!/usr/bin/env bash
# Serve the prototype with HTTP range support (needed for .pmtiles).
# Use --lan to expose it on your Wi-Fi so you can open it on your phone.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST=127.0.0.1
if [[ "${1:-}" == "--lan" ]]; then
  HOST=0.0.0.0
  echo "On your phone open: http://$(ipconfig getifaddr en0):8765"
fi
exec npx --yes http-server "$ROOT/prototype" -a "$HOST" -p 8765 -c-1 --cors
