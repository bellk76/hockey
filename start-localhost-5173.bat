@echo off
setlocal
cd /d "%~dp0"

rem Порт dev-сервера (должен совпадать со stop-localhost-5173.bat)
set "PORT=5173"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] npm не найден. Установите Node.js: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Устанавливаю зависимости ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [ОШИБКА] npm install не удался.
    pause
    exit /b 1
  )
)

echo Запускаю Hockey на http://localhost:%PORT%/ ...
start "Hockey dev" cmd /c "npm run dev -- --port %PORT% --strictPort"

timeout /t 4 /nobreak >nul
start "" "http://localhost:%PORT%/"

echo.
echo Сервер запущен в отдельном окне "Hockey dev".
echo Остановить: stop-localhost-5173.bat
endlocal
