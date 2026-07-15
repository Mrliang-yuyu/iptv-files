#!/bin/bash
# /tmp/trigger_poll.sh - 监听 Webhook 触发测速
# 每分钟检查一次 webhook.site，收到刷新请求则执行探测

set -e

WEBHOOK_TOKEN="d59be1…ae43"
LAST_CHECK_FILE="/tmp/.last_webhook_check"
LOCK_FILE="/tmp/.probe_running"
LOG_FILE="/tmp/trigger_poll.log"

log() { echo "[$(date '+%H:%M:%S')] $*" >> "$LOG_FILE"; }

# 写入 refresh.json 辅助函数
write_status() {
  local status="$1" step="$2" progress="$3" extra="$4"
  local now=$(date '+%Y-%m-%d %H:%M:%S')
  local elapsed=0
  if [ -n "$START_EPOCH" ] && [ "$START_EPOCH" -gt 0 ]; then
    elapsed=$(( $(date +%s) - START_EPOCH ))
  fi
  echo "{\"status\":\"$status\",\"step\":\"$step\",\"progress\":$progress,\"elapsed\":$elapsed,\"startedAt\":\"$START_TIME\",\"updatedAt\":\"$now\"$extra}" > /tmp/epg_auto_bundle/refresh.json
  cp /tmp/epg_auto_bundle/refresh.json /tmp/iptv-git-push/refresh.json 2>/dev/null || true
}

# 检查是否已有测速在运行
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        exit 0
    fi
    rm -f "$LOCK_FILE"
    log "⚠️ 清理了残留锁文件 (PID $PID)"
fi

# 获取上次处理的时间
LAST_TIME=""
[ -f "$LAST_CHECK_FILE" ] && LAST_TIME=$(cat "$LAST_CHECK_FILE")

RESULT=$(curl -sL --max-time 15 \
  "https://webhook.site/token/${WEBHOOK_TOKEN}/requests?sorting=newest&per_page=1" 2>/dev/null) || { exit 0; }

CREATED=$(echo "$RESULT" | python3 -c "
import json,sys
try:
    d = json.load(sys.stdin)
    if d.get('data') and len(d['data']) > 0:
        r = d['data'][0]
        print(r.get('created_at',''))
        print(r.get('content',''))
    else:
        print('EMPTY'); print('')
except: print('ERR'); print('')
" 2>/dev/null)

NEW_TIME=$(echo "$CREATED" | head -1)
CONTENT=$(echo "$CREATED" | tail -1)

if [ -z "$NEW_TIME" ] || [ "$NEW_TIME" = "EMPTY" ] || [ "$NEW_TIME" = "ERR" ]; then exit 0; fi
if [ "$NEW_TIME" = "$LAST_TIME" ]; then exit 0; fi
if ! echo "$CONTENT" | grep -q "probe_trigger"; then
    echo "$NEW_TIME" > "$LAST_CHECK_FILE"
    exit 0
fi

# ── 真的触发了 ──
echo "$NEW_TIME" > "$LAST_CHECK_FILE"
echo "$$" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log "⚡ 收到刷新请求，开始测速..."
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
START_EPOCH=$(date +%s)
START_EPOCH_VAR=$START_EPOCH

write_status "running" "开始探测" 0
log "1. 下载源列表..."

# 下载最新 m3u
curl -sL --max-time 15 "https://iptv-live-btg.pages.dev/p/a25fcf8d/live.m3u" \
  -o /tmp/probe_m3u_latest.m3u 2>/dev/null || {
    log "❌ 下载 live.m3u 失败"
    write_status "failed" "下载失败" 0 ',"error":"下载 live.m3u 失败"'
    exit 1
}
write_status "running" "测速中" 15
log "2. 测速中..."

# 运行测速（最长5分钟）
cd /tmp/epg_auto_bundle
timeout 300 python3 /tmp/probe_m3u.py /tmp/probe_m3u_latest.m3u /dev/null status.json >> "$LOG_FILE" 2>&1 || {
    log "⚠️ 测速未完成（超时或出错）"
}

write_status "running" "生成结果" 85
log "3. 推送结果到 GitHub..."

# 推送结果到 GitHub
export GIT_SSH_COMMAND="ssh -F /tmp/ssh_config_vless"
mkdir -p /tmp/iptv-git-push/p/a25fcf8d
cd /tmp/iptv-git-push

CHANNEL_COUNT=$(python3 -c "import json,sys; d=json.load(open('/tmp/epg_auto_bundle/status.json')); print(len(d.get('channels', [])))" 2>/dev/null || echo 0)
if [ "$CHANNEL_COUNT" -gt 0 ]; then
    log "✅ 探测到 $CHANNEL_COUNT 个频道"
    cp /tmp/epg_auto_bundle/status.json /tmp/epg_auto_bundle/refresh.json p/a25fcf8d/ 2>/dev/null
    cp /tmp/epg_auto_bundle/status.json /tmp/epg_auto_bundle/refresh.json . 2>/dev/null
else
    log "⚠️ 探测到 0 个频道，跳过更新（保留旧数据）"
    cp /tmp/epg_auto_bundle/refresh.json p/a25fcf8d/ . 2>/dev/null
fi
if [ -f /tmp/epg_auto_bundle/dashboard.html ]; then
    cp /tmp/epg_auto_bundle/dashboard.html p/a25fcf8d/dashboard.html
fi

write_status "running" "推送至 GitHub" 92
git add -A 2>/dev/null
git config user.email "nas@probe-bot" 2>/dev/null
git config user.name "Probe Bot" 2>/dev/null

if git diff --cached --quiet 2>/dev/null; then
    log "ℹ️ 无变化，跳过推送"
    write_status "completed" "完成" 100
else
    git commit -m "手动触发测速 $(date '+%m-%d %H:%M')" 2>/dev/null
    git push origin main 2>&1 >> "$LOG_FILE" | tail -1
    log "✅ 测速完成，已推送"

    write_status "running" "等待 Cloudflare 部署" 95
    # 等 CF Pages 部署（最多60秒），检测 status.json 是否更新
    OLD_UPDATE=$(python3 -c "import json; d=json.load(open('status.json')); print(d.get('lastUpdate',''))" 2>/dev/null)
    for i in $(seq 1 12); do
        sleep 5
        DEPLOYED=$(timeout 5 curl -s -m 5 "https://iptv-live-btg.pages.dev/status.json" 2>/dev/null | python3 -c "
import json,sys; d=json.load(sys.stdin); print(d.get('lastUpdate',''))
" 2>/dev/null)
        if [ -n "$DEPLOYED" ] && [ "$DEPLOYED" != "$OLD_UPDATE" ] && [ -n "$OLD_UPDATE" ]; then
            log "✅ Cloudflare Pages 部署完成 ($((i*5))秒)"
            break
        fi
        # 进度递增 95→99
        write_status "running" "部署中 ($((i*5))秒)" $(( 95 + i/2 ))
    done
    write_status "completed" "完成" 100
fi

log "✅ 完成"