@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次使用请按 README 安装依赖并构建。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo 请先运行 npm run build。
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "."
