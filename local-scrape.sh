#!/bin/bash
# Clim'Finder — Scraper local (tourne sur ta machine, IP résidentielle, pas bloqué)
# Usage : ./local-scrape.sh

set -e
cd "$(dirname "$0")"

echo "🌬️  Clim'Finder — Scrape local"
echo "🕐 $(date '+%Y-%m-%d %H:%M:%S')"

# Installer les dépendances si besoin
if [ ! -d "scraper/node_modules" ]; then
  echo "📦 Installation des dépendances..."
  cd scraper && npm install && cd ..
fi

# Scraper
echo "🔍 Lancement du scraper sur $(node -e "const c=require('./config.json');console.log(c.cities.map(c=>c.name).join(', '))")"
cd scraper && node index.js && cd ..

# Commit et push vers GitHub (force-push pour eviter les conflits)
git add data/stocks.json data/new_stock_alert.json 2>/dev/null || true
if git diff --staged --quiet; then
  echo "✅ Aucun changement."
else
  git commit -m "📊 Local scan — $(date '+%Y-%m-%d %H:%M')"
  # Pull puis push (evite les conflits avec le CI)
  git pull --rebase || git rebase --abort
  git push 2>/dev/null || (echo '⚠️ Push refuse, force-push...' && git push --force-with-lease)
  echo "✅ Résultats poussés sur GitHub."
fi
