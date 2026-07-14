#!/bin/bash
# PortaSplit price tracker — light, no model calls, just node + push
set -e
cd "$(dirname "$0")"
echo "🎯 PortaSplit tracker — $(date '+%Y-%m-%d %H:%M')"
cd scraper && node track-portasplit.js && cd ..

# Check if price changed vs yesterday
python3 -c "
import json
with open('data/price_history.json') as f:
    h = json.load(f)['history']
if len(h) >= 2:
    today = h[-1].get('lowest_new')
    yesterday = h[-2].get('lowest_new')
    if today and yesterday:
        print(f'Today={today}€ Yesterday={yesterday}€')
        if today < yesterday:
            print('TRIGGER_PRICE_DROP')
" 2>/dev/null | tee /tmp/portasplit-check.log

# Git
git add data/price_history.json 2>/dev/null || true
if ! git diff --staged --quiet; then
  git commit -m "🎯 PortaSplit tracker — $(date '+%Y-%m-%d %H:%M')"
  git pull --rebase 2>/dev/null || git rebase --abort
  git push --force-with-lease 2>/dev/null
  echo "✅ Pushed"

  # Email alert on price drop
  if grep -q "TRIGGER_PRICE_DROP" /tmp/portasplit-check.log; then
    echo "📧 Sending price drop alert..."
    if [ -f "$HOME/.climfinder-gmail" ]; then
      export GMAIL_APP_PASSWORD="$(cat "$HOME/.climfinder-gmail")"
    fi
    python3 -c "
import json,os,smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

with open('data/price_history.json') as f:
    h = json.load(f)['history']
today = h[-1]
yesterday = h[-2]
drop = yesterday['lowest_new'] - today['lowest_new']
pct = round(drop/yesterday['lowest_new']*100)

html = f'''<h2>🔔 PortaSplit price drop!</h2>
<p>From {yesterday['lowest_new']}€ to <strong>{today['lowest_new']}€</strong> (-{pct}%)</p>
<p>Store: {today['lowest_store']}</p>
<p><a href=\"https://fagetm.github.io/clim-snipper/\">Dashboard</a></p>'''

msg = MIMEMultipart('alternative')
msg['Subject'] = f'🔔 PortaSplit {today[\"lowest_new\"]}€ (-{pct}%)'
msg['From'] = os.environ.get('GMAIL_USER','mickael.faget@gmail.com')
msg['To'] = 'mickael.faget@gmail.com'
msg.attach(MIMEText(html,'html','utf-8'))

with smtplib.SMTP('smtp.gmail.com',587) as s:
    s.starttls()
    s.login(msg['From'], os.environ['GMAIL_APP_PASSWORD'])
    s.sendmail(msg['From'],[msg['To']],msg.as_string())
print('✅ Email sent')
" 2>&1 || echo "⚠️ Email failed"
  fi
else
  echo "✅ No changes"
fi
