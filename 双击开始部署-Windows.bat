@echo off
setlocal
chcp 65001 >nul
set "ROOT=%~dp0"

where lark-cli >nul 2>nul
if errorlevel 1 (
  echo [需要先安装] 没有找到飞书 CLI（lark-cli）。
  echo 请先在终端运行官方安装命令：
  echo.
  echo   npx @larksuite/cli@latest install
  echo.
  echo 官方项目：https://github.com/larksuite/cli
  echo 安装并完成飞书登录后，再重新双击此文件。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [飞书 CLI 环境异常] 已找到 lark-cli，但没有找到 Node.js。
  echo 请重新运行飞书 CLI 官方安装命令，再重新双击此文件：
  echo.
  echo   npx @larksuite/cli@latest install
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if errorlevel 1 (
    echo [需要准备 Git] 当前电脑没有 Git，也没有可用的 winget。
    echo 请从 https://git-scm.com/download/win 安装 Git，再重新双击此文件。
    pause
    exit /b 1
  )
  echo [正在准备 Git] 安装过程中可能出现一次系统确认。
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo Git 自动安装未完成，请从 https://git-scm.com/download/win 安装后重试。
    pause
    exit /b 1
  )
  echo Git 已安装。请关闭当前窗口并重新双击此文件。
  pause
  exit /b 0
)

node "%ROOT%部署助手\cli.mjs"
if errorlevel 1 (
  echo.
  echo 部署助手没有完成，请按上方提示处理后重试。
)
pause
