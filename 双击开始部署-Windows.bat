@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [需要先准备] 没有找到 Node.js。
  echo 请安装 Node.js 22 或更高版本，再重新双击此文件。
  echo 下载地址：https://nodejs.org/zh-cn/download
  pause
  exit /b 1
)
node "%ROOT%部署助手\cli.mjs"
if errorlevel 1 (
  echo.
  echo 部署助手没有完成，请按上方提示处理后重试。
)
pause
