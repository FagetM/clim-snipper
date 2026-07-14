#!/bin/bash
# PortaSplit availability check — Puppeteer, 3 stores, no noise
set -e
cd "$(dirname "$0")"
echo "🔍 Check — $(date '+%Y-%m-%d %H:%M')"
cd scraper && node check-availability.js && cd ..
