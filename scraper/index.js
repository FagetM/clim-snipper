/**
 * Clim'Finder Scraper v2 — Puppeteer edition
 * Utilise un vrai navigateur headless pour bypasser les anti-bots (Cloudflare, WAF).
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'data', 'stocks.json');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const TIMEOUT = 25000;

// Lire les villes depuis config.json
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (_) { return {}; }
}
const CONFIG = loadConfig();
const CITIES = CONFIG.cities || [{ name: 'Tours', postcode: '37000' }];
const SCRAPE_CITIES = CONFIG.scrape_cities !== false;

// ── Construire la liste finale en fonction des villes ──
const BASE_STORES = [
  { name: 'Boulanger', url: 'https://www.boulanger.com/resultats?tr=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.boulanger.com', availability_type: 'delivery' },
  { name: 'Darty', url: 'https://www.darty.com/nav/extra/list?s=climatiseur+portable&cat=21791&o=4', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.darty.com', availability_type: 'delivery' },
  { name: 'Cdiscount', url: 'https://www.cdiscount.com/electromenager/r-climatiseur+portable.html', container: '[class*="prdt"], [class*="product"], article, li', baseUrl: 'https://www.cdiscount.com', availability_type: 'delivery' },
  { name: 'Amazon', url: 'https://www.amazon.fr/s?k=climatiseur+portable+mobile&i=kitchen', container: '[data-component-type="s-search-result"], [class*="s-result-item"]', baseUrl: 'https://www.amazon.fr', availability_type: 'delivery' },
  { name: 'Fnac', url: 'https://www.fnac.com/SearchResult/ResultList.aspx?Search=climatiseur+portable', container: '[class*="Article"], [class*="product"], article, li', baseUrl: 'https://www.fnac.com', availability_type: 'delivery' },
  { name: 'Rakuten', url: 'https://fr.shopping.rakuten.com/s/climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://fr.shopping.rakuten.com', availability_type: 'delivery' },
  { name: 'Ubaldi', url: 'https://www.ubaldi.com/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.ubaldi.com', availability_type: 'delivery' },
  { name: 'ManoMano', url: 'https://www.manomano.fr/cat/climatiseur+mobile+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.manomano.fr', availability_type: 'delivery' },
  { name: 'eBay', url: 'https://www.ebay.fr/sch/i.html?_nkw=climatiseur+portable&LH_PrefLoc=2', container: '[class*="s-item"], [class*="srp-results"] li, article', baseUrl: 'https://www.ebay.fr', availability_type: 'delivery' },
  // Google Shopping (agregateur, pas de filtre ville)
  { name: 'Google Shopping', url: 'https://www.google.com/search?tbm=shop&q=climatiseur+portable+mobile&hl=fr&gl=FR&num=40', container: '[class*="sh-dgr"], [class*="sh-pr"], [class*="result"]', baseUrl: 'https://www.google.com', availability_type: 'delivery', isGoogle: true },
];

// ── Stores avec magasins physiques (un store par ville UNIQUEMENT pour ceux qui filtrent par localisation) ──
const CITY_STORES = [
  // LeBonCoin — le seul qui filtre reellement par ville via l'URL
  { namePattern: 'LeBonCoin', urlTemplate: 'https://www.leboncoin.fr/recherche?category=48&text=climatiseur+portable&locations={CITY}_{PC}', baseUrl: 'https://www.leboncoin.fr', availability_type: 'tours' },
];

// ── Stores physiques nationaux (une seule passe, pas par ville) ──
const PHYSICAL_STORES = [
  { name: 'Leroy Merlin', url: 'https://www.leroymerlin.fr/produits/climatiseur-portable.html', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.leroymerlin.fr', availability_type: 'tours' },
  { name: 'Castorama', url: 'https://www.castorama.fr/search?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.castorama.fr', availability_type: 'tours' },
  { name: 'Carrefour', url: 'https://www.carrefour.fr/s?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.carrefour.fr', availability_type: 'both' },
  { name: 'Auchan', url: 'https://www.auchan.fr/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.auchan.fr', availability_type: 'both' },
  { name: 'E.Leclerc', url: 'https://www.e.leclerc/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.e.leclerc', availability_type: 'both' },
  { name: 'Mr Bricolage', url: 'https://www.mr-bricolage.fr/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.mr-bricolage.fr', availability_type: 'tours' },
  { name: 'Brico Depot', url: 'https://www.bricodepot.fr/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.bricodepot.fr', availability_type: 'tours' },
  { name: 'But', url: 'https://www.but.fr/recherche?question=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.but.fr', availability_type: 'both' },
  { name: 'Conforama', url: 'https://www.conforama.fr/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.conforama.fr', availability_type: 'delivery' },
  { name: 'Electro Depot', url: 'https://www.electrodepot.fr/catalogsearch/result?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.electrodepot.fr', availability_type: 'both' },
  { name: 'Intermarché', url: 'https://www.intermarche.com/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.intermarche.com', availability_type: 'both' },
  { name: 'Magasins U', url: 'https://www.magasins-u.com/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.magasins-u.com', availability_type: 'both' },
  { name: 'Brico Marché', url: 'https://www.bricomarche.com/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.bricomarche.com', availability_type: 'tours' },
  { name: 'GiFi', url: 'https://www.gifi.fr/recherche?q=climatiseur+portable', container: '[class*="product"], article, [class*="card"], li', baseUrl: 'https://www.gifi.fr', availability_type: 'both' },
];

// Construire la liste finale: BASE_STORES + PHYSICAL_STORES + CITY_STORES x CITIES
function buildAllStores() {
  const all = [...BASE_STORES, ...PHYSICAL_STORES];
  if (SCRAPE_CITIES) {
    for (const cityStore of CITY_STORES) {
      for (const city of CITIES) {
        all.push({
          name: cityStore.namePattern + ' ' + city.name,
          url: cityStore.urlTemplate.replace('{CITY}', city.name).replace('{PC}', city.postcode),
          container: '[class*="AdCard"], article, [class*="item"], li',
          baseUrl: cityStore.baseUrl,
          availability_type: cityStore.availability_type,
          city: city.name,
        });
      }
    }
  }
  return all;
}

const STORES = buildAllStores();

// ── Helpers ──
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
  const clean = allText.replace(/ajouter/gi, '').replace(/partagez votre avis[^€]*/gi, '').replace(/prix de comparaison[^€]*/gi, '');
  const t = clean.toLowerCase();
  // Rupture / indisponible
  if (t.includes('indisponible') || t.includes('rupture') || t.includes('epuise') ||
      t.includes('momentanement') || t.includes('non disponible') || t.includes('victime de son succes') ||
      t.includes('en cours de reapprovisionnement') || t.includes('n est plus') || t.includes('ne peut plus')) return 'out_of_stock';
  // Stock faible
  if (t.includes('plus que') || t.includes('dernier') || t.includes('bientot') ||
      t.includes('quantite limitee') || t.includes('stock faible') || t.includes('presque epuise')) return 'low_stock';
  // VERITABLE en stock — besoins de mots-cles specifiques
  if (t.includes('en stock') || t.includes('en magasin') || t.includes('click & collect') ||
      t.includes('retrait en 1h') || t.includes('retrait en 2h') || t.includes('disponible en') ||
      t.includes('expedie sous 24h') || t.includes('livre demain') || t.includes('livraison express')) return 'in_stock';
  // Par defaut: on ne sait pas = unknown (et NON "in_stock")
  return 'unknown';
}

