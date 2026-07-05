#!/usr/bin/env node
/**
 * Stock checker — exécuté par le cron OpenClaw.
 * Compare le stocks.json actuel avec l'état précédent et signale les nouveautés.
 *
 * Usage: node check-stock.js <GITHUB_PAGES_URL>
 *   ex:  node check-stock.js https://moncompte.github.io/clim-finder
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'previous_state.json');
const URL = (process.argv[2] || '').replace(/\/$/, '') + '/data/stocks.json';

if (!process.argv[2]) {
  console.error('Usage: node check-stock.js <GITHUB_PAGES_URL>');
  process.exit(1);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'ClimFinder/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Invalid JSON'));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log(`🔍 Vérification: ${URL}`);

  let current;
  try {
    current = await fetchJSON(URL);
  } catch (err) {
    console.error(`❌ Impossible de récupérer les données: ${err.message}`);
    process.exit(1);
  }

  const previous = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    : { in_stock_ids: [] };

  const currentInStock = (current.products || [])
    .filter(p => p.status === 'in_stock' || p.status === 'low_stock')
    .map(p => ({ store: p.store, title: p.title, price: p.price_eur, url: p.url }));

  const currentIds = currentInStock.map(p => `${p.store}:${p.title}`);
  const prevIds = new Set(previous.in_stock_ids || []);

  const newItems = currentInStock.filter(p => !prevIds.has(`${p.store}:${p.title}`));
  const disappeared = (previous.in_stock_ids || []).filter(id => !currentIds.includes(id));

  // Save state
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    last_check: new Date().toISOString(),
    in_stock_ids: currentIds,
    total_products: current.total,
    in_stock_count: current.in_stock,
  }, null, 2));

  // Report
  console.log(`📊 ${current.total} produits | ${current.in_stock} en stock`);

  if (newItems.length > 0) {
    console.log(`\n🆕 ${newItems.length} NOUVEAU(X) EN STOCK !`);
    newItems.forEach(p => {
      console.log(`   • [${p.store}] ${p.title.substring(0, 70)} — ${p.price}€`);
      console.log(`     ${p.url}`);
    });
  }

  if (disappeared.length > 0) {
    console.log(`\n📴 ${disappeared.length} produit(s) plus en stock:`);
    disappeared.forEach(id => console.log(`   • ${id}`));
  }

  // Output structured result for the cron job to parse
  const result = {
    new_items: newItems,
    disappeared_count: disappeared.length,
    total: current.total,
    in_stock: current.in_stock,
    new_count: newItems.length,
  };

  console.log('\n---RESULT---');
  console.log(JSON.stringify(result));
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
