@echo off
REM Runs the business rule tests.
setlocal

set EXE=build\bin\parkwise_tests.exe
if not exist "%EXE%" set EXE=build\bin\Release\parkwise_tests.exe
if not exist "%EXE%" (
  echo parkwise_tests.exe was not found. Run build.bat first.
  exit /b 1
)

"%EXE%"
