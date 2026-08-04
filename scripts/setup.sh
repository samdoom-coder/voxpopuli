#!/usr/bin/env bash
# Sets up backend + frontend dependencies. Tries a venv first, falls back to
# the system Python when venv/ensurepip is unavailable (common on Colab/Docker).
set -e
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
if "$PY" -m venv backend/.venv 2>/dev/null && backend/.venv/bin/pip --version >/dev/null 2>&1; then
  echo "[backend] using venv backend/.venv"
  backend/.venv/bin/pip install --quiet --upgrade pip
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
  echo "[backend] dependencies installed"
else
  echo "[backend] venv unavailable, installing with system $PY"
  "$PY" -m pip install --quiet -r backend/requirements.txt
  echo "[backend] dependencies installed (system)"
fi

echo "[frontend] npm install"
cd frontend && npm install --no-fund --no-audit >/dev/null
echo "[frontend] done"
echo ""
echo "Start everything with: npm run dev"
