@echo off
cd /d "%~dp0"
if not exist node_modules (
    echo Paketler yukleniyor...
    call npm install
)
echo Sunucu baslatiliyor: http://localhost:3000
echo Admin: http://localhost:3000/login.html
echo Kapatmak icin bu pencerede Ctrl+C
start http://localhost:3000
node server.js
pause
