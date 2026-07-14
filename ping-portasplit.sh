#!/bin/bash
# PortaSplit HTTP ping — checks stock without Puppeteer, no model credits
# Runs <2s, can be cron'd every 30 min
set -e
cd "$(dirname "$0")"
cd scraper && node ping-portasplit.js && cd ..

# Detect change
if python3 -c "
import json
with open('data/.ping_state.json') as f:
    s = json.load(f)
lm = s.get('leroymerlin',{}).get('available')
az = s.get('amazon_de',{}).get('available')
print('AVAILABLE' if (lm or az) else 'NONE')
" 2>/dev/null | grep -q AVAILABLE; then
  echo "🎉 ALERTE DISPO !"
  # Will email via the ping script's own logic
fi

# Push state files
git add data/.ping_state.json data/price_history.json 2>/dev/null || true
if ! git diff --staged --quiet; then
  git commit -m "🏓 Ping — $(date '+%Y-%m-%d %H:%M')" && git pull --rebase 2>/dev/null || true && git push 2>/dev/null
fi
