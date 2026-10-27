@echo off
title IMC-Bot
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.13 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Installing the bot's libraries, one moment... & call npm install --omit=dev)
start "" http://localhost:8440/
node src/index.js
pause
