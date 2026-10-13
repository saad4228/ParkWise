@echo off
REM Starts the ParkWise server and opens it in your browser.
setlocal

set EXE=build\bin\parkwise.exe
if not exist "%EXE%" set EXE=build\bin\Release\parkwise.exe
if not exist "%EXE%" (
  echo parkwise.exe was not found. Run build.bat first.
  exit /b 1
)

start "" http://127.0.0.1:8080
"%EXE%" --port 8080
