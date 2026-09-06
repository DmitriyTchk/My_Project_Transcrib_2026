@echo off
chcp 65001 >nul
setlocal

echo ==========================================
echo  Запуск локального Whisper-сервера (GPU)
echo ==========================================

REM Проверка наличия Docker
where docker >nul 2>nul
if errorlevel 1 (
    echo [ОШИБКА] Docker не найден. Установите Docker Desktop с поддержкой WSL2.
    pause
    exit /b 1
)

REM Проверка: контейнер уже существует?
docker inspect faster-whisper-server >nul 2>nul
if not errorlevel 1 (
    echo Контейнер faster-whisper-server уже существует. Запускаем...
    docker start faster-whisper-server
    goto :done
)

echo Создание контейнера faster-whisper-server (модель large-v3)...
docker run -d ^
    --name faster-whisper-server ^
    --restart unless-stopped ^
    --gpus all ^
    -p 8000:8000 ^
    -e WHISPER__MODEL=large-v3 ^
    -e WHISPER__API_KEY=my-secret-token ^
    fedirz/faster-whisper-server:latest-cuda

if errorlevel 1 (
    echo [ОШИБКА] Не удалось запустить контейнер. Проверьте, что Docker Desktop запущен и доступен GPU (NVIDIA Container Toolkit).
    pause
    exit /b 1
)

:done
echo.
echo Whisper-сервер запущен: http://localhost:8000
echo API-ключ: my-secret-token
echo Первая загрузка модели large-v3 может занять несколько минут.
echo Логи: docker logs -f faster-whisper-server
pause
