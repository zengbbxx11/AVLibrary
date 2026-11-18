@echo off
setlocal
cd /d "%~dp0.."
set "RUSTUP_HOME=%CD%\.toolchain\rustup"
set "CARGO_HOME=%CD%\.toolchain\cargo"
set "PATH=%CD%\.toolchain\cargo\bin;%PATH%"
if exist ".toolchain\vs\VC\Auxiliary\Build\vcvars64.bat" call ".toolchain\vs\VC\Auxiliary\Build\vcvars64.bat"
if "%1"=="build" (call npm run desktop:build) else (call npm run desktop:dev)
