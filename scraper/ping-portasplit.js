#!/usr/bin/env node
/**
 * PortaSplit availability ping — zero browser, HTTP-only
 * Checks Leroy Merlin FR + Amazon.de for stock changes
 * Runs in <1 second, can be cron'd every 30 min
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'price_history.json');
const STATE_FILE = path.join(__dirname, '..', 'data', '.ping_state.json');

const TARGETS = [
  {
    id: 'leroymerlin',
    label: 'Leroy Merlin FR',
    url: 'https://www.leroymerlin.fr/produits/climatiseur-split-mobile-reversible-portasplit-midea-par-optimea-93857579.html',
    check: (html, status) => {
      if (status === 404) return { available: false, reason: 'Page 404' };
      // Key availability signals
      const hasAddToCart = /ajouter au panier/i.test(html) || /add-to-cart/i.test(html) || /data-test="add-to-cart"/i.test(html);
      const hasIndisponible = /actuellement indisponible/i.test(html) || /indisponible/i.test(html);
      const hasPriceBlock = /999[.,]\d{2}\s*€/i.test(html) || /price/i.test(html);
      
      if (hasAddToCart) return { available: true, reason: 'Bouton panier détecté' };
      if (hasIndisponible && hasPriceBlock) return { available: false, reason: 'Produit listé mais indisponible' };
      if (hasPriceBlock) return { available: false, reason: 'Pas de bouton panier' };
      return { available: false, reason: 'Page inaccessible ou produit retiré' };
    }
  },
  {
    id: 'amazon_de',
    label: 'Amazon.de',
    url: 'https://www.amazon.de/dp/B0D3PP64JS',
    check: (html, status) => {
      if (status !== 200) return { available: false, reason: `HTTP ${status}` };
      const hasBuyBox = /add-to-cart-button|buybox|buy-box|submit\.add-to-cart/i.test(html);
      const hasOutOfStock = /currently unavailable|derzeit nicht verfügbar|out of stock/i.test(html);
      const hasPrice = /(?:EUR|€)\s*[\d.,]+\s*(?:€|EUR)/i.test(html) || /priceblock/i.test(html);
      if (hasBuyBox && !hasOutOfStock) return { available: true, reason: 'Buy box dispo' };
      if (hasPrice && !hasOutOfStock) return { available: true, reason: 'Prix visible' };
      if (hasPrice && hasOutOfStock) return { available: false, reason: 'Prix visible mais pas de stock' };
      if (hasOutOfStock) return { available: false, reason: 'Indisponible' };
      return { available: false, reason: 'Statut incertain' };
    }
  },
  {
    id: 'amazon_fr',
    label: 'Amazon.fr',
    url: 'https://www.amazon.fr/Climatiseur-Climatisation-rafra%C3%AEchisseur-d%C3%A9shumidificateur-ventilateur/dp/B0CY2YW8BT',
    check: (html, status) => {
      if (status !== 200) return { available: false, reason: `HTTP ${status}` };
      const hasBuyBox = /add-to-cart-button|buybox|buy-box|submit\.add-to-cart|acheter/i.test(html);
      const hasOutOfStock = /actuellement indisponible|indisponible|hors stock|rupture|out of stock/i.test(html);
      const hasPrice = /(?:EUR|€)\s*[\d.,]+\s*(?:€|EUR)/i.test(html) || /priceblock/i.test(html);
      const hasAucuneOffre = /aucune offre/i.test(html);
      if (hasAucuneOffre) return { available: false, reason: 'Aucune offre en vedette' };
      if (hasBuyBox && !hasOutOfStock) return { available: true, reason: 'Buy box dispo' };
      if (hasPrice && !hasOutOfStock && !hasAucuneOffre) return { available: true, reason: 'Offre dispo' };
      if (hasOutOfStock || hasAucuneOffre) return { available: false, reason: 'Pas de stock' };
      return { available: false, reason: 'Statut incertain' };
    }
  },
  {
    id: 'idealo_de',
    label: 'Idealo.de',
    url: 'https://www.idealo.de/preisvergleich/OffersOfProduct/210669898_-portasplit-e-12000-btu-midea.html',
    check: (html, status) => {
      if (status !== 200) return { available: false, reason: `HTTP ${status}` };
      const hasOffers = /offerList-item|productOffers-listItem|preisvergleich/i.test(html);
      const hasNoOffers = /keine angebote|no offers|aucune offre/i.test(html);
      // Extract lowest price if present
      const priceMatch = html.match(/(\d{3,4})[.,](\d{2})\s*€/);
      if (hasOffers && !hasNoOffers && priceMatch) {
        const price = parseFloat(priceMatch[1] + '.' + priceMatch[2]);
        return { available: true, reason: `${price}€ — idealo.de` };
      }
      if (hasOffers) return { available: true, reason: 'Offres trouvées' };
      return { available: false, reason: 'Pas d\'offre ou page inaccessible' };
    }
  },
  {
    id: 'manomano_fr',
    label: 'ManoMano.fr',
    url: 'https://www.manomano.fr/p/midea-climatiseur-split-mobile-reversible-froid-chaud-3500w12000btu-wifi-deshumidificateur-ventilateur-jusqua-40m2-kit-fenetre-inclus-83810402',
    check: (html, status) => {
      if (status !== 200) return { available: false, reason: `HTTP ${status}` };
      const hasAddToCart = /ajouter au panier|add-to-cart|add_to_cart/i.test(html);
      const hasPrice = /\d{3,4}[.,]\d{2}\s*€/i.test(html);
      const hasIndisponible = /indisponible|rupture/i.test(html);
      if (hasAddToCart && !hasIndisponible) return { available: true, reason: 'En stock — ajout panier dispo' };
      if (hasPrice && !hasIndisponible) return { available: true, reason: 'Prix visible' };
      if (hasIndisponible) return { available: false, reason: 'Indisponible' };
      return { available: false, reason: 'Statut incertain' };
    }
  },
  {
    id: 'optimea_fr',
    label: 'Optimea.fr (distributeur officiel)',
    url: 'https://www.optimea.fr/product/climatiseur-split-mobile-midea/',
    check: (html, status) => {
      if (status !== 200) return { available: false, reason: `HTTP ${status}` };
      const hasAddToCart = /ajouter au panier|add-to-cart|add_to_cart|single_add_to_cart_button/i.test(html);
      const hasStock = /in_stock|en stock|disponible/i.test(html) && !/rupture|indisponible|out.of.stock/i.test(html);
      const hasPrice = /999[.,]\d{2}\s*€/i.test(html) || /"price":\s*"?999/i.test(html);
      const hasFavorites = /ajouter à la liste|favoris/i.test(html);
      const has10Days = /10 jours/i.test(html);
      if (hasAddToCart && hasStock) return { available: true, reason: 'En stock — ajout panier dispo' };
      if (hasFavorites && !hasAddToCart) return { available: false, reason: 'Page catalogue, pas de vente directe' };
      if (hasPrice && has10Days) return { available: false, reason: 'Prix visible, livraison 10 jours' };
      if (hasPrice) return { available: false, reason: 'Prix visible, statut incertain' };
      return { available: false, reason: 'Statut inconnu' };
    }
  }
];

function fetchUrl(url, label) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const proto = url.startsWith('https') ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': url.includes('.de') ? 'de-DE,de;q=0.9,en;q=0.8' : 'fr-FR,fr;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Connection': 'keep-alive'
    };
    const req = proto.get(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, html: data, timeMs: Date.now() - t0, label });
      });
    });
    req.on('error', (e) => resolve({ status: 0, html: '', timeMs: Date.now() - t0, label, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, html: '', timeMs: Date.now() - t0, label, error: 'timeout' }); });
  });
}

function sendEmailAlert(subject, body) {
  const pw = process.env.GMAIL_APP_PASSWORD;
  if (!pw) return false;
  
  try {
    // Simple shell-out to keep this zero-dep
    const { execSync } = require('child_process');
    const script = `
import json,os,smtplib
from email.mime.text import MIMEText
msg = MIMEText('''${body.replace(/'/g, "\\'")}''','plain','utf-8')
msg['Subject'] = '${subject.replace(/'/g, "\\'")}'
msg['From'] = 'mickael.faget@gmail.com'
msg['To'] = 'mickael.faget@gmail.com'
with smtplib.SMTP('smtp.gmail.com',587) as s:
    s.starttls()
    s.login('mickael.faget@gmail.com','${pw}')
    s.sendmail(msg['From'],[msg['To']],msg.as_string())
print('OK')
`;
    execSync(`python3 -c "${script.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 10000 });
    return true;
  } catch (e) {
    console.error('  ⚠️ Email failed:', e.message);
    return false;
  }
}

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayISO = now.toISOString();
  console.log(`🏓 PortaSplit ping — ${todayISO}\n`);

  // Load previous state
  let prevState = {};
  try { prevState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}

  let changed = false;
  let becameAvailable = false;
  const results = [];

  for (const t of TARGETS) {
    console.log(`🔍 ${t.label}…`);
    const resp = await fetchUrl(t.url, t.label);
    const check = t.check(resp.html, resp.status);
    results.push({
      store: t.label,
      available: check.available,
      reason: check.reason,
      statusCode: resp.status,
      timeMs: resp.timeMs,
      error: resp.error || null
    });
    
    const icon = check.available ? '✅' : '❌';
    console.log(`   ${icon} ${check.reason} (${resp.timeMs}ms, HTTP ${resp.status})`);

    // Detect change
    const prev = prevState[t.id];
    const nowState = { available: check.available, reason: check.reason, checkedAt: todayISO };
    
    if (!prev || prev.available !== nowState.available) {
      changed = true;
      if (nowState.available && !prev?.available) becameAvailable = true;
      console.log(`   🔔 CHANGEMENT : ${prev?.available ? 'dispo' : 'indispo'} → ${nowState.available ? 'dispo' : 'indispo'}`);
    }
    prevState[t.id] = nowState;
  }

  // Save state
  fs.writeFileSync(STATE_FILE, JSON.stringify(prevState, null, 2));

  // Update price history
  let history = { product: 'Midea Portasplit 12000 BTU', currency: 'EUR', history: [] };
  try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) {}

  const existing = history.history.find(h => h.date === today);
  const pingEntry = {
    date: today,
    checkedAt: todayISO,
    sources: results.map(r => ({
      store: r.store,
      available: r.available,
      detail: r.reason,
      httpStatus: r.statusCode
    })),
    note: becameAvailable ? '🟢 PORTASPLIT DISPONIBLE !' : (changed ? 'Changement détecté' : '')
  };

  if (existing) {
    Object.assign(existing, pingEntry);
  } else {
    history.history.push(pingEntry);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  // Email alert on availability
  if (becameAvailable) {
    const availableSources = results.filter(r => r.available).map(r => r.store).join(', ');
    console.log(`\n🎉 PORTASPLIT DISPONIBLE chez ${availableSources} !`);
    sendEmailAlert(
      `🟢 PortaSplit 12000 BTU disponible !`,
      `Le Midea PortaSplit 12000 BTU est maintenant disponible chez : ${availableSources}\n\nDashboard : https://fagetm.github.io/clim-snipper/\n\nDétecté le ${todayISO}`
    );
  }

  const summary = results.map(r => `${r.available ? '✅' : '❌'} ${r.store}: ${r.reason}`).join('\n');
  console.log(`\n📊 Résumé :\n${summary}`);
  console.log(changed ? '\n🔔 Changement détecté !' : '\n😴 Pas de changement.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
