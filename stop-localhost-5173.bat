@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Порт dev-сервера (должен совпадать со start-localhost-5173.bat)
set "PORT=5173"

echo Останавливаю dev-сервер Hockey ^(порт %PORT%^)...
set "KILLED="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
  echo   убиваю PID %%p
  taskkill /pid %%p /t /f >nul 2>nul
  set "KILLED=1"
)

if defined KILLED (
  echo Готово: сервер остановлен.
) else (
  echo Процесс на порту %PORT% не найден - сервер, похоже, не запущен.
)

endlocal
pause
