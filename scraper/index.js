/**
 * Clim'Finder Scraper v2 — Puppeteer edition
 * Utilise un vrai navigateur headless pour bypasser les anti-bots (Cloudflare, WAF).
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'stocks.json');
const TIMEOUT = 25000;

// ── Enseignes (selecteurs simplifies) ──
const STORES = [
  { name: 'Darty', url: 'https://www.darty.com/nav/extra/list?s=climatiseur+portable&cat=21791&o=4', container: '[class*="product"], article, [class*="card"], [class*="item"], li', baseUrl: 'https://www.darty.com', availability_type: 'delivery' },
  { name: 'Boulanger', url: 'https://www.boulanger.com/resultats?tr=climatiseur+portable', container: '[class*="product"], article, [class*="card"], [class*="item"], li', baseUrl: 'https://www.boulanger.com', availability_type: 'delivery' },
  { name: 'Leroy Merlin', url: 'https://www.leroymerlin.fr/produits/climatiseur-portable.html', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.leroymerlin.fr', availability_type: 'tours' },
  { name: 'Cdiscount', url: 'https://www.cdiscount.com/electromenager/r-climatiseur+portable.html', container: '[class*="prdt"], [class*="product"], article, li', baseUrl: 'https://www.cdiscount.com', availability_type: 'delivery' },
  { name: 'Amazon', url: 'https://www.amazon.fr/s?k=climatiseur+portable+mobile&i=kitchen', container: '[data-component-type="s-search-result"], [class*="s-result-item"]', baseUrl: 'https://www.amazon.fr', availability_type: 'delivery' },
  { name: 'Castorama', url: 'https://www.castorama.fr/search?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.castorama.fr', availability_type: 'tours' },
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

function detectStatus(allText) {
  if (!allText) return 'unknown';
  const t = allText.toLowerCase();
  if (t.includes('indisponible') || t.includes('rupture') || t.includes('epuise') ||
      t.includes('non disponible') || t.includes('victime de son succes')) return 'out_of_stock';
  if (t.includes('plus que') || t.includes('derniers') || t.includes('bientot') ||
      t.includes('quantite limitee') || t.includes('stock faible')) return 'low_stock';
  if (t.includes('en stock') || t.includes('disponible') || t.includes('en ligne') ||
      t.includes('expedie sous') || t.includes('livre') || t.includes('livraison') ||
      t.includes('chez vous') || t.includes('retrait') || t.includes('ajouter au panier')) return 'in_stock';
  return 'unknown';
}

function isRealPortableAC(title, price) {
  const t = title.toLowerCase();
  // Exclure splits muraux
  if (t.includes('split')) return false;
  if (t.includes('mural') && !t.includes('portable') && !t.includes('mobile')) return false;
  if (t.includes('reversible') && !t.includes('portable') && !t.includes('mobile')) return false;
  // Exclure accessoires
  if ((t.includes('telecommande') || t.includes('filtre') || t.includes('tuyau') ||
       t.includes('bouteille') || t.includes('joint') || t.includes('kit')) &&
      !t.includes('climatiseur')) return false;
  // Exclure mini USB < 80EUR
  if (t.includes('usb') && price && price < 80) return false;
  if ((t.includes('mini') || t.includes('de table') || t.includes('de poche')) && price && price < 80) return false;
  // Exclure rafraichisseurs sans compresseur
  if (price && price < 100 && !t.includes('btu') &&
      (t.includes('rafraichisseur') || t.includes('refroidisseur'))) return false;
  return true;
}

function cleanUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return baseUrl + (url.startsWith('/') ? '' : '/') + url;
}

// ── Scrape un site (full-text) ──
async function scrapeStore(page, store) {
  console.log('🔍 ' + store.name + '…');
  const products = [];
  try {
    await page.goto(store.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForSelector(store.container, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => {
      let h = 0;
      const t = setInterval(() => { window.scrollBy(0, 400); h += 400; if (h >= 4000) { clearInterval(t); resolve(); } }, 150);
    }));
    await new Promise(r => setTimeout(r, 1500));
    const items = await page.evaluate((containerSelector) => {
      let containers = document.querySelectorAll(containerSelector);
      if (containers.length === 0) {
        containers = document.querySelectorAll('article, [class*="product"], [class*="card"], [class*="item"], li:has(a[href])');
      }
      return Array.from(containers).map(el => {
        const fullText = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const links = Array.from(el.querySelectorAll('a[href]'));
        const mainLink = links.find(a => a.textContent.trim().length > 5 && !a.href.includes('javascript:') && !a.href.includes('#')) || links[0];
        const imgs = Array.from(el.querySelectorAll('img'));
        const mainImg = imgs.find(i => i.src && !i.src.includes('logo') && !i.src.includes('icon')) || imgs[0];
        return {
          fullText, title: (el.querySelector('h2, h3, h4, [class*="title"], [class*="name"]') || {}).textContent || '',
          link: mainLink ? mainLink.href : '', img: mainImg ? (mainImg.src || mainImg.getAttribute('data-src') || '') : '',
        };
      }).filter(item => {
        const t = item.fullText.toLowerCase();
        return t.includes('climatis') || t.includes('rafraichis') || t.includes('air condition');
      });
    }, store.container);
    for (const item of items) {
      const title = (item.title || item.fullText.substring(0, 120)).trim();
      const allText = item.fullText;
      const price = extractPrice(allText);
      const status = detectStatus(allText);
      const url = cleanUrl(item.link, store.baseUrl);
      const btu = detectBTU(allText);
      if (!isRealPortableAC(title, price)) continue;
      let stockInfo = '';
      const stockRegex = /(?:en stock|disponible|indisponible|rupture|livraison|expedi[ée]|retrait|stock)[^.]*\.?/gi;
      const matches = allText.match(stockRegex);
      if (matches) stockInfo = matches.slice(0, 2).join(' | ');
      products.push({
        store: store.name, title: title.substring(0, 200), price_eur: price, url,
        image: item.img || null, status, availability_type: store.availability_type,
        delivery_info: stockInfo || null, brand: null, model: null, btu,
        stock_info: stockInfo || null, scraped_at: new Date().toISOString(),
      });
    }
  } catch (err) { console.warn('  ⚠️  ' + store.name + ': ' + err.message); }
  console.log('  → ' + products.length + ' produits');
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
