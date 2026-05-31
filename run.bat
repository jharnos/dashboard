@echo off
cd /d "%~dp0"
echo.
echo  Stopping any existing dashboard...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5000" ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul
echo  Installing / verifying dependencies...
pip install -r requirements.txt --quiet
echo.
echo  Dashboard  ^>  http://localhost:5000
echo  Press Ctrl+C to stop.
echo.
python app.py
pause
