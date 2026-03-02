#!/bin/bash
# X/Twitter AI News Fetcher for Newsletter Auto
# Fetches tweets from AI accounts → filters → pushes to Supabase
set -euo pipefail

BIRD="/usr/local/bin/bird"

# Load secrets
SECRETS_FILE="/home/ubuntu/newsletter-auto/.env.secrets"
if [ -f "$SECRETS_FILE" ]; then
  set -a; source "$SECRETS_FILE"; set +a
fi

OUTPUT_DIR="/home/ubuntu/newsletter-auto/x-news-cache"
OUTPUT_FILE="$OUTPUT_DIR/latest.json"

mkdir -p "$OUTPUT_DIR"
echo "[$(date -u)] Starting X AI news fetch..."

python3 << 'PYTHON'
import subprocess, json, re, hashlib, os, time
from datetime import datetime, timezone

OUTPUT_FILE = os.environ.get('OUTPUT_FILE', '/home/ubuntu/newsletter-auto/x-news-cache/latest.json')

AI_ACCOUNTS = [
    'OpenAI', 'AnthropicAI', 'GoogleAI', 'GoogleDeepMind', 'xaborai',
    'sama', 'demaborai', 'kaborai', 'ylecun', 'hardmaru',
    'emaborai', 'aaborai', '_jasonwei', 'DrJimFan',
    'AravSrinivas', 'CursorAI', 'peraborai', 'huggingface',
    'ClaudeAI', 'MistralAI', 'StabilityAI', 'midjourney'
]

AI_KEYWORDS = re.compile(
    r'\bai\b|artificial intelligence|gpt|claude|gemini|llm|openai|anthropic|'
    r'deepmind|machine learning|chatbot|midjourney|stable diffusion|dall-?e|'
    r'sora|copilot|cursor|perplexity|devin|hugging.?face|nvidia|generative|'
    r'foundation model|agi|coding agent|ai agent|ai model|benchmark|'
    r'llama|mistral|deepseek|grok|whisper|diffusion|transformer|neural|'
    r'text.to|image.gen|video.gen|ai tool|ai startup|reasoning|'
    r'fine.?tun|embeddings|rag |vector|multimodal|vision model|'
    r'apple intelligence|meta ai|google ai|amazon ai',
    re.IGNORECASE
)

def make_id(text):
    return hashlib.md5(text.encode()).hexdigest()[:12]

all_tweets = []
for account in AI_ACCOUNTS:
    print(f"[Fetch] @{account}...")
    try:
        r = subprocess.run(['bird', 'user', account, '-n', '5'],
            capture_output=True, text=True, timeout=30)
        
        current = {}
        for line in r.stdout.split('\n'):
            line = line.rstrip()
            if line.startswith('@') and '(' in line:
                if current.get('text'):
                    all_tweets.append(current)
                match = re.match(r'@(\w+) \((.+)\)', line)
                current = {
                    'author': match.group(1) if match else account,
                    'date': match.group(2) if match else '',
                    'text': '', 'likes': 0, 'retweets': 0, 'url': ''
                }
            elif line.startswith('  https://x.com/'):
                current['url'] = line.strip()
            elif line.startswith('  ❤️'):
                m = re.findall(r'(\d+)', line)
                if len(m) >= 2:
                    current['likes'] = int(m[0])
                    current['retweets'] = int(m[1])
            elif line.startswith('  ') and not line.startswith('  📊') and current:
                current['text'] = (current.get('text', '') + ' ' + line.strip()).strip()
        
        if current.get('text'):
            all_tweets.append(current)
            
    except Exception as e:
        print(f"  ⚠️ Failed: {e}")
    time.sleep(1)

print(f"\n[Process] Got {len(all_tweets)} total tweets")

# Filter to AI-relevant
items = []
seen = set()
for t in all_tweets:
    text = t.get('text', '')
    if not AI_KEYWORDS.search(text):
        continue
    key = text[:60].lower()
    if key in seen:
        continue
    seen.add(key)
    items.append({
        'id': make_id(text),
        'text': text[:500],
        'author': t.get('author', 'unknown'),
        'url': t.get('url', ''),
        'engagement': t.get('likes', 0) + t.get('retweets', 0) * 2,
        'source_type': 'x_account',
        'fetched_at': datetime.now(timezone.utc).isoformat()
    })

items.sort(key=lambda x: x['engagement'], reverse=True)

output = {
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'count': len(items),
    'items': items
}
with open(OUTPUT_FILE, 'w') as f:
    json.dump(output, f, indent=2)
print(f"[Done] {len(items)} AI news items saved")
PYTHON

# Push to Supabase
X_SOURCE_ID="${X_SOURCE_ID:-d5ec53f3-063c-4efa-a6b7-f6dd0781aff8}"

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_KEY:-}" ]; then
  echo "[Supabase] ⚠️ SUPABASE_URL or SUPABASE_KEY not set, skipping push"
  exit 0
fi

echo "[$(date -u)] Pushing to Supabase..."

# Delete old X news
curl -s -o /dev/null \
  "${SUPABASE_URL}/rest/v1/news_items?source_id=eq.${X_SOURCE_ID}" \
  -X DELETE \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}"

# Insert new items
python3 -c "
import json, os
with open('${OUTPUT_FILE}') as f:
    data = json.load(f)
source_id = '${X_SOURCE_ID}'
rows = []
for item in data['items'][:20]:
    rows.append({
        'source_id': source_id,
        'url': item.get('url', ''),
        'title': item['text'][:200],
        'raw_summary': item['text'][:500],
        'is_processed': False
    })
print(json.dumps(rows))
" > /tmp/x_ai_news_rows.json

curl -s -o /dev/null -w "Insert: %{http_code}\n" \
  "${SUPABASE_URL}/rest/v1/news_items" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation,resolution=ignore-duplicates" \
  -d @/tmp/x_ai_news_rows.json

rm -f /tmp/x_ai_news_rows.json
echo "[$(date -u)] X AI news fetch complete."
