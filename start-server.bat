@echo off
rem Huxi 3D map dev server launcher
cd /d %~dp0
echo ================================================
echo  Huxi 3D Map server starting...
echo  Open: http://localhost:5188
echo  (Ctrl+C to stop; close this window to kill)
echo ================================================
npx vite --port 5188 --strictPort --host
pause
