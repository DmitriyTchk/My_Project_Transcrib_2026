# ============================================================
# ngrok-share.ps1 — публикация публичного адреса ngrok-туннеля
#
# Что делает скрипт:
#   1. Читает опциональный конфиг .env из папки скрипта.
#   2. Проверяет, запущен ли ngrok (локальный API на 127.0.0.1:4040);
#      если нет — запускает: ngrok http $NGROK_PORT.
#   3. Получает публичный URL туннеля (предпочтительно https).
#   4. ВСЕГДА сохраняет адрес в файл на рабочем столе
#      (VibeScribe-адрес.txt) и выводит в консоль.
#   5. Опционально отправляет уведомление в Telegram и/или по email.
#   6. Далее работает в цикле: каждые 60 секунд проверяет,
#      не сменился ли URL (у ngrok free адрес может пересоздаваться),
#      и при смене повторяет шаги 3-5. Выход — Ctrl+C.
# ============================================================

$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- Шаг 1. Чтение .env (простой парсер KEY=VALUE, строки с # игнорируются) ---
$config = @{}
$envFile = Join-Path $ScriptDir '.env'
if (Test-Path $envFile) {
    Get-Content $envFile -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { return }
        $eq = $line.IndexOf('=')
        if ($eq -gt 0) {
            $key = $line.Substring(0, $eq).Trim()
            $value = $line.Substring($eq + 1).Trim().Trim('"').Trim("'")
            $config[$key] = $value
        }
    }
    Write-Host "Конфиг загружен из $envFile"
} else {
    Write-Host "Файл .env не найден — используются значения по умолчанию (уведомления выключены)."
}

function Get-ConfigValue([string]$key, [string]$default = '') {
    if ($config.ContainsKey($key) -and $config[$key] -ne '') { return $config[$key] }
    return $default
}

$TELEGRAM_BOT_TOKEN = Get-ConfigValue 'TELEGRAM_BOT_TOKEN'
$TELEGRAM_CHAT_ID   = Get-ConfigValue 'TELEGRAM_CHAT_ID'
$SMTP_HOST = Get-ConfigValue 'SMTP_HOST'
$SMTP_PORT = [int](Get-ConfigValue 'SMTP_PORT' '587')
$SMTP_USER = Get-ConfigValue 'SMTP_USER'
$SMTP_PASS = Get-ConfigValue 'SMTP_PASS'
$SMTP_TO   = Get-ConfigValue 'SMTP_TO'
$NGROK_PORT = Get-ConfigValue 'NGROK_PORT' '8000'

# --- Получение публичного URL из локального API ngrok ---
function Get-NgrokPublicUrl {
    try {
        $response = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 5
        $tunnels = @($response.tunnels)
        if ($tunnels.Count -eq 0) { return $null }
        # Предпочитаем https-туннель, иначе берём первый попавшийся
        $https = $tunnels | Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1
        if ($https) { return $https.public_url }
        return $tunnels[0].public_url
    } catch {
        return $null
    }
}

# --- Шаг 2. Проверяем, запущен ли ngrok; если нет — запускаем ---
$url = Get-NgrokPublicUrl
if (-not $url) {
    Write-Host "Локальный API ngrok (127.0.0.1:4040) не отвечает — запускаю ngrok http $NGROK_PORT ..."
    try {
        Start-Process ngrok "http $NGROK_PORT"
    } catch {
        Write-Host "ОШИБКА: не удалось запустить ngrok. Убедитесь, что ngrok установлен и доступен в PATH." -ForegroundColor Red
        Write-Host "Скачать и настроить: https://ngrok.com (ngrok config add-authtoken <токен>)" -ForegroundColor Yellow
        Read-Host "Нажмите Enter для выхода"
        exit 1
    }
    # Ждём до 15 секунд появления API
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and -not $url) {
        Start-Sleep -Seconds 1
        $url = Get-NgrokPublicUrl
    }
    if (-not $url) {
        Write-Host "ОШИБКА: ngrok не поднял туннель за 15 секунд. Проверьте, что приложение слушает порт $NGROK_PORT." -ForegroundColor Red
        Read-Host "Нажмите Enter для выхода"
        exit 1
    }
}

# --- Отправка уведомлений и сохранение адреса (шаги 3-6) ---
function Publish-Url([string]$publicUrl) {
    $timestamp = Get-Date -Format 'dd.MM.yyyy HH:mm:ss'
    $text = @"
VibeScribe Studio — публичный адрес туннеля
Дата/время: $timestamp
Публичный URL: $publicUrl
Туннель ведёт на локальный порт: $NGROK_PORT
"@

    # Шаг 4. ВСЕГДА: файл на рабочем столе (перезапись) + вывод в консоль
    $desktop = [Environment]::GetFolderPath('Desktop')
    $filePath = Join-Path $desktop 'VibeScribe-адрес.txt'
    try {
        $text | Out-File -FilePath $filePath -Encoding UTF8 -Force
        Write-Host "Адрес сохранён в файл: $filePath"
    } catch {
        Write-Host "ПРЕДУПРЕЖДЕНИЕ: не удалось записать файл на рабочий стол: $($_.Exception.Message)" -ForegroundColor Yellow
    }
    Write-Host $text -ForegroundColor Green

    # Шаг 5. Telegram (если заданы токен и chat_id)
    if ($TELEGRAM_BOT_TOKEN -and $TELEGRAM_CHAT_ID) {
        try {
            $tgUri = "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage"
            Invoke-RestMethod -Uri $tgUri -Method Post -Body @{
                chat_id = $TELEGRAM_CHAT_ID
                text    = $text
            } -TimeoutSec 15 | Out-Null
            Write-Host "Уведомление отправлено в Telegram."
        } catch {
            Write-Host "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить сообщение в Telegram: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    # Шаг 6. Email через SMTP (если заданы SMTP_* и SMTP_TO)
    if ($SMTP_HOST -and $SMTP_USER -and $SMTP_PASS -and $SMTP_TO) {
        try {
            $smtp = New-Object System.Net.Mail.SmtpClient($SMTP_HOST, $SMTP_PORT)
            $smtp.EnableSsl = $true
            $smtp.Credentials = New-Object System.Net.NetworkCredential($SMTP_USER, $SMTP_PASS)
            $mail = New-Object System.Net.Mail.MailMessage($SMTP_USER, $SMTP_TO)
            $mail.Subject = 'VibeScribe: новый адрес туннеля'
            $mail.Body = $text
            $mail.BodyEncoding = [System.Text.Encoding]::UTF8
            $smtp.Send($mail)
            $mail.Dispose()
            $smtp.Dispose()
            Write-Host "Уведомление отправлено на email: $SMTP_TO"
        } catch {
            Write-Host "ПРЕДУПРЕЖДЕНИЕ: не удалось отправить email: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

Publish-Url $url

# --- Шаг 7. Следим за сменой URL каждые 60 секунд (выход — Ctrl+C) ---
$lastUrl = $url
Write-Host "Слежение запущено: проверка адреса каждые 60 секунд. Для выхода нажмите Ctrl+C."
while ($true) {
    Start-Sleep -Seconds 60
    $currentUrl = Get-NgrokPublicUrl
    if (-not $currentUrl) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Туннель временно недоступен (ngrok переподключается?), жду..." -ForegroundColor Yellow
        continue
    }
    if ($currentUrl -ne $lastUrl) {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Адрес туннеля изменился: $lastUrl -> $currentUrl" -ForegroundColor Cyan
        $lastUrl = $currentUrl
        Publish-Url $currentUrl
    } else {
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Адрес без изменений: $currentUrl"
    }
}
