#!/bin/bash
set -e
cd "$(dirname "$0")"

fail() {
  echo
  echo "$1"
  read -r -p "Presiona Enter para cerrar esta ventana."
  exit 1
}

command -v python3 >/dev/null 2>&1 || fail "Instala Python 3.10 o posterior: https://www.python.org/downloads/macos/"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail "Se necesita Python 3.10 o posterior."
command -v node >/dev/null 2>&1 || fail "Instala Node.js 20.19 o posterior: https://nodejs.org/"
command -v npm >/dev/null 2>&1 || fail "No se encontro npm. Reinstala Node.js."
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19) ? 0 : 1)' || fail "Se necesita Node.js 20.19+ o 22.12+."

if [ ! -x .venv/bin/python ]; then
  echo "Preparando Python por primera vez..."
  python3 -m venv .venv || fail "No se pudo preparar Python."
fi

if ! .venv/bin/python -c 'import fastapi, uvicorn, cv2, numpy, pydantic' >/dev/null 2>&1; then
  echo "Instalando el servidor y el procesamiento de imagenes..."
  .venv/bin/python -m pip install -r backend/requirements.txt || fail "No se pudieron instalar las dependencias de Python."
fi

if [ ! -f node_modules/vite/bin/vite.js ]; then
  echo "Instalando la interfaz por primera vez..."
  npm ci || fail "No se pudieron instalar las dependencias de Node.js."
fi

API_LOG="${TMPDIR:-/tmp}/patronaje-pro-api.log"
WEB_LOG="${TMPDIR:-/tmp}/patronaje-pro-web.log"
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 >"$API_LOG" 2>&1 &
API_PID=$!
node_modules/.bin/vite --host 127.0.0.1 --strictPort >"$WEB_LOG" 2>&1 &
WEB_PID=$!

cleanup() {
  kill "$WEB_PID" "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for _ in $(seq 1 30); do
  if ! kill -0 "$API_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then
    cat "$API_LOG" "$WEB_LOG"
    fail "No se pudo iniciar Patronaje Pro. Revisa si los puertos 8000 o 5173 estan ocupados."
  fi
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && curl -fsS http://127.0.0.1:5173 >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  cat "$API_LOG" "$WEB_LOG"
  fail "Patronaje Pro no respondio a tiempo."
fi

open http://127.0.0.1:5173
echo "Patronaje Pro esta funcionando en este iMac."
echo "Deja esta ventana abierta. Presiona Ctrl+C para cerrar la aplicacion."
wait "$WEB_PID"
