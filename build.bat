@echo off
REM Builds ParkWise. Needs CMake and a C++17 compiler on the PATH.
setlocal

where cmake >nul 2>nul
if errorlevel 1 (
  echo CMake was not found on the PATH. See README.md, section "Setting up the tools".
  exit /b 1
)

echo Configuring...
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 exit /b 1

echo Building...
cmake --build build --config Release -j
if errorlevel 1 exit /b 1

echo.
echo Build finished. Run run.bat to start ParkWise.
