#!/usr/bin/env python3
"""
Clim'Finder — Send email alert for new stock products.
Usage: python3 send-alert-email.py [alert_json_path]

Expects GMAIL_APP_PASSWORD env var.
Reads new_stock_alert.json by default.
"""
import json, os, sys, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

TO = "mickael.faget@gmail.com"
FROM = os.environ.get("GMAIL_USER", TO)
PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

ALERT_FILE = sys.argv[1] if len(sys.argv) > 1 else "data/new_stock_alert.json"

if not PASSWORD:
    print("❌ GMAIL_APP_PASSWORD not set. Export it first.")
    sys.exit(1)

if not os.path.exists(ALERT_FILE):
    print(f"ℹ️ No alert file at {ALERT_FILE}, nothing to send.")
    sys.exit(0)

with open(ALERT_FILE) as f:
    alert = json.load(f)

items = alert.get("items", [])
if not items:
    print("ℹ️ Alert file has no items, skipping.")
    sys.exit(0)

detected = alert.get("detected_at", datetime.now().isoformat())

# Build HTML email
rows = ""
for p in items:
    price = f"{p['price_eur']:.2f}€" if p.get("price_eur") else "?"
    btu = f"{p['btu']}" if p.get("btu") else "—"
    rows += f"""
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">{p['store']}</td>
      <td style="padding:8px;border-bottom:1px solid #eee"><a href="{p['url']}">{p['title'][:100]}</a></td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">{price}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">{btu}</td>
    </tr>"""

html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#2563eb">🌬️ Clim'Finder — {len(items)} nouveau(x) produit(s) en stock</h2>
  <p style="color:#666">Détecté le {detected[:19].replace('T',' à ')}</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px">
    <tr style="background:#f3f4f6">
      <th style="padding:8px;text-align:left">Store</th>
      <th style="padding:8px;text-align:left">Produit</th>
      <th style="padding:8px;text-align:right">Prix</th>
      <th style="padding:8px;text-align:center">BTU</th>
    </tr>
    {rows}
  </table>
  <p style="margin-top:24px;color:#888;font-size:12px">
    Dashboard → <a href="https://fagetm.github.io/clim-snipper/">fagetm.github.io/clim-snipper</a>
  </p>
</body>
</html>"""

msg = MIMEMultipart("alternative")
msg["Subject"] = f"🌬️ Clim'Finder — {len(items)} nouveau(x) climatiseur(s)"
msg["From"] = FROM
msg["To"] = TO
msg.attach(MIMEText(html, "html", "utf-8"))

try:
    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(FROM, PASSWORD)
        server.sendmail(FROM, [TO], msg.as_string())
    print(f"✅ Email sent to {TO} — {len(items)} new product(s)")
except Exception as e:
    print(f"❌ Failed to send email: {e}")
    sys.exit(1)
