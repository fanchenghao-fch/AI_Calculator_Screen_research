#!/bin/zsh
set -u
board_dir="${0:A:h}"
cd -- "$board_dir" || exit 1
if command -v node >/dev/null 2>&1; then
  node scripts/build-dashboard.cjs --rebuild
  update_status=$?
  if [ "$update_status" -eq 0 ]; then
    printf '\n看板已更新。请重新打开或刷新“竞对看板.html”。\n'
  else
    printf '\n本次有内容尚未完成收录，请查看上方提示；已有研究已保留。\n'
  fi
else
  update_status=1
  printf '未找到 Node.js。请在 Codex 中请求“核对并更新竞对看板”。\n'
fi
printf '\n按回车关闭窗口。'
read -r task_response
exit "$update_status"
