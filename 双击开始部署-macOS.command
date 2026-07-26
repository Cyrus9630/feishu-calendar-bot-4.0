#!/bin/sh
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' '[需要先准备] 没有找到 Node.js。'
  printf '%s\n' '请安装 Node.js 22 或更高版本，再重新双击此文件。'
  printf '%s\n' '下载地址：https://nodejs.org/zh-cn/download'
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
