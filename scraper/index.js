/**
 * Clim'Finder Scraper v2 — Puppeteer edition
 * Utilise un vrai navigateur headless pour bypasser les anti-bots (Cloudflare, WAF).
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'stocks.json');
const TIMEOUT = 25000;

// ── Config par enseigne ──
const STORES = [
  {
    name: 'Darty',
    url: 'https://www.darty.com/nav/extra/list?s=climatiseur+portable&cat=21791&o=4',
    selectors: {
      container: '[class*="product_card"], [class*="product-card"], article',
      title: '[class*="product_card_name"], [class*="title"], h2, h3',
      price: '[class*="darty_prix"], [class*="price"], [class*="amount"]',
      link: 'a[href]',
      img: 'img',
      stock: '[class*="unavailable"], [class*="available"], [class*="stock"], [class*="dispo"]',
    },
    availability_type: 'delivery',
    baseUrl: 'https://www.darty.com',
  },
  {
    name: 'Boulanger',
    url: 'https://www.boulanger.com/resultats?tr=climatiseur+portable',
    selectors: {
      container: '[class*="product-list__item"], [class*="product-card"], article, li',
      title: '[class*="product-name"], [class*="title"], h2, h3',
      price: '[class*="price"], [class*="amount"]',
      link: 'a[href]',
      img: 'img',
      stock: '[class*="stock"], [class*="availability"], [class*="dispo"]',
    },
    availability_type: 'delivery',
    baseUrl: 'https://www.boulanger.com',
  },
  {
    name: 'Leroy Merlin',
    url: 'https://www.leroymerlin.fr/produits/climatiseur-portable.html',
    selectors: {
      container: '[class*="product-card"], [class*="product-item"], article',
      title: '[class*="title"], [class*="name"], h3',
      price: '[class*="price"]',
      link: 'a[href]',
      img: 'img',
      stock: '[class*="stock"], [class*="available"]',
    },
    availability_type: 'tours',
    baseUrl: 'https://www.leroymerlin.fr',
  },
  {
    name: 'Cdiscount',
    url: 'https://www.cdiscount.com/electromenager/r-climatiseur+portable.html',
    selectors: {
      container: '[class*="prdt"], [class*="product"], article, li',
      title: '[class*="title"], [class*="name"], .prdtBTit',
      price: '[class*="price"], .prdtPrice',
      link: 'a[href]',
      img: 'img',
      stock: '[class*="stock"], [class*="eco"], [class*="dispo"]',
    },
    availability_type: 'delivery',
    baseUrl: 'https://www.cdiscount.com',
  },
  {
    name: 'Amazon',
    url: 'https://www.amazon.fr/s?k=climatiseur+portable&i=kitchen',
    selectors: {
      container: '[data-component-type="s-search-result"]',
      title: 'h2 span, [class*="title"]',
      price: '.a-price',
      link: 'h2 a, a[class*="link-normal"]',
      img: '.s-image',
      stock: '[data-cy="delivery-recipe"], [class*="delivery"]',
    },
    availability_type: 'delivery',
    baseUrl: 'https://www.amazon.fr',
  },
  {
    name: 'Castorama',
    url: 'https://www.castorama.fr/search?q=climatiseur+portable',
    selectors: {
      container: '[class*="product-card"], [class*="product-item"], article',
      title: '[class*="title"], [class*="name"], h3',
      price: '[class*="price"]',
      link: 'a[href]',
      img: 'img',
      stock: '[class*="stock"], [class*="available"]',
    },
    availability_type: 'tours',
    baseUrl: 'https://www.castorama.fr',
  },
];

// ── Helpers ──
function extractPrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, '').replace(',', '.');
  const m = cleaned.match(/(\d+[.,]?\d*)\s*€/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
}

function detectBTU(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const m = t.match(/(\d{3,5})\s*btu/i);
  if (m) return m[1].replace(/\s/g, '') + ' BTU';
  const w = t.match(/(\d{3,4})\s*w/i);
  if (w) {
    const watts = parseInt(w[1]);
    if (watts >= 2000 && watts <= 4000) return Math.round(watts * 3.412) + ' BTU';
  }
  return null;
}

function detectStatus(text) {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  if (t.match(/indisponible|rupture|épuisé|non disponible|indispo/i)) return 'out_of_stock';
  if (t.match(/dernier|bientôt|limité|plus que|restant/i)) return 'low_stock';
  if (t.match(/disponible|en stock|en ligne|expédié|livraison/i)) return 'in_stock';
  return 'unknown';
}

function cleanUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return baseUrl + (url.startsWith('/') ? '' : '/') + url;
}

// ── Scrape un site ──
async function scrapeStore(page, store) {
  console.log(`🔍 ${store.name}…`);
  const products = [];

  try {
    await page.goto(store.url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT,
    });

    // Attendre que du contenu apparaisse
    await page.waitForSelector(store.selectors.container, { timeout: 8000 }).catch(() => {});

    // Scroll pour charger le lazy-loading
    await page.evaluate(async () => {
      await new Promise(resolve => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= 3000) { clearInterval(timer); resolve(); }
        }, 200);
      });
    });

    await new Promise(r => setTimeout(r, 1000));

    // Extraire les produits
    const items = await page.evaluate((sel) => {
      const containers = document.querySelectorAll(sel.container);
      return Array.from(containers).map(el => {
        const titleEl = el.querySelector(sel.title);
        const priceEl = el.querySelector(sel.price);
        const linkEl = el.querySelector(sel.link);
        const imgEl = el.querySelector(sel.img);
        const stockEl = el.querySelector(sel.stock);

        return {
          title: titleEl?.textContent?.trim() || '',
          priceText: priceEl?.textContent?.trim() || '',
          link: linkEl?.href || linkEl?.getAttribute('href') || '',
          img: imgEl?.src || imgEl?.getAttribute('data-src') || '',
          stockText: stockEl?.textContent?.trim() || '',
        };
      }).filter(item => item.title.length > 3);
    }, store.selectors);

    for (const item of items) {
      // Pour Amazon, on veut tous les résultats. Pour les autres, filtrer sur "climatis"
      const titleLower = item.title.toLowerCase();
      const isClim = titleLower.includes('climatis') ||
                     titleLower.includes('rafraîchis') ||
                     titleLower.includes('refroidis') ||
                     titleLower.includes('air condition');

      if (!isClim && store.name !== 'Amazon') continue;

      // Éviter les accessoires
      if (titleLower.includes('télécommande') ||
          titleLower.includes('filtre') ||
          titleLower.includes('kit') ||
          titleLower.includes('tuyau') ||
          titleLower.includes('bouteille') ||
          titleLower.includes('joint')) continue;

      const price = extractPrice(item.priceText);
      const status = detectStatus(item.stockText);
      const url = cleanUrl(item.link, store.baseUrl);

      // Détécter si c'est un split/fixe (pas portable)
      if (titleLower.includes('split') || titleLower.includes('mural') || titleLower.includes('fixe') || titleLower.includes('monobloc mural')) continue;

      products.push({
        store: store.name,
        title: item.title.substring(0, 200),
        price_eur: price,
        url,
        image: item.img || null,
        status,
        availability_type: store.availability_type,
        delivery_info: item.stockText || null,
        brand: null,
        model: null,
        btu: detectBTU(item.title),
        stock_info: item.stockText || null,
        scraped_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn(`  ⚠️  ${store.name}: ${err.message}`);
  }

  console.log(`  → ${products.length} produits`);
  return products;
}

// ── Dedup ──
function deduplicate(products) {
  const seen = new Set();
  return products.filter(p => {
    const key = `${p.store}:${p.title.substring(0, 80)}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Load previous data ──
function loadPrevious() {
  try {
    if (fs.existsSync(OUTPUT)) {
      return JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
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
      p.first_seen_at = prev.first_seen_at || prev.scraped_at;
      p.last_seen_at = prev.last_seen_at || prev.scraped_at;
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
  console.log('🌬️  Clim\'Finder v2 — Scan Puppeteer');
  console.log(`🕐 ${new Date().toISOString()}\n`);

  const previous = loadPrevious();

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1366,768',
      ],
    });
  } catch (err) {
    console.error('❌ Impossible de lancer le navigateur:', err.message);
    process.exit(1);
  }

  const allProducts = [];

  try {
    for (const store of STORES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      });

      // Bloquer les ressources inutiles pour accélérer
      await page.setRequestInterception(true);
      page.on('request', req => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      try {
        const products = await scrapeStore(page, store);
        allProducts.push(...products);
      } catch (e) {
        console.warn(`  ❌ ${store.name} erreur: ${e.message}`);
      } finally {
        await page.close().catch(() => {});
      }

      // Petit délai entre les sites
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // Post-processing
  let products = deduplicate(allProducts);
  products = mergeHistory(previous, products);

  const statusOrder = { in_stock: 0, low_stock: 1, unknown: 2, out_of_stock: 3 };
  products.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 2;
    const sb = statusOrder[b.status] ?? 2;
    if (sa !== sb) return sa - sb;
    return (a.price_eur || 99999) - (b.price_eur || 99999);
  });

  const output = {
    scanned_at: new Date().toISOString(),
    total: products.length,
    in_stock: products.filter(p => p.status === 'in_stock' || p.status === 'low_stock').length,
    tours_available: products.filter(p => p.availability_type === 'tours' || p.availability_type === 'both').length,
    delivery_available: products.filter(p => p.availability_type === 'delivery' || p.availability_type === 'both').length,
    products,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`\n✅ ${products.length} produits sauvegardés`);
  console.log(`   En stock: ${output.in_stock} | Tours: ${output.tours_available} | Livraison: ${output.delivery_available}`);

  // Détection nouveautés
  const prevInStock = new Set(
    (previous.products || [])
      .filter(p => p.status === 'in_stock' || p.status === 'low_stock')
      .map(p => `${p.store}:${p.title.substring(0, 80)}`.toLowerCase())
  );
  const newInStock = products
    .filter(p => (p.status === 'in_stock' || p.status === 'low_stock') &&
      !prevInStock.has(`${p.store}:${p.title.substring(0, 80)}`.toLowerCase()));

  if (newInStock.length > 0) {
    console.log(`\n🆕 ${newInStock.length} NOUVEAUX produits en stock !`);
    newInStock.forEach(p => console.log(`   • ${p.store}: ${p.title.substring(0, 80)} — ${p.price_eur}€`));
    fs.writeFileSync(
      path.join(__dirname, '..', 'data', 'new_stock_alert.json'),
      JSON.stringify({ count: newInStock.length, items: newInStock, detected_at: new Date().toISOString() }, null, 2)
    );
  } else {
    const alertPath = path.join(__dirname, '..', 'data', 'new_stock_alert.json');
    if (fs.existsSync(alertPath)) fs.unlinkSync(alertPath);
  }
}

main().catch(err => {
  console.error('❌ Fatal:', err);
  process.exit(1);
});
