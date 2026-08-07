@echo off
setlocal enabledelayedexpansion

if "%~1"=="" (
  echo Drag one or more image/video files onto this .bat to add them to the gallery.
  pause
  exit /b 1
)

for %%F in (%*) do (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0add-gallery-entry.ps1" -FilePath "%%~F"
)

pause
