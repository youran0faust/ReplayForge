@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto failed
set "CHECK_FAILED="
call :required "..\p0\node_modules\electron\dist\electron.exe"
call :required "main.cjs"
call :required "renderer\index.html"
call :required "renderer\preload.cjs"
call :required "renderer\preview.js"
call :required "renderer\scene-renderer.js"
call :required "renderer\scene.css"
call :required "core\model.cjs"
call :required "core\session.cjs"
call :required "examples\rain-corridor-v4.json"
call :required "assets\rain-corridor.svg"
call :required "assets\alice.svg"
call :required "assets\alice-voice.wav"
if defined CHECK_FAILED goto failed
rem No system Node/npm required. This checks the shipped default file list only.
rem The plain Node --check also parses default JSON/resource references.
call :optional "..\p0\tools\ffmpeg.exe" "FFmpeg: export/video features may fail"
call :optional "..\p0\tools\ffprobe.exe" "ffprobe: video import/probing may fail"
if defined ELECTRON_RUN_AS_NODE echo WARNING: Clearing ELECTRON_RUN_AS_NODE for the editor child.
set "ELECTRON_RUN_AS_NODE="
rem Preserve user override; relative paths resolve against P2, like run-electron.cjs.
if not defined REPLAY_RECOVERY_DIR set "REPLAY_RECOVERY_DIR=%~dp0runtime-output\recovery"
for %%I in ("%REPLAY_RECOVERY_DIR%") do set "REPLAY_RECOVERY_DIR=%%~fI"
"..\p0\node_modules\electron\dist\electron.exe" "%~dp0main.cjs"
set "EDITOR_EXIT=%ERRORLEVEL%"
if not "%EDITOR_EXIT%"=="0" (
  echo ERROR: Electron exited with code %EDITOR_EXIT%.
  pause
)
exit /b %EDITOR_EXIT%

:required
if not exist "%~1" goto missing
if exist "%~1\" goto missing
exit /b 0
:missing
echo ERROR: Missing editor file: %~f1
set "CHECK_FAILED=1"
exit /b 0

:optional
if not exist "%~1" goto toolwarning
if exist "%~1\" goto toolwarning
exit /b 0
:toolwarning
echo WARNING: %~2; editing remains available. Missing file: %~f1
exit /b 0

:failed
echo ERROR: Editor startup blocked. Restore the missing files above.
pause
exit /b 1
