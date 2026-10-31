@echo off
cd /d "%~dp0"
start "FinTrack API" cmd /k npm run dev:api
start "FinTrack Web" cmd /k npm run dev
