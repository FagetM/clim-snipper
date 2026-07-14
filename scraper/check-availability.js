#!/usr/bin/env node
/**
 * PortaSplit availability checker — Puppeteer, 3 French sources only
 * Detects "Add to cart" button presence (binary signal, no price parsing)
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATE_FILE = path.join(__dirname, '..', 'data', '.availability_state.json');
const STATUS_FILE = path.join(__dirname, '..', 'data', '.availability_status.json');
const GMAIL_PW_FILE = path.join(require('os').homedir(), '.climfinder-gmail');

const TARGETS = [
  {
    id: 'leroymerlin',
    name: 'Leroy Merlin',
    url: 'https://www.leroymerlin.fr/produits/climatiseur-split-mobile-reversible-portasplit-midea-par-optimea-93857579.html',
    async check(page) {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));
      return page.evaluate(() => {
        const btn = document.querySelector(
          'button[class*="add-to-cart"], button[class*="ajouter"], ' +
          'a[class*="add-to-cart"], [data-test="add-to-cart"]'
        );
        const hasBtn = !!btn;
        const unavailable = document.body.innerText.includes('Actuellement indisponible') ||
                           document.body.innerText.includes('indisponible');
        return { hasCartButton: hasBtn, unavailable, pageText: document.body.innerText.substring(0, 1000) };
      });
    }
  },
  {
    id: 'optimea',
    name: 'Optimea',
    url: 'https://www.optimea.fr/product/climatiseur-split-mobile-midea/',
    async check(page) {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));
      return page.evaluate(() => {
        const btn = document.querySelector(
          'button.single_add_to_cart_button, button[class*="add_to_cart"], ' +
          'form.cart button[type="submit"], .woocommerce button[type="submit"]'
        );
        const hasBtn = !!btn;
        const available = document.body.innerText.includes('En stock') ||
                         document.body.innerText.includes('in_stock');
        const outOfStock = document.body.innerText.includes('Rupture') ||
                          document.body.innerText.includes('outofstock');
        return { hasCartButton: hasBtn, available, outOfStock };
      });
    }
  },
  {
    id: 'manomano',
    name: 'ManoMano',
    url: 'https://www.manomano.fr/p/midea-climatiseur-split-mobile-reversible-froid-chaud-3500w12000btu-wifi-deshumidificateur-ventilateur-jusqua-40m2-kit-fenetre-inclus-83810402',
    async check(page) {
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));
      return page.evaluate(() => {
        const btn = document.querySelector(
          'button[class*="add-to-cart"], [data-testid="add-to-cart"], ' +
          'button[class*="btn-cart"], button[class*="purchase"]'
        );
        const hasBtn = !!btn;
        const priceEl = document.querySelector('[class*="price"]');
        const hasPrice = priceEl && /[\d.,]+\s*€/.test(priceEl.textContent);
        const unavailable = document.body.innerText.includes('Indisponible') ||
                           document.body.innerText.includes('rupture');
        return { hasCartButton: hasBtn, hasPrice, unavailable };
      });
    }
  }
];

function sendEmail(subject, body) {
  try {
    let pw = process.env.GMAIL_APP_PASSWORD;
    if (!pw && fs.existsSync(GMAIL_PW_FILE)) {
      pw = fs.readFileSync(GMAIL_PW_FILE, 'utf8').trim();
    }
    if (!pw) { console.log('⚠️  No Gmail password'); return false; }

    const script = `
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
msg = MIMEMultipart('alternative')
msg['Subject'] = '''${subject.replace(/'/g, "\\'")}'''
msg['From'] = 'mickael.faget@gmail.com'
msg['To'] = 'mickael.faget@gmail.com'
html = '''${body.replace(/'/g, "\\'")}'''
msg.attach(MIMEText(html, 'html', 'utf-8'))
with smtplib.SMTP('smtp.gmail.com', 587) as s:
    s.starttls()
    s.login('mickael.faget@gmail.com', '''${pw}''')
    s.sendmail(msg['From'], [msg['To']], msg.as_string())
print('OK')
`;
    execSync(`python3 -c "${script.replace(/"/g, '\\"')}"`, { stdio: 'pipe', timeout: 15000 });
    return true;
  } catch (e) {
    console.log('⚠️  Email failed:', e.message);
    return false;
  }
}

async function main() {
  const now = new Date();
  const iso = now.toISOString();
  console.log(`🔍 PortaSplit check — ${iso}\n`);

  // Load previous state
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}

  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  } catch (e) {
    // Try with npx puppeteer
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], executablePath: undefined });
  }

  const results = [];
  const newAvailable = [];
  const nowAvailable = [];
  const nowUnavailable = [];

  for (const t of TARGETS) {
    console.log(`🔍 ${t.name}…`);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-FR,fr;q=0.9' });
      const data = await t.check(page);
      await page.close();

      const isAvailable = data.hasCartButton || (data.available && !data.outOfStock);
      const reason = isAvailable ? '✅ Bouton panier détecté' :
                     data.unavailable ? '❌ Indisponible' :
                     data.hasPrice ? '⚠️ Prix visible, pas de panier' : '❌ Pas de panier';

      results.push({
        store: t.name,
        available: isAvailable,
        reason,
        checkedAt: iso
      });

      const icon = isAvailable ? '🟢' : '🔴';
      console.log(`   ${icon} ${reason}`);

      // Track changes
      const prevState = prev[t.id];
      if (!prevState || prevState.available !== isAvailable) {
        if (isAvailable) {
          newAvailable.push(t.name);
          console.log(`   🎉 NOUVEAU : DISPONIBLE !`);
        } else if (prevState && prevState.available === true) {
          console.log(`   ⚠️ Était dispo, maintenant plus`);
        }
      }

      if (isAvailable) nowAvailable.push(t.name);
      else nowUnavailable.push(t.name);

      prev[t.id] = { available: isAvailable, reason, checkedAt: iso };
    } catch (e) {
      console.log(`   ❌ Erreur : ${e.message}`);
      prev[t.id] = { available: false, reason: `Error: ${e.message}`, checkedAt: iso };
    }
  }

  await browser.close();
  fs.writeFileSync(STATE_FILE, JSON.stringify(prev, null, 2));

  // Write status JSON for dashboard
  const status = {
    checkedAt: iso,
    stores: results,
    summary: {
      available: nowAvailable.length,
      total: TARGETS.length,
      stores: nowAvailable
    }
  };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));

  console.log(`\n📊 ${nowAvailable.length}/${TARGETS.length} dispo(s)`);
  if (nowAvailable.length > 0) {
    console.log(`🟢 Dispo chez : ${nowAvailable.join(', ')}`);
  }
  if (nowUnavailable.length > 0) {
    console.log(`🔴 Non dispo : ${nowUnavailable.join(', ')}`);
  }

  // Email alert
  if (newAvailable.length > 0) {
    const subject = `🟢 PortaSplit 12000 BTU DISPONIBLE chez ${newAvailable.join(' + ')} !`;
    const body = `<h2>🎉 PortaSplit 12000 BTU disponible !</h2>
<p>Détecté le ${iso}</p>
<p>Magasin(s) : <strong>${newAvailable.join(', ')}</strong></p>
<p><a href="https://fagetm.github.io/clim-snipper/">Dashboard</a></p>`;
    console.log(`\n📧 Envoi email : ${subject}`);
    sendEmail(subject, body);
  }

  // Git push
  try {
    execSync('cd "$(dirname "$0")/.." && git add data/.availability_state.json data/.availability_status.json && git diff --staged --quiet || (git commit -m "🔍 Check — $(date \'+%Y-%m-%d %H:%M\')" && git pull --rebase && git push)', {
      cwd: __dirname,
      stdio: 'pipe',
      timeout: 30000,
      shell: true
    });
    console.log('✅ Pushed');
  } catch (e) {
    console.log('⚠️  Git push skipped');
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
