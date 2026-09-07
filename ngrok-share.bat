@echo off
chcp 65001 >nul
rem Обёртка для запуска PowerShell-скрипта публикации адреса ngrok-туннеля
powershell -ExecutionPolicy Bypass -File "%~dp0ngrok-share.ps1"
pause
