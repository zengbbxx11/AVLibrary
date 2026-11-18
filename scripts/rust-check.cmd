@echo off
setlocal
cd /d "%~dp0.."
set "RUSTC=%CD%\.toolchain\rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\rustc.exe"
set "RUSTDOC=%CD%\.toolchain\rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\rustdoc.exe"
if exist ".toolchain\vs\VC\Auxiliary\Build\vcvars64.bat" call ".toolchain\vs\VC\Auxiliary\Build\vcvars64.bat"
"%CD%\.toolchain\rustup\toolchains\stable-x86_64-pc-windows-msvc\bin\cargo.exe" test --locked --manifest-path src-tauri\Cargo.toml %*
