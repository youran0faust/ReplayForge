@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   ReplayForge  --^>  GitHub
echo ============================================================
echo.
echo   Repo : https://github.com/youran0faust/ReplayForge
echo.
echo   If a sign-in window pops up, choose
echo   "Sign in with your browser".
echo   This can take 10-60 seconds. Please wait...
echo.
echo ------------------------------------------------------------
echo [0/3] Ensuring remote repo exists (gh, optional) ...
echo ------------------------------------------------------------
gh repo create youran0faust/ReplayForge --private --description "Frame-accurate, AI-co-built deterministic narrative video engine" 1>nul 2>nul
echo.
echo ------------------------------------------------------------
echo [1/3] Pushing branch main ...
echo ------------------------------------------------------------
git push -u origin main
set PUSH1=%errorlevel%
echo.
echo ------------------------------------------------------------
echo [2/3] Pushing tags (v0.1.0) ...
echo ------------------------------------------------------------
git push origin --tags
set PUSH2=%errorlevel%
echo.
echo ============================================================
if %PUSH1%==0 if %PUSH2%==0 (
  echo   [OK] Everything pushed.
  echo.
  echo   Repo  : https://github.com/youran0faust/ReplayForge
  echo   Tag   : https://github.com/youran0faust/ReplayForge/releases/tag/v0.1.0
) else (
  echo   [FAILED]  main=%PUSH1%  tags=%PUSH2%
  echo.
  echo   Most common cause: the remote repo does not exist yet, or a
  echo   temporary TLS handshake failure.
  echo   - If repo is missing: create an EMPTY "ReplayForge" repo at
  echo     https://github.com/new  (do NOT tick README/license/gitignore).
  echo   - Then just close this window and double-click this file again.
)
echo ============================================================
echo.
pause
