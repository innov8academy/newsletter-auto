#!/bin/bash
# X/Twitter AI News Fetcher for Newsletter
# Uses bird CLI to pull latest AI news, pushes to Supabase
set -euo pipefail

BIRD="/home/ubuntu/.local/bin/bird"
OUTPUT_DIR="/home/ubuntu/clawd/projects/newsletter-auto/x-news-cache"
OUTPUT_FILE="$OUTPUT_DIR/latest.json"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

mkdir -p "$OUTPUT_DIR"
echo "[$(date -u)] Starting X news fetch..."

# LAYER 1: X's AI-curated trending news
echo "[Layer 1] Fetching X trending AI news..."
$BIRD news --ai-only -n 20 --json > "$TEMP_DIR/trending.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/trending.json"

# LAYER 2: High-engagement AI searches
echo "[Layer 2] Running targeted searches..."
SEARCHES=(
  "AI launch OR release min_faves:500 -is:retweet"
  "GPT OR Claude OR Gemini announcement min_faves:300 -is:retweet"
  "OpenAI OR Anthropic OR Google AI min_faves:500 -is:retweet"
)
search_idx=0
for query in "${SEARCHES[@]}"; do
  $BIRD search "$query" -n 10 --json > "$TEMP_DIR/search_${search_idx}.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/search_${search_idx}.json"
  search_idx=$((search_idx + 1))
  sleep 2
done

# LAYER 3: Key AI accounts
echo "[Layer 3] Fetching from key AI accounts..."
ACCOUNTS=("_akhaliq" "sama" "AnthropicAI" "GoogleAI" "OpenAI")
for account in "${ACCOUNTS[@]}"; do
  $BIRD user-tweets "$account" -n 5 --json > "$TEMP_DIR/account_${account}.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/account_${account}.json"
  sleep 1
done

# Combine all results
echo "[Combine] Merging all sources..."
export TEMP_DIR OUTPUT_FILE
python3 << 'PYTHON'
import json, os, hashlib
from datetime import datetime, timezone

temp_dir = os.environ['TEMP_DIR']
output_file = os.environ['OUTPUT_FILE']
all_items = []

def safe_load(path):
    try:
        with open(path) as f:
            data = json.load(f)
            return data if isinstance(data, list) else data.get('items', data.get('tweets', data.get('results', [])))
    except:
        return []

def make_id(text):
    return hashlib.md5(text.encode()).hexdigest()[:12]

# Process trending items (bird news format: {headline, category, postCount})
for item in safe_load(f"{temp_dir}/trending.json"):
    headline = item.get('headline', '')
    if not headline:
        continue
    all_items.append({
        'id': make_id(headline),
        'text': headline,
        'author': 'X_Trending',
        'url': '',
        'engagement': item.get('postCount', 0) or 0,
        'created_at': item.get('timeAgo', ''),
        'source_type': 'trending',
        'fetched_at': datetime.now(timezone.utc).isoformat()
    })

# Process search results and account tweets (standard tweet format)
for fname in sorted(os.listdir(temp_dir)):
    if not (fname.startswith('search_') or fname.startswith('account_')):
        continue
    source_type = 'search' if fname.startswith('search_') else 'account'
    for tweet in safe_load(f"{temp_dir}/{fname}"):
        if not isinstance(tweet, dict):
            continue
        # Handle bird news format mixed in
        if 'headline' in tweet and 'text' not in tweet:
            all_items.append({
                'id': make_id(tweet['headline']),
                'text': tweet['headline'],
                'author': 'X_Trending',
                'url': '',
                'engagement': tweet.get('postCount', 0) or 0,
                'created_at': '',
                'source_type': 'trending',
                'fetched_at': datetime.now(timezone.utc).isoformat()
            })
            continue
        
        text = tweet.get('text', tweet.get('full_text', ''))
        if not text or text.startswith('RT @'):
            continue
        author = tweet.get('author', tweet.get('username', ''))
        if isinstance(author, dict):
            author = author.get('screen_name', author.get('username', ''))
        tweet_id = str(tweet.get('id', ''))
        likes = int(tweet.get('favorite_count', tweet.get('likes', tweet.get('favoriteCount', 0))) or 0)
        rts = int(tweet.get('retweet_count', tweet.get('retweets', tweet.get('retweetCount', 0))) or 0)
        url = f"https://x.com/{author}/status/{tweet_id}" if author and tweet_id else ''
        
        all_items.append({
            'id': make_id(f"{text[:100]}-{author}"),
            'text': text[:500],
            'author': str(author),
            'url': url,
            'engagement': likes + rts * 2,
            'created_at': tweet.get('created_at', tweet.get('createdAt', '')),
            'source_type': source_type,
            'fetched_at': datetime.now(timezone.utc).isoformat()
        })

# Deduplicate and sort
seen = set()
unique = []
for item in all_items:
    key = item['text'][:80].lower().strip()
    if key not in seen:
        seen.add(key)
        unique.append(item)
unique.sort(key=lambda x: x['engagement'], reverse=True)

output = {
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'count': len(unique),
    'items': unique[:50]
}
with open(output_file, 'w') as f:
    json.dump(output, f, indent=2)
print(f"[Done] {len(unique)} unique items saved (from {len(all_items)} total)")
PYTHON

# Push to Supabase
echo "[$(date -u)] Pushing to Supabase..."
SUPABASE_URL="https://auktufgyxhjrlanclsqh.supabase.co"
SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1a3R1Zmd5eGhqcmxhbmNsc3FoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzcxNjkxNSwiZXhwIjoyMDgzMjkyOTE1fQ.6lXuAQ-YsLMS8WZ9WreKESQ7ZfkYiq2jB4Uo9hvbZDc"
X_SOURCE_ID="d5ec53f3-063c-4efa-a6b7-f6dd0781aff8"

python3 << PYEOF
import json, urllib.request

with open('$OUTPUT_FILE') as f:
    data = json.load(f)

url = "$SUPABASE_URL"
key = "$SUPABASE_KEY"
source_id = "$X_SOURCE_ID"

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

# Insert fresh
rows = []
for item in data['items'][:30]:
    rows.append({
        'source_id': source_id,
        'url': item.get('url') or f"https://x.com/search?q={item['text'][:50]}",
        'title': f"@{item.get('author','unknown')}: {item['text'][:180]}",
        'raw_summary': item['text'][:500],
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
            'Prefer': 'return=representation'
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
