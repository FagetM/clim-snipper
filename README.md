# 🌬️ Clim'Finder

Veille automatique de climatiseurs portables neufs en stock dans 5 villes.

**Page** : <https://fagetm.github.io/clim-snipper/>

## Architecture

```
clim-snipper/
├── index.html          ← Dashboard (tout intégré : HTML/CSS/JS)
├── config.json         ← Villes, sources
├── data/stocks.json    ← Résultats auto-générés
├── local-scrape.sh     ← Script de scan local + push
├── scraper/
│   ├── package.json
│   └── index.js        ← Scraper Puppeteer (23 stores)
└── .github/workflows/
    ├── deploy.yml       ← Déploiement Pages
    └── scrape.yml       ← Fallback cloud (manuel)
```

## Fonctionnement

1. **Scraping local** : `local-scrape.sh` → Puppeteer → 23 stores → `stocks.json`
2. **Push sur GitHub** → déclenche `deploy.yml` → GitHub Pages
3. **Cron OpenClaw** : toutes les heures (7h→22h) sur le MacBook
4. **Dashboard** : recherche, filtres ville/stock/prix, blacklist produit, dark mode

## Villes

Bressuire · Parthenay · Thouars · Chinon · Cholet

## Stores

Boulanger · Darty · Cdiscount · Amazon · Fnac · Rakuten · Ubaldi · ManoMano · Google Shopping · Leroy Merlin · Castorama · Carrefour · Auchan · E.Leclerc · Mr Bricolage · Brico Dépôt · But · Conforama · Electro Dépôt · Intermarché · Magasins U · Brico Marché · GiFi
