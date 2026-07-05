/**
 * Clim'Finder Scraper
 * Vérifie les stocks de climatiseurs portables sur les sites e-commerce français.
 * Exécuté par GitHub Actions toutes les heures.
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ── Configuration ──
const OUTPUT = path.join(__dirname, '..', 'data', 'stocks.json');
const TIMEOUT = 15000;
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

// ── Helpers ──
function randUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPage(url, opts = {}) {
  const headers = {
    'User-Agent': randUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    ...opts.headers,
  };
  try {
    const resp = await axios.get(url, { headers, timeout: TIMEOUT, ...opts });
    return resp.data;
  } catch (err) {
    if (opts.retries > 0) {
      await sleep(1000 + Math.random() * 2000);
      return fetchPage(url, { ...opts, retries: opts.retries - 1 });
    }
    console.warn(`  ⚠️  Échec ${url}: ${err.message}`);
    return null;
  }
}

function extractPrice(text) {
  if (!text) return null;
  // Match French price formats: 299,99 € / 299.99€ / 299 €
  const cleaned = text.replace(/\s+/g, '').replace(',', '.');
  const m = cleaned.match(/(\d+[.,]?\d*)\s*€/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

function detectBTU(title, desc) {
  const text = `${title || ''} ${desc || ''}`.toLowerCase();
  const m = text.match(/(\d{3,5})\s*btu/i) || text.match(/(\d[\d\s]*)\s*btu/i);
  if (m) return m[1].replace(/\s/g, '') + ' BTU';
  // Try to detect from wattage: 2500W ≈ 9000 BTU
  const w = text.match(/(\d{3,4})\s*w/i);
  if (w) {
    const watts = parseInt(w[1]);
    if (watts >= 2000 && watts <= 4000) return Math.round(watts * 3.412) + ' BTU';
  }
  return null;
}

// ── Store-specific scrapers ──

/** Darty — recherche "climatiseur portable" */
async function scrapeDarty() {
  console.log('🔍 Darty…');
  const products = [];
  const url = 'https://www.darty.com/nav/extra/list?s=climatiseur+portable&cat=21791&o=4';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);
  $('.product_card').each((_, el) => {
    const $el = $(el);
    const title = $el.find('.product_card_name').text().trim();
    const priceText = $el.find('.product_card_price .darty_prix').text().trim();
    const price = extractPrice(priceText);
    const link = $el.find('.product_card_name').attr('href') || '';
    const fullUrl = link.startsWith('http') ? link : 'https://www.darty.com' + link;
    const stockText = $el.find('.product_card_unavailable, .product_card_available').text().trim();
    const img = $el.find('img').attr('src') || '';

    let status = 'unknown';
    if (stockText.match(/indisponible|rupture|épuisé/i)) status = 'out_of_stock';
    else if (stockText.match(/disponible|en stock|livraison/i)) status = 'in_stock';
    else if ($el.find('.product_card_available').length > 0) status = 'in_stock';

    if (title && title.toLowerCase().includes('climatis')) {
      products.push({
        store: 'Darty',
        title,
        price_eur: price,
        url: fullUrl,
        image: img || null,
        status,
        availability_type: 'delivery',
        delivery_info: stockText || null,
        brand: null,
        model: null,
        btu: detectBTU(title, ''),
        stock_info: stockText || null,
        scraped_at: new Date().toISOString(),
      });
    }
  });
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Boulanger */
async function scrapeBoulanger() {
  console.log('🔍 Boulanger…');
  const products = [];
  const url = 'https://www.boulanger.com/resultats?tr=climatiseur+portable';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);
  $('[data-product]').each((_, el) => {
    const $el = $(el);
    const title = $el.find('.product-list__product-name, [class*="product-name"]').text().trim();
    const priceText = $el.find('.product-list__product-price, [class*="product-price"], [class*="amount"]').text().trim();
    const price = extractPrice(priceText);
    const link = $el.find('a').first().attr('href') || '';
    const fullUrl = link.startsWith('http') ? link : 'https://www.boulanger.com' + link;
    const stockText = $el.find('[class*="stock"], [class*="availability"], [class*="dispo"]').text().trim();

    let status = 'unknown';
    if (stockText.match(/indisponible|rupture|épuisé|non disponible/i)) status = 'out_of_stock';
    else if (stockText.match(/disponible|en stock|en ligne|expédié/i)) status = 'in_stock';
    else if (stockText.match(/dernier|bientôt|limité/i)) status = 'low_stock';

    if (title) {
      products.push({
        store: 'Boulanger',
        title,
        price_eur: price,
        url: fullUrl,
        image: null,
        status,
        availability_type: 'delivery',
        delivery_info: stockText || null,
        brand: null,
        model: null,
        btu: detectBTU(title, ''),
        stock_info: stockText || null,
        scraped_at: new Date().toISOString(),
      });
    }
  });
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Leroy Merlin — recherche + vérif magasin Tours */
async function scrapeLeroyMerlin() {
  console.log('🔍 Leroy Merlin…');
  const products = [];
  const url = 'https://www.leroymerlin.fr/produits/climatiseur-portable.html';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);

  // Try to find JSON-LD structured data first
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = data['@graph'] || [data];
      items.forEach(item => {
        if (item['@type'] === 'Product' && item.name) {
          products.push({
            store: 'Leroy Merlin',
            title: item.name,
            price_eur: item.offers?.price || null,
            url: item.url || '',
            image: item.image || null,
            status: item.offers?.availability?.includes('InStock') ? 'in_stock' : 'out_of_stock',
            availability_type: 'tours',
            delivery_info: null,
            brand: item.brand?.name || null,
            model: null,
            btu: detectBTU(item.name, item.description || ''),
            stock_info: null,
            scraped_at: new Date().toISOString(),
          });
        }
      });
    } catch (_) { /* ignore parse errors */ }
  });

  // Fallback: HTML scraping
  if (products.length === 0) {
    $('[class*="product"], [class*="card"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
      const priceText = $el.find('[class*="price"]').text().trim();
      const price = extractPrice(priceText);
      const link = $el.find('a').first().attr('href') || '';
      const fullUrl = link.startsWith('http') ? link : 'https://www.leroymerlin.fr' + link;

      if (title && title.toLowerCase().includes('climatis')) {
        products.push({
          store: 'Leroy Merlin',
          title,
          price_eur: price,
          url: fullUrl,
          image: null,
          status: 'unknown',
          availability_type: 'tours',
          delivery_info: null,
          brand: null,
          model: null,
          btu: detectBTU(title, ''),
          stock_info: 'Vérifier en magasin Tours',
          scraped_at: new Date().toISOString(),
        });
      }
    });
  }
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Castorama */
async function scrapeCastorama() {
  console.log('🔍 Castorama…');
  const products = [];
  const url = 'https://www.castorama.fr/search?q=climatiseur+portable';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);
  $('[class*="product"]').each((_, el) => {
    const $el = $(el);
    const title = $el.find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
    const priceText = $el.find('[class*="price"]').text().trim();
    const price = extractPrice(priceText);
    const link = $el.find('a').first().attr('href') || '';
    const fullUrl = link.startsWith('http') ? link : 'https://www.castorama.fr' + link;

    if (title) {
      products.push({
        store: 'Castorama',
        title,
        price_eur: price,
        url: fullUrl,
        image: null,
        status: 'unknown',
        availability_type: 'tours',
        delivery_info: null,
        brand: null,
        model: null,
        btu: detectBTU(title, ''),
        stock_info: 'Vérifier en magasin Tours',
        scraped_at: new Date().toISOString(),
      });
    }
  });
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Cdiscount */
async function scrapeCdiscount() {
  console.log('🔍 Cdiscount…');
  const products = [];
  const url = 'https://www.cdiscount.com/electromenager/r-climatiseur+portable.html';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);

  // Try JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const items = Array.isArray(data) ? data : data.itemListElement || [data];
      (Array.isArray(items) ? items : [items]).forEach(wrapper => {
        const item = wrapper.item || wrapper;
        if (item.name && item.name.toLowerCase().includes('climatis')) {
          products.push({
            store: 'Cdiscount',
            title: item.name,
            price_eur: item.offers?.price || null,
            url: item.url || '',
            image: item.image || null,
            status: 'unknown',
            availability_type: 'delivery',
            delivery_info: null,
            brand: null,
            model: null,
            btu: detectBTU(item.name, item.description || ''),
            stock_info: null,
            scraped_at: new Date().toISOString(),
          });
        }
      });
    } catch (_) {}
  });

  // Fallback HTML
  if (products.length === 0) {
    $('[class*="prdt"], [class*="product"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('[class*="title"], [class*="name"], .prdtBTit, h2, h3').first().text().trim();
      const priceText = $el.find('[class*="price"], .prdtPrice').text().trim();
      const price = extractPrice(priceText);
      const link = $el.find('a').first().attr('href') || '';
      const fullUrl = link.startsWith('http') ? link : 'https://www.cdiscount.com' + link;

      if (title && title.length > 5) {
        products.push({
          store: 'Cdiscount',
          title,
          price_eur: price,
          url: fullUrl,
          image: null,
          status: 'unknown',
          availability_type: 'delivery',
          delivery_info: null,
          brand: null,
          model: null,
          btu: detectBTU(title, ''),
          stock_info: null,
          scraped_at: new Date().toISOString(),
        });
      }
    });
  }
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Electro Dépôt */
async function scrapeElectroDepot() {
  console.log('🔍 Electro Dépôt…');
  const products = [];
  const url = 'https://www.electrodepot.fr/recherche?q=climatiseur+portable';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);
  $('[class*="product"]').each((_, el) => {
    const $el = $(el);
    const title = $el.find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
    const priceText = $el.find('[class*="price"]').text().trim();
    const price = extractPrice(priceText);
    const link = $el.find('a').first().attr('href') || '';
    const fullUrl = link.startsWith('http') ? link : 'https://www.electrodepot.fr' + link;

    if (title) {
      products.push({
        store: 'Electro Dépôt',
        title,
        price_eur: price,
        url: fullUrl,
        image: null,
        status: 'unknown',
        availability_type: 'both',
        delivery_info: null,
        brand: null,
        model: null,
        btu: detectBTU(title, ''),
        stock_info: null,
        scraped_at: new Date().toISOString(),
      });
    }
  });
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Amazon.fr */
async function scrapeAmazon() {
  console.log('🔍 Amazon.fr…');
  const products = [];
  const url = 'https://www.amazon.fr/s?k=climatiseur+portable&i=kitchen';
  const html = await fetchPage(url, {
    retries: 2,
    headers: {
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!html) return products;

  const $ = cheerio.load(html);
  $('[data-component-type="s-search-result"]').each((_, el) => {
    const $el = $(el);
    const title = $el.find('h2 span').text().trim() || $el.find('[class*="title"]').text().trim();
    const priceWhole = $el.find('.a-price-whole').first().text().trim();
    const priceFraction = $el.find('.a-price-fraction').first().text().trim();
    const priceText = priceWhole + (priceFraction ? '.' + priceFraction : '');
    const price = parseFloat(priceText.replace(',', '.')) || null;
    const link = $el.find('h2 a').attr('href') || $el.find('a.a-link-normal').first().attr('href') || '';
    const fullUrl = link.startsWith('http') ? link.split('/ref=')[0] : 'https://www.amazon.fr' + (link.split('/ref=')[0] || link);
    const img = $el.find('img.s-image').attr('src') || '';
    const deliveryText = $el.find('[data-cy="delivery-recipe"], [class*="delivery"]').text().trim();

    let status = 'in_stock'; // Amazon shows only available by default
    if (deliveryText.match(/indisponible|actuellement|rupture/i)) status = 'out_of_stock';

    if (title && title.toLowerCase().includes('climatis')) {
      products.push({
        store: 'Amazon',
        title: title.substring(0, 200),
        price_eur: price,
        url: fullUrl,
        image: img || null,
        status,
        availability_type: 'delivery',
        delivery_info: deliveryText || null,
        brand: null,
        model: null,
        btu: detectBTU(title, ''),
        stock_info: deliveryText || null,
        scraped_at: new Date().toISOString(),
      });
    }
  });
  console.log(`  → ${products.length} produits`);
  return products;
}

/** Conforama */
async function scrapeConforama() {
  console.log('🔍 Conforama…');
  const products = [];
  const url = 'https://www.conforama.fr/recherche?q=climatiseur+portable';
  const html = await fetchPage(url, { retries: 2 });
  if (!html) return products;

  const $ = cheerio.load(html);
  $('[class*="product"]').each((_, el) => {
    const $el = $(el);
    const title = $el.find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
    const priceText = $el.find('[class*="price"]').text().trim();
    const price = extractPrice(priceText);
    const link = $el.find('a').first().attr('href') || '';
    const fullUrl = link.startsWith('http') ? link : 'https://www.conforama.fr' + link;

    if (title) {
      products.push({
        store: 'Conforama',
        title,
        price_eur: price,
        url: fullUrl,
        image: null,
        status: 'unknown',
        availability_type: 'delivery',
        delivery_info: null,
        brand: null,
        model: null,
        btu: detectBTU(title, ''),
        stock_info: null,
        scraped_at: new Date().toISOString(),
      });
    }
  });
  console.log(`  → ${products.length} produits`);
  return products;
}

// ── Dedup & merge ──
function deduplicate(products) {
  const seen = new Set();
  return products.filter(p => {
    const key = `${p.store}:${p.title.substring(0, 80)}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Load previous data for history ──
function loadPrevious() {
  try {
    if (fs.existsSync(OUTPUT)) {
      const raw = fs.readFileSync(OUTPUT, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return { products: [], scanned_at: null };
}

function mergeHistory(previous, fresh) {
  const prevMap = new Map();
  (previous.products || []).forEach(p => {
    const key = `${p.store}:${p.title.substring(0, 80)}`.toLowerCase();
    prevMap.set(key, p);
  });

  return fresh.map(p => {
    const key = `${p.store}:${p.title.substring(0, 80)}`.toLowerCase();
    const prev = prevMap.get(key);
    if (prev) {
      // Preserve first_seen_at and history
      p.first_seen_at = prev.first_seen_at || prev.scraped_at;
      p.last_seen_at = prev.last_seen_at || prev.scraped_at;
      // Update status change
      if (prev.status !== p.status) {
        p.status_changed_at = p.scraped_at;
        p.previous_status = prev.status;
      }
    } else {
      p.first_seen_at = p.scraped_at;
    }
    p.last_seen_at = p.scraped_at;
    return p;
  });
}

// ── Main ──
async function main() {
  console.log('🌬️  Clim\'Finder — Scan des stocks');
  console.log(`🕐 ${new Date().toISOString()}\n`);

  const previous = loadPrevious();

  // Run all scrapers in parallel
  const results = await Promise.allSettled([
    scrapeDarty(),
    scrapeBoulanger(),
    scrapeLeroyMerlin(),
    scrapeCastorama(),
    scrapeCdiscount(),
    scrapeElectroDepot(),
    scrapeAmazon(),
    scrapeConforama(),
  ]);

  let allProducts = [];
  results.forEach((r, i) => {
    const names = ['Darty', 'Boulanger', 'Leroy Merlin', 'Castorama', 'Cdiscount', 'Electro Dépôt', 'Amazon', 'Conforama'];
    if (r.status === 'fulfilled') {
      allProducts = allProducts.concat(r.value);
    } else {
      console.warn(`  ❌ ${names[i]}: ${r.reason?.message || r.reason}`);
    }
  });

  // Dedup
  allProducts = deduplicate(allProducts);

  // Merge with history
  allProducts = mergeHistory(previous, allProducts);

  // Sort: in stock first, then by price
  const statusOrder = { in_stock: 0, low_stock: 1, unknown: 2, out_of_stock: 3 };
  allProducts.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 2;
    const sb = statusOrder[b.status] ?? 2;
    if (sa !== sb) return sa - sb;
    return (a.price_eur || 99999) - (b.price_eur || 99999);
  });

  // Build output
  const output = {
    scanned_at: new Date().toISOString(),
    total: allProducts.length,
    in_stock: allProducts.filter(p => p.status === 'in_stock' || p.status === 'low_stock').length,
    tours_available: allProducts.filter(p => p.availability_type === 'tours' || p.availability_type === 'both').length,
    delivery_available: allProducts.filter(p => p.availability_type === 'delivery' || p.availability_type === 'both').length,
    products: allProducts,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`\n✅ ${allProducts.length} produits sauvegardés`);
  console.log(`   En stock: ${output.in_stock} | Tours: ${output.tours_available} | Livraison: ${output.delivery_available}`);

  // Detect new in-stock items (vs previous scan)
  const prevInStock = new Set(
    (previous.products || [])
      .filter(p => p.status === 'in_stock' || p.status === 'low_stock')
      .map(p => `${p.store}:${p.title.substring(0, 80)}`.toLowerCase())
  );
  const newInStock = allProducts
    .filter(p => (p.status === 'in_stock' || p.status === 'low_stock') && !prevInStock.has(`${p.store}:${p.title.substring(0, 80)}`.toLowerCase()));

  if (newInStock.length > 0) {
    console.log(`\n🆕 ${newInStock.length} NOUVEAUX produits en stock !`);
    newInStock.forEach(p => console.log(`   • ${p.store}: ${p.title.substring(0, 80)} — ${p.price_eur}€`));
    // Write a notification file for GitHub Actions to detect
    fs.writeFileSync(
      path.join(__dirname, '..', 'data', 'new_stock_alert.json'),
      JSON.stringify({ count: newInStock.length, items: newInStock, detected_at: new Date().toISOString() }, null, 2)
    );
  } else {
    // Clear alert file if it exists
    const alertPath = path.join(__dirname, '..', 'data', 'new_stock_alert.json');
    if (fs.existsSync(alertPath)) fs.unlinkSync(alertPath);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
