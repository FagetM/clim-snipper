(function () {
  'use strict';

  const DATA_URL = 'data/stocks.json';
  let allProducts = [];
  let currentFilter = 'all';

  // ── DOM refs ──
  const grid = document.getElementById('productsGrid');
  const lastUpdate = document.getElementById('lastUpdate');
  const totalCount = document.getElementById('totalCount');
  const footerTime = document.getElementById('footerTime');
  const summaryCards = document.getElementById('summaryCards');
  const priceSort = document.getElementById('priceSort');

  // ── Fetch data ──
  async function loadData() {
    try {
      const resp = await fetch(DATA_URL + '?t=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      allProducts = data.products || [];
      render();
    } catch (err) {
      console.warn('Failed to load stocks data:', err);
      grid.innerHTML = `<div class="empty-state">
        <div class="emoji">📡</div>
        <h2>Données non disponibles</h2>
        <p>Le fichier de stocks n'a pas encore été généré. Il le sera au premier scan automatique.</p>
      </div>`;
      lastUpdate.textContent = 'Aucune donnée';
    }
  }

  // ── Filters ──
  function getFiltered() {
    let list = [...allProducts];

    if (currentFilter === 'stock') {
      list = list.filter(p => p.status === 'in_stock' || p.status === 'low_stock');
    } else if (currentFilter === 'tours') {
      list = list.filter(p => p.availability_type === 'tours' || p.availability_type === 'both');
    } else if (currentFilter === 'livraison') {
      list = list.filter(p => p.availability_type === 'delivery' || p.availability_type === 'both');
    }

    const sort = priceSort.value;
    if (sort === 'asc') list.sort((a, b) => (a.price_eur || 99999) - (b.price_eur || 99999));
    else if (sort === 'desc') list.sort((a, b) => (b.price_eur || 0) - (a.price_eur || 0));

    return list;
  }

  // ── Time formatting ──
  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' });
  }

  function fmtRelative(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'à l'instant';
    if (mins < 60) return `il y a ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    return `il y a ${Math.floor(hrs / 24)}j`;
  }

  // ── Status badge ──
  function statusTag(p) {
    const map = {
      in_stock: '<span class="tag in-stock">✅ En stock</span>',
      low_stock: '<span class="tag low-stock">⚠️ Stock faible</span>',
      out_of_stock: '<span class="tag out-of-stock">❌ Rupture</span>',
      unknown: '<span class="tag out-of-stock">❓ Inconnu</span>'
    };
    return map[p.status] || map.unknown;
  }

  function availTag(p) {
    const tags = [];
    if (p.availability_type === 'tours' || p.availability_type === 'both') {
      tags.push('<span class="tag tours">📍 Tours</span>');
    }
    if (p.availability_type === 'delivery' || p.availability_type === 'both') {
      tags.push('<span class="tag delivery">🚚 Livraison</span>');
    }
    if (p.delivery_info) {
      tags.push(`<span class="tag delivery">${escapeHtml(p.delivery_info)}</span>`);
    }
    return tags.join(' ');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Render ──
  function render() {
    const filtered = getFiltered();
    const inStock = allProducts.filter(p => p.status === 'in_stock' || p.status === 'low_stock').length;
    const outOfStock = allProducts.filter(p => p.status === 'out_of_stock' || p.status === 'unknown').length;
    const toursCount = allProducts.filter(p => p.availability_type === 'tours' || p.availability_type === 'both').length;
    const deliveryCount = allProducts.filter(p => p.availability_type === 'delivery' || p.availability_type === 'both').length;
    const scanTime = allProducts.length > 0 ? allProducts[0].scanned_at : null;

    // Status bar
    if (scanTime) {
      lastUpdate.textContent = `🕐 Scanné ${fmtRelative(scanTime)}`;
      footerTime.textContent = fmtTime(scanTime);
    } else {
      lastUpdate.textContent = 'Aucune donnée';
      footerTime.textContent = '—';
    }
    totalCount.textContent = `${allProducts.length} produits référencés`;

    // Summary cards
    summaryCards.innerHTML = `
      <div class="summary-card">
        <div class="count ${inStock > 0 ? 'green' : 'red'}">${inStock}</div>
        <div class="label">En stock</div>
      </div>
      <div class="summary-card">
        <div class="count">${outOfStock}</div>
        <div class="label">En rupture</div>
      </div>
      <div class="summary-card">
        <div class="count">${toursCount}</div>
        <div class="label">Dispo Tours</div>
      </div>
      <div class="summary-card">
        <div class="count">${deliveryCount}</div>
        <div class="label">Livraison</div>
      </div>
    `;

    // Products
    if (filtered.length === 0) {
      grid.innerHTML = `<div class="empty-state">
        <div class="emoji">😔</div>
        <h2>Aucun résultat</h2>
        <p>${currentFilter === 'stock' ? 'Aucune clim en stock pour le moment. Reviens plus tard !' : 'Aucun produit ne correspond à ce filtre.'}</p>
      </div>`;
      return;
    }

    grid.innerHTML = filtered.map(p => `
      <div class="product-card">
        <span class="store-badge">${escapeHtml(p.store)}</span>
        <h3>${escapeHtml(p.title)}</h3>
        ${p.brand ? `<div class="details">${escapeHtml(p.brand)}${p.model ? ' — ' + escapeHtml(p.model) : ''}${p.btu ? ' · ' + escapeHtml(p.btu) : ''}</div>` : ''}
        <div class="price">${p.price_eur != null ? p.price_eur.toLocaleString('fr-FR') + ' €' : 'Prix non dispo'}</div>
        <div class="availability">
          ${statusTag(p)}
          ${availTag(p)}
        </div>
        ${p.stock_info ? `<div class="details">${escapeHtml(p.stock_info)}</div>` : ''}
        <div class="link">
          <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Voir l'offre →</a>
        </div>
        <div class="last-seen">Vu ${fmtRelative(p.last_seen_at || p.scanned_at)}</div>
      </div>
    `).join('');
  }

  // ── Filter buttons ──
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  priceSort.addEventListener('change', render);

  // ── Auto-refresh every 15 min ──
  loadData();
  setInterval(loadData, 15 * 60 * 1000);
})();
