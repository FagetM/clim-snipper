#!/usr/bin/env node
/**
 * Midea PortaSplit 12000 BTU — Targeted price tracker
 * Checks Amazon.de and MediaMarkt.de every run, logs to price_history.json
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'price_history.json');

const TARGETS = [
  {
    name: 'Amazon.de',
    url: 'https://www.amazon.de/dp/B0D3PP64JS',
    handler: async (page) => {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' });
      await page.goto('https://www.amazon.de/dp/B0D3PP64JS', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      const data = await page.evaluate(() => {
        // Only capture price from the main buying options, not accessories
        let price = null;
        // Look for the "See All Buying Options" pane or main price block
        const allPriceEls = document.querySelectorAll('.a-price .a-offscreen');
        for (const el of allPriceEls) {
          const txt = el.textContent.replace(/[^0-9,.]/g, '').replace(',', '.');
          const p = parseFloat(txt);
          // Portasplit real price is 700-2500€, ignore anything under 500
          if (p && p > 500) { price = p; break; }
        }

        const stockEl = document.querySelector('#availability span, #outOfStock, .a-size-medium.a-color-success');
        const stock = stockEl ? stockEl.textContent.trim() : '';

        const title = document.querySelector('#productTitle')?.textContent?.trim() || '';

        // Look for delivery info
        const deliveryEl = document.querySelector('#mir-layout-DELIVERY_BLOCK, #deliveryBlockContainer');
        const delivery = deliveryEl ? deliveryEl.textContent.trim() : '';

        return { price, stock, title, delivery };
      });

      return {
        title: data.title.substring(0, 100),
        price_eur: data.price || null,
        stock_info: data.stock.substring(0, 200) || 'unknown',
        delivery_info: data.delivery.substring(0, 200) || 'unknown'
      };
    }
  },
  {
    name: 'MediaMarkt.de',
    url: 'https://www.mediamarkt.de/de/product/_midea-portasplit-split-klimaanlage-mondweiss-max-raumgrosse-105-m-3035465.html',
    handler: async (page) => {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8' });
      await page.goto('https://www.mediamarkt.de/de/product/_midea-portasplit-split-klimaanlage-mondweiss-max-raumgrosse-105-m-3035465.html', { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 5000));

      const data = await page.evaluate(() => {
        // MediaMarkt uses various price selectors
        const selectors = ['[data-test="mms-price"]', '.price--main', '.price', '[class*="price"]', '[class*="Price"]'];
        let price = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const raw = el.textContent.trim();
            if (/\d{3,4}[,.]\d{2}/.test(raw)) {
              price = parseFloat(raw.replace(/[^0-9,.]/g, '').replace(',', '.'));
              if (price > 100) break;
            }
          }
        }

        const stockEl = document.querySelector('[data-test="availability"], .availability');
        const stock = stockEl ? stockEl.textContent.trim() : '';

        const title = document.querySelector('h1')?.textContent?.trim() || '';

        return { price, stock, title };
      });

      return {
        title: data.title.substring(0, 100),
        price_eur: data.price || null,
        stock_info: data.stock.substring(0, 200) || 'unknown',
        delivery_info: 'Check MediaMarkt.de for international delivery'
      };
    }
  },
  {
    name: 'Idealo.de',
    url: 'https://www.idealo.de/preisvergleich/OffersOfProduct/203459851_-portasplit-midea.html',
    handler: async (page) => {
      await page.goto('https://www.idealo.de/preisvergleich/OffersOfProduct/203459851_-portasplit-midea.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));

      const data = await page.evaluate(() => {
        const offers = [];
        const rows = document.querySelectorAll('[class*="offer"], .offer-row, .productOffers-listItem');
        rows.forEach(row => {
          const priceEl = row.querySelector('[class*="price"], .offerList-itemPrice');
          const storeEl = row.querySelector('[class*="shop"], .offerList-itemShopName');
          if (priceEl) {
            offers.push({
              price: priceEl.textContent.replace(/[^0-9,.]/g, '').replace(',', '.'),
              store: storeEl?.textContent?.trim() || 'unknown'
            });
          }
        });
        return offers;
      });

      return {
        title: 'Idealo.de Preisvergleich',
        price_eur: data[0] ? parseFloat(data[0].price) : null,
        stock_info: data.length > 0 ? `${data.length} offres > 900€` : 'no offers',
        delivery_info: data.slice(0, 3).map(o => `${o.store}: ${o.price}€`).join(' | ').substring(0, 200)
      };
    }
  }
];

async function main() {
  console.log(`🎯 PortaSplit Tracker — ${new Date().toISOString()}\n`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const today = new Date().toISOString().slice(0, 10);
  const entry = {
    date: today,
    prices: [],
    lowest_new: null,
    lowest_store: null,
    note: ''
  };

  for (const target of TARGETS) {
    console.log(`🔍 ${target.name}…`);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const result = await target.handler(page);
      await page.close();

      console.log(`   ${result.price_eur ? result.price_eur + '€' : 'Prix non trouvé'} | ${result.stock_info}`);

      if (result.price_eur) {
        entry.prices.push({
          store: target.name,
          price_eur: result.price_eur,
          status: result.stock_info,
          delivery: result.delivery_info
        });

        if (!entry.lowest_new || result.price_eur < entry.lowest_new) {
          entry.lowest_new = result.price_eur;
          entry.lowest_store = target.name;
        }
      }
    } catch (e) {
      console.log(`   ⚠️ Erreur : ${e.message}`);
    }
  }

  await browser.close();

  // Load existing history
  let history = { product: 'Midea Portasplit 12000 BTU', currency: 'EUR', history: [] };
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}

  // Update or add today's entry
  const existingIdx = history.history.findIndex(h => h.date === today);
  if (existingIdx >= 0) {
    history.history[existingIdx] = { ...history.history[existingIdx], ...entry };
  } else {
    history.history.push(entry);
  }

  // Keep last 90 days
  if (history.history.length > 90) history.history = history.history.slice(-90);

  console.log(`\n💰 Meilleur prix : ${entry.lowest_new ? entry.lowest_new + '€ chez ' + entry.lowest_store : 'Aucun'}`);

  // Check for price drop alert
  const sorted = history.history.filter(h => h.lowest_new).sort((a, b) => a.lowest_new - b.lowest_new);
  if (sorted.length >= 2) {
    const current = sorted[sorted.length - 1].lowest_new;
    const previous = sorted.filter(h => h.date !== today).slice(-1)[0]?.lowest_new;
    if (previous && current < previous) {
      const drop = previous - current;
      const pct = Math.round((drop / previous) * 100);
      console.log(`\n🔔 BAISSE DE PRIX ! ${previous}€ → ${current}€ (-${pct}%)`);
      entry.note = `🔔 BAISSE : ${previous}€ → ${current}€ (-${pct}%)`;
    }
  }

  // Save
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log(`\n✅ Sauvegardé dans ${HISTORY_FILE}`);
}

main().catch(e => {
  console.error('❌', e.message);
  process.exit(1);
});
