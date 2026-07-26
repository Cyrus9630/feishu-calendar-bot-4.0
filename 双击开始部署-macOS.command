#!/bin/sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

if ! command -v lark-cli >/dev/null 2>&1; then
  printf '%s\n' '[需要先安装] 没有找到飞书 CLI（lark-cli）。'
  printf '%s\n' '请先在终端运行官方安装命令：'
  printf '\n  %s\n\n' 'npx @larksuite/cli@latest install'
  printf '%s\n' '官方项目：https://github.com/larksuite/cli'
  printf '%s\n' '安装并完成飞书登录后，再重新双击此文件。'
  printf '%s' '按回车键关闭窗口...'
  read -r _answer
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '[飞书 CLI 环境异常] 已找到 lark-cli，但没有找到 Node.js。'
  printf '%s\n' '请重新运行飞书 CLI 官方安装命令，再重新双击此文件：'
  printf '\n  %s\n\n' 'npx @larksuite/cli@latest install'
  printf '%s' '按回车键关闭窗口...'
  read -r _answer
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  printf '%s\n' '[正在准备 Git] 系统将打开 Apple 命令行工具安装提示。'
  xcode-select --install >/dev/null 2>&1 || true
  printf '%s\n' '完成系统弹窗中的安装后，请重新双击此文件。'
  printf '%s' '按回车键关闭窗口...'
  read -r _answer
  exit 1
fi

node "$SCRIPT_DIR/部署助手/cli.mjs"
status=$?
if [ "$status" -ne 0 ]; then
  printf '\n%s\n' '部署助手没有完成，请按上方提示处理后重试。'
fi
printf '%s' '按回车键关闭窗口...'
read -r _answer
exit "$status"
