#!/bin/bash
# X/Twitter AI News Fetcher for Newsletter
# SIMPLE: Fetch X's AI-curated trending news → push to Supabase
set -euo pipefail

BIRD="/home/ubuntu/.local/bin/bird"

# Load secrets from env file (NEVER hardcode keys in scripts)
SECRETS_FILE="/home/ubuntu/clawd/projects/newsletter-auto/.env.secrets"
if [ -f "$SECRETS_FILE" ]; then
  set -a; source "$SECRETS_FILE"; set +a
fi

ALEX_AUTH="--auth-token ${ALEX_AUTH_TOKEN} --ct0 ${ALEX_CT0}"
OUTPUT_DIR="/home/ubuntu/clawd/projects/newsletter-auto/x-news-cache"
OUTPUT_FILE="$OUTPUT_DIR/latest.json"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Load OpenRouter key from content-engine if not in secrets
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-$(grep OPENROUTER_API_KEY /home/ubuntu/content-engine/app/.env.local 2>/dev/null | cut -d= -f2)}"

mkdir -p "$OUTPUT_DIR"
echo "[$(date -u)] Starting X news fetch..."

# SOURCE 1: X's AI-curated trending news
echo "[Fetch] Getting X AI curated trending news..."
$BIRD news --ai-only -n 30 --json > "$TEMP_DIR/trending_ai.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/trending_ai.json"
sleep 2

# SOURCE 2: X's general trending (we filter to AI ourselves — catches more)
echo "[Fetch] Getting X general trending news..."
$BIRD news -n 30 --json > "$TEMP_DIR/trending_general.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/trending_general.json"

# Process and save
echo "[Process] Processing trending items..."
export TEMP_DIR OUTPUT_FILE
python3 << 'PYTHON'
import json, os, hashlib
from datetime import datetime, timezone

temp_dir = os.environ['TEMP_DIR']
output_file = os.environ['OUTPUT_FILE']

def safe_load(path):
    try:
        with open(path) as f:
            data = json.load(f)
            return data if isinstance(data, list) else data.get('items', data.get('tweets', data.get('results', [])))
    except:
        return []

def make_id(text):
    return hashlib.md5(text.encode()).hexdigest()[:12]

# AI keyword filter — X trending includes non-AI stuff even with --ai-only
AI_KEYWORDS = {'ai ', ' ai', 'artificial intelligence', 'gpt', 'claude', 'gemini', 'llm',
    'openai', 'anthropic', 'deepmind', 'machine learning', 'chatbot', 'midjourney',
    'stable diffusion', 'dall-e', 'sora', 'copilot', 'cursor', 'perplexity', 'devin',
    'hugging face', 'nvidia', 'robot', 'generative', 'foundation model',
    'agi', 'coding agent', 'ai agent', 'ai model', 'benchmark', 'llama', 'mistral',
    'nano banana', 'imagen', 'flux', 'gemma', 'grok', 'deepseek',
    'image generation', 'video generation', 'text to', 'ai tool', 'ai startup',
    'moonlake', 'whisper', 'diffusion', 'transformer', 'neural', 'autonomous',
    'apple intelligence', 'meta ai', 'google ai', 'amazon ai'}

def is_ai(text):
    t = text.lower()
    return any(kw in t for kw in AI_KEYWORDS)

# Combine both trending feeds and filter to AI-only
all_trending = safe_load(f"{temp_dir}/trending_ai.json") + safe_load(f"{temp_dir}/trending_general.json")
items = []
skipped = 0
for item in all_trending:
    headline = item.get('headline', '')
    if not headline:
        continue
    if not is_ai(headline):
        skipped += 1
        continue
    items.append({
        'id': make_id(headline),
        'text': headline,
        'author': 'X_Trending',
        'url': '',
        'engagement': item.get('postCount', 0) or 0,
        'source_type': 'trending',
        'fetched_at': datetime.now(timezone.utc).isoformat()
    })

if skipped:
    print(f"[Filter] Dropped {skipped} non-AI items")

# Deduplicate
seen = set()
unique = []
for item in items:
    key = item['text'][:60].lower().strip()
    if key not in seen:
        seen.add(key)
        unique.append(item)

# Sort by engagement
unique.sort(key=lambda x: x['engagement'], reverse=True)

output = {
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'count': len(unique),
    'items': unique
}
with open(output_file, 'w') as f:
    json.dump(output, f, indent=2)
print(f"[Done] {len(unique)} trending AI news items saved")
PYTHON

# Push to Supabase
echo "[$(date -u)] Pushing to Supabase..."
SUPABASE_URL="${SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_KEY}"
X_SOURCE_ID="${X_SOURCE_ID:-d5ec53f3-063c-4efa-a6b7-f6dd0781aff8}"

export SUPABASE_URL SUPABASE_KEY X_SOURCE_ID OUTPUT_FILE

python3 << 'PYEOF'
import json, urllib.request, os

output_file = os.environ['OUTPUT_FILE']
url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_KEY']
source_id = os.environ['X_SOURCE_ID']

with open(output_file) as f:
    data = json.load(f)

# Delete old X news first
try:
    req = urllib.request.Request(
        f"{url}/rest/v1/news_items?source_id=eq.{source_id}",
        method='DELETE',
        headers={'apikey': key, 'Authorization': f'Bearer {key}'}
    )
    urllib.request.urlopen(req)
    print("[Supabase] Cleared old X news")
except Exception as e:
    print(f"[Supabase] Delete error: {e}")

# Insert items — headlines are already clean from X trending
rows = []
for idx, item in enumerate(data['items'][:20]):
    headline = item['text'].replace('\n', ' ').strip()[:200]
    item_url = f"https://x.com/search?q={item.get('id', idx)}"
    
    rows.append({
        'source_id': source_id,
        'url': item_url,
        'title': headline,
        'raw_summary': headline,
        'is_processed': False
    })

if rows:
    req = urllib.request.Request(
        f"{url}/rest/v1/news_items",
        data=json.dumps(rows).encode(),
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation,resolution=ignore-duplicates'
        }
    )
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read())
        print(f"[Supabase] Inserted {len(result)} X news items")
    except Exception as e:
        print(f"[Supabase] Insert error: {e}")
else:
    print("[Supabase] No items to insert")
PYEOF

echo "[$(date -u)] X news fetch complete."
