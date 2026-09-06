@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo  VibeScribe Studio - локальный запуск
echo ==========================================

REM Проверка наличия Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Node.js не найден. Установите Node.js 20+ с https://nodejs.org/
    pause
    exit /b 1
)

REM Установка зависимостей при отсутствии node_modules
if not exist "node_modules" (
    echo [1/3] Установка зависимостей npm...
    call npm install
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось установить зависимости.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Зависимости уже установлены, пропуск.
)

REM Сборка при отсутствии dist или server.js
if not exist "dist\index.html" (
    echo [2/3] Сборка приложения...
    call npm run build
    if errorlevel 1 (
        echo [ОШИБКА] Сборка завершилась с ошибкой.
        pause
        exit /b 1
    )
) else if not exist "server.js" (
    echo [2/3] Сборка приложения...
    call npm run build
    if errorlevel 1 (
        echo [ОШИБКА] Сборка завершилась с ошибкой.
        pause
        exit /b 1
    )
) else (
    echo [2/3] Сборка уже выполнена, пропуск.
)

echo [3/3] Запуск сервера на http://localhost:3000 ...
set NODE_ENV=production
set PORT=3000
node server.js
pause
