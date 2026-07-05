# 🌬️ Clim'Finder

Application de veille pour trouver des climatiseurs portables en stock à Tours ou en livraison.

## Fonctionnalités

- **Scan automatique** toutes les heures de 7h à 22h (heure française)
- **7 sites surveillés** : Darty, Boulanger, Leroy Merlin, Castorama, Cdiscount, Amazon, Electro Dépôt, Conforama
- **Filtres** : en stock / Tours / livraison
- **Tri par prix**
- **Historique** : détection des nouveaux produits en stock
- **Page statique** déployée sur GitHub Pages

## Déploiement

1. Crée un repo GitHub et pousse ce dossier :

```bash
cd clim-finder
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:TON_COMPTE/clim-finder.git
git push -u origin main
```

2. Dans les paramètres du repo GitHub :
   - **Settings → Pages** → Source : `GitHub Actions`
   - **Settings → Actions → General** → Workflow permissions : `Read and write permissions`

3. Le premier scan démarre automatiquement. La page sera dispo sur `https://TON_COMPTE.github.io/clim-finder/`

4. Pour tester : **Actions → Scan Stocks & Deploy → Run workflow**

## Structure

```
clim-finder/
├── index.html          # Page web statique
├── style.css           # Styles dark mode
├── script.js           # Logique frontend (filtres, rendu)
├── data/
│   └── stocks.json     # Résultats du scan (auto-généré)
├── scraper/
│   ├── package.json
│   └── index.js        # Scraper Node.js
└── .github/
    └── workflows/
        └── scrape.yml  # GitHub Action (scan + déploiement)
```
