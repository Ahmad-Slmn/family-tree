@echo off
cd /d "%~dp0"
echo Starting local server on port 8000...

REM تشغيل السيرفر في الخلفية بدون ربطه بنافذة الأوامر
start "" /b npx serve -l 8000 .

REM الانتظار ثانيتين حتى يبدأ السيرفر
timeout /t 2 > nul

REM فتح المتصفح على العنوان الصحيح
start "" http://localhost:8000