function isRealPortableAC(fullText, price) {
  const t = fullText.toLowerCase();
  // Exclure splits muraux/reversibles (pas de clim portables)
  if (t.includes('split')) return false;
  if (t.includes('mural')) return false;
  // "climatiseur reversible" sans "portable" ni "mobile" = split mural
  if (t.includes('reversible') && !t.includes('portable') && !t.includes('mobile')) return false;
  if (t.includes('fixe') && !t.includes('portable')) return false;
  // Exclure TOUS les accessoires (strict)
  const accessoryWords = ['joint', 'tuyau', 'calfeutrage', 'etancheite', 'tissu ', 'rideau',
    'telecommande ', 'filtre ', 'bouteille ', 'kit ', 'support ', 'telecommandes'];
  if (accessoryWords.some(w => t.includes(w))) return false;
  // Exclure mini USB / sans evacuation / moule a glacon = pas un vrai clim
  if ((t.includes('usb') || t.includes('moule a glac')) && price && price < 150) return false;
  // Exclure rafraichisseurs evaporatifs (pas de compresseur)
  if (price && price < 250 && !t.includes('btu') &&
      (t.includes('rafraichisseur') || t.includes('rafraichisseur') ||
       t.includes('refroidisseur') || t.includes('sans evacuation') ||
       t.includes('reservoir') || t.includes('humidification'))) return false;
  // "mini" < 150€ = pas un vrai clim portable
  if (t.includes('mini') && price && price < 150) return false;
  return true;
}

function extractPriceFromText(text) {
  if (!text) return null;
  const m = text.match(/(\d{2,4}[.,]\d{0,2})\s*€/);
  if (!m) return null;
  const price = parseFloat(m[1].replace(',', '.'));
  return price > 5 && price < 10000 ? price : null;
}

