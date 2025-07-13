@echo off
setlocal enabledelayedexpansion

REM Release script for Pomodoro Timer App

echo 🚀 Pomodoro Timer App Release Script

REM Check if version is provided
if "%1"=="" (
    echo Error: Please provide a version number (e.g., 1.0.0)
    echo Usage: scripts\release.bat ^<version^>
    exit /b 1
)

set VERSION=%1

echo 📦 Preparing release for version %VERSION%

REM Update version in package.json
cd pomodoro-tauri
call npm version %VERSION% --no-git-tag-version

REM Update version in tauri.conf.json (Windows-compatible)
powershell -Command "(Get-Content src-tauri\tauri.conf.json) -replace '\"version\": \".*\"', '\"version\": \"%VERSION%\"' | Set-Content src-tauri\tauri.conf.json"

cd ..

REM Create git tag
git add .
git commit -m "Release version %VERSION%"
git tag -a "v%VERSION%" -m "Release version %VERSION%"

echo ✅ Version %VERSION% prepared successfully!
echo 📝 To create a release:
echo 1. Push the tag: git push origin v%VERSION%
echo 2. The GitHub Action will automatically build and create a release
echo.
echo �� Happy releasing! 