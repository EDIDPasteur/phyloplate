#!/usr/bin/env bash
# Serve the viewer locally.  ES modules need http(s), so file:// will not work.
set -u
cd "$(dirname "$0")"

PORT="${1:-8000}"

busy() { python3 -c "
import socket,sys
s=socket.socket()
try:
    s.bind(('127.0.0.1', $1)); sys.exit(1)
except OSError:
    sys.exit(0)
finally:
    s.close()
"; }

if busy "$PORT"; then
  if [ $# -gt 0 ]; then
    echo "Port $PORT is already in use. Free it, or pass a different port." >&2
    echo "  what is holding it:  ss -ltnp | grep :$PORT" >&2
    exit 1
  fi
  echo "Port $PORT is in use, looking for a free one..." >&2
  for p in $(seq 8001 8020); do
    if ! busy "$p"; then PORT="$p"; break; fi
  done
  if busy "$PORT"; then
    echo "No free port between 8000 and 8020." >&2
    exit 1
  fi
fi

echo
echo "  PhyloPlate  ->  http://localhost:$PORT"
echo "  demo model  ->  http://localhost:$PORT/?demo=1"
echo "  (Ctrl-C to stop)"
echo

# exec: this script becomes the server process itself, so it can never outlive
# whatever started it (terminal, tmux, agent tool session) — Ctrl-C or kill on
# the script always kills the server.  A backgrounded child does not: when this
# script is launched with SIGINT already ignored (tool/nohup/script chains),
# the trap and Python's own SIGINT handling are both no-ops and the server
# survives Ctrl-C — that was the stuck-on-8000 bug.
exec python3 -m http.server "$PORT" --bind 127.0.0.1
