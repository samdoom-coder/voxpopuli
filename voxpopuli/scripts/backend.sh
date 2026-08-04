#!/usr/bin/env bash
# Starts the backend. Prefers the system Python in this environment because the
# local virtualenv currently crashes under uvicorn. Set VOXPOPULI_USE_VENV=1 to
# force the project venv instead.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${VOXPOPULI_USE_VENV:-0}" = "1" ] && [ -x "backend/.venv/bin/python" ]; then
  PY="backend/.venv/bin/python"
else
  PY="python3"
fi

exec "$PY" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "${PORT:-8787}" "$@"
