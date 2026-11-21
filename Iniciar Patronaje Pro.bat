@echo off
setlocal
cd /d "%~dp0"

set "PYTHON="
where py >nul 2>nul
if not errorlevel 1 set "PYTHON=py -3"
if not defined PYTHON (
  where python >nul 2>nul
  if not errorlevel 1 set "PYTHON=python"
)
if not defined PYTHON (
  echo Instala Python 3.10 o posterior y vuelve a abrir este archivo.
  echo https://www.python.org/downloads/
  pause
  exit /b 1
)

where node >nul 2>nul || (
  echo Instala Node.js 20.19 o posterior y vuelve a abrir este archivo.
  echo https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>nul || (
  echo No se encontro npm. Reinstala Node.js y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Preparando Python por primera vez...
  %PYTHON% -m venv .venv || goto error
)

".venv\Scripts\python.exe" -c "import fastapi, uvicorn, cv2, numpy, pydantic" >nul 2>nul
if errorlevel 1 (
  echo Instalando el servidor y el procesamiento de imagenes...
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt || goto error
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Instalando la interfaz por primera vez...
  call npm ci || goto error
)

start "Patronaje Pro - API" cmd /k "cd /d ""%~dp0"" && ""%~dp0.venv\Scripts\python.exe"" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
start "Patronaje Pro - Interfaz" cmd /k "cd /d ""%~dp0"" && npm run dev -- --host 127.0.0.1"
echo.
echo Patronaje Pro se esta iniciando en este equipo.
echo Deja abiertas las dos ventanas negras mientras uses la aplicacion.
timeout /t 8 /nobreak >nul
start "" http://127.0.0.1:5173
exit /b 0

:error
echo.
echo No se pudo preparar Patronaje Pro. Revisa el mensaje anterior y vuelve a intentarlo.
pause
exit /b 1