function extractBrand(title) {
  if (!title) return null;
  const t = title.toUpperCase();
  const brands = ['DREAME','OPTIMEA','ESSENTIELB','REMKO','ECOFLOW','DUUX','HISENSE','ARGO','ELECTROLUX',
    'DE\'LONGHI','DELONGHI','TCL','HAIER','GREE','SANG','KOOPER','WHIRLPOOL','COMFEE','COSTWAY',
    'BECKEN','SENCOR','EQUATION','OMISOON','MARSEE','TECTAKE','TRAHOO','ZHUODIKE','EINNENFFER',
    'JOULLI','DRIVENEST','KEEPER','VIREX','DEMA','AMOUNE','NOBRAND'];
  for (const b of brands) {
    if (t.includes(b.toUpperCase())) return b === 'DE\'LONGHI' ? 'De\'Longhi' :
      b.charAt(0) + b.slice(1).toLowerCase();
  }
  return null;
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
      const title = (item.title || item.fullText.substring(0, 120)).trim().replace(/\s+/g, ' ').replace(/\s{2,}/g, ' ').trim();
      const allText = item.fullText;
      const price = extractPriceFromText(allText);
      // Ignorer les entrees sans prix ou sans lien produit valide
      if (!price || title.length < 12 || !item.link || item.link.length < 10) continue;
      const status = detectStatus(allText);
      const url = cleanUrl(item.link, store.baseUrl);
      const btu = detectBTU(allText);
      // Utiliser fullText pour le filtrage (plus complet que le titre extrait)
      if (!isRealPortableAC(allText, price)) continue;
      let stockInfo = '';
      const stockRegex = /(?:en stock|disponible|indisponible|rupture|livraison|expedi[ée]|retrait|stock)[^.]*\.?/gi;
      const matches = allText.match(stockRegex);
      if (matches) stockInfo = matches.slice(0, 2).join(' | ');
      products.push({
        store: store.name, title: title.substring(0, 200), price_eur: price, url,
        image: item.img || null, status, availability_type: store.availability_type,
        delivery_info: stockInfo || null, brand: extractBrand(title), model: null, btu,
        city: store.city || null,
        stock_info: stockInfo || null, scraped_at: new Date().toISOString(),
      });
    }
  } catch (err) { console.warn('  ⚠️  ' + store.name + ': ' + err.message); }
  console.log('  → ' + products.length + ' produits');
  return products;
}

// ── Scrape Google Shopping (agrege TOUS les marchands) ──
async function scrapeGoogle(page) {
  console.log('🔍 Google Shopping…');
  const products = [];
  try {
    await page.goto('https://www.google.com/search?tbm=shop&q=climatiseur+portable+mobile&hl=fr&gl=FR&num=40', {
      waitUntil: 'domcontentloaded', timeout: TIMEOUT,
    });
    await new Promise(r => setTimeout(r, 3000));

    const items = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="sh-dgr"], [class*="sh-pr"], [class*="result"], [class*="KZmu8e"]');
      return Array.from(cards).map(el => {
        const fullText = (el.textContent || '').replace(/\s+/g, ' ').trim();
        const links = Array.from(el.querySelectorAll('a[href]'));
        const mainLink = links.find(a => a.href.includes('/shopping/product/') || a.href.includes('/url?')) || links[0];
        const storeEl = el.querySelector('[class*="store"], [class*="merchant"], [class*="seller"], [class*="UI2sFb"]');
        return {
          fullText, title: fullText.substring(0, 120),
          link: mainLink ? mainLink.href : '',
          store: storeEl ? storeEl.textContent.trim().split(/[-–·]/)[0].trim() : '',
        };
      }).filter(item => { const t = item.fullText.toLowerCase(); return t.includes('climatis') && item.link; });
    });

    for (const item of items) {
      const price = extractPriceFromText(item.fullText);
      if (!price) continue;
      if (!isRealPortableAC(item.fullText, price)) continue;
      const status = detectStatus(item.fullText);
      products.push({
        store: item.store || 'Google Shopping', title: item.title.substring(0, 200),
        price_eur: price, url: item.link, image: null, status,
        availability_type: 'delivery', delivery_info: null, brand: extractBrand(item.title), model: null, city: null,
        btu: detectBTU(item.fullText), stock_info: null, scraped_at: new Date().toISOString(),
      });
    }
  } catch (err) { console.warn('  ⚠️  Google Shopping: ' + err.message); }
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
  console.log('ClimFinder v5 — Scan etendu (' + STORES.length + ' stores, ' + CITIES.length + ' villes)');
  console.log(new Date().toISOString() + '\n');

  const previous = loadPrevious();

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1366,768'],
    });
  } catch (err) { console.error('Browser:', err.message); process.exit(1); }

  const allProducts = [];
  try {
    for (const store of STORES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({'Accept-Language':'fr-FR,fr;q=0.9,en;q=0.8','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'});
      await page.setRequestInterception(true);
      page.on('request', req => { if (['image','stylesheet','font','media'].includes(req.resourceType())) req.abort(); else req.continue(); });
      try {
        const products = store.isGoogle ? await scrapeGoogle(page) : await scrapeStore(page, store);
        allProducts.push(...products);
      } catch (e) { console.warn(store.name + ': ' + e.message); }
      await page.close().catch(() => {});
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
    }
  } finally { await browser.close().catch(() => {}); }

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
