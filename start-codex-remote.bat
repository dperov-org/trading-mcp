@echo off
setlocal

set "CODEX_LOCAL_EXE=C:\Projects\codex-fork\codex-rs\target\release\codex.exe"
set "CODEX_REMOTE_REPO=/root/projects/trading-mcp"
set "CODEX_REMOTE_APP_SERVER_URL=ws://singapur.tail3e0cf.ts.net:8790"

if not exist "%CODEX_LOCAL_EXE%" (
  echo Codex executable not found: %CODEX_LOCAL_EXE%
  exit /b 1
)

"%CODEX_LOCAL_EXE%" --remote "%CODEX_REMOTE_APP_SERVER_URL%" -C "%CODEX_REMOTE_REPO%" --dangerously-bypass-approvals-and-sandbox %*
set "EXIT_CODE=%ERRORLEVEL%"

exit /b %EXIT_CODE%
