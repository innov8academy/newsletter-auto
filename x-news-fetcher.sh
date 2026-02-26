#!/bin/bash
# X/Twitter AI News Fetcher for Newsletter
# Uses bird CLI to pull latest AI news, pushes to Supabase
# v2: Topic clustering, recency boost, AI-powered headline rewriting
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

# Load API key from env file (NEVER hardcode keys)
OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-$(grep OPENROUTER_API_KEY /home/ubuntu/content-engine/app/.env.local 2>/dev/null | cut -d= -f2)}"
HISTORY_FILE="$OUTPUT_DIR/shown_history.json"

mkdir -p "$OUTPUT_DIR"
echo "[$(date -u)] Starting X news fetch (using Alex's AI-primed feed)..."

# LAYER 0: Alex's "For You" feed (best signal — algorithm-curated for AI)
echo "[Layer 0] Fetching Alex's For You feed (50 items)..."
$BIRD $ALEX_AUTH home -n 50 --json > "$TEMP_DIR/home_feed.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/home_feed.json"
sleep 2

# LAYER 1: "Following" feed (chronological — catches things algorithm might miss)
echo "[Layer 1] Fetching Alex's Following feed..."
$BIRD $ALEX_AUTH home --following -n 30 --json > "$TEMP_DIR/following_feed.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/following_feed.json"
sleep 2

# LAYER 2: X's AI-curated trending news  
echo "[Layer 2] Fetching X trending AI news..."
$BIRD news --ai-only -n 20 --json > "$TEMP_DIR/trending.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/trending.json"

# LAYER 3: Targeted searches — more specific to catch launches
echo "[Layer 3] Running targeted searches..."
SEARCHES=(
  "AI launch OR AI release OR AI update min_faves:200 -is:retweet"
  "Perplexity OR Cursor OR Claude OR Gemini new min_faves:100 -is:retweet"
  "OpenAI OR Anthropic OR Google AI announcing min_faves:200 -is:retweet"
  "AI agent OR AI tool launched today min_faves:100 -is:retweet"
)
search_idx=0
for query in "${SEARCHES[@]}"; do
  $BIRD $ALEX_AUTH search "$query" -n 10 --json > "$TEMP_DIR/search_${search_idx}.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/search_${search_idx}.json"
  search_idx=$((search_idx + 1))
  sleep 2
done

# LAYER 4: Key AI accounts
echo "[Layer 4] Fetching from key AI accounts..."
ACCOUNTS=("_akhaliq" "sama" "AnthropicAI" "GoogleAI" "OpenAI" "perplexity_ai" "cursor_ai" "AravSrinivas" "karpathy" "cognition")
for account in "${ACCOUNTS[@]}"; do
  $BIRD $ALEX_AUTH user-tweets "$account" -n 5 --json > "$TEMP_DIR/account_${account}.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/account_${account}.json"
  sleep 1
done

# Combine, cluster, rank, and rewrite with AI
echo "[Combine] Merging all sources..."
export TEMP_DIR OUTPUT_FILE OPENROUTER_API_KEY HISTORY_FILE
python3 << 'PYTHON'
import json, os, hashlib, re, urllib.request, time
from datetime import datetime, timezone, timedelta

temp_dir = os.environ['TEMP_DIR']
output_file = os.environ['OUTPUT_FILE']
openrouter_key = os.environ.get('OPENROUTER_API_KEY', '')
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

def parse_relative_time(time_str):
    """Parse relative time strings like '13 hours ago', '2 days ago' into datetime"""
    if not time_str or not isinstance(time_str, str):
        return None
    now = datetime.now(timezone.utc)
    m = re.match(r'(\d+)\s*(second|minute|hour|day|week|month)s?\s*ago', time_str.lower())
    if m:
        val, unit = int(m.group(1)), m.group(2)
        deltas = {'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400, 'week': 604800, 'month': 2592000}
        return now - timedelta(seconds=val * deltas.get(unit, 86400))
    # Try ISO format
    for fmt in ['%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%dT%H:%M:%S.%f%z', '%a %b %d %H:%M:%S %z %Y']:
        try:
            return datetime.strptime(time_str, fmt)
        except:
            pass
    return None

def hours_ago(dt):
    """Return how many hours ago a datetime was"""
    if not dt:
        return 48  # default: treat as old
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (now - dt).total_seconds() / 3600

def extract_tweet(tweet, source_type, boost=0):
    """Extract a normalized item from a tweet dict"""
    if not isinstance(tweet, dict):
        return None
    text = tweet.get('text', tweet.get('full_text', ''))
    if not text or text.startswith('RT @'):
        return None
    author = tweet.get('author', tweet.get('username', ''))
    if isinstance(author, dict):
        author = author.get('screen_name', author.get('username', ''))
    tweet_id = str(tweet.get('id', ''))
    likes = int(tweet.get('favorite_count', tweet.get('likes', tweet.get('favoriteCount', 0))) or 0)
    rts = int(tweet.get('retweet_count', tweet.get('retweets', tweet.get('retweetCount', 0))) or 0)
    url = f"https://x.com/{author}/status/{tweet_id}" if author and tweet_id else ''
    created_at = tweet.get('created_at', tweet.get('createdAt', ''))
    
    return {
        'id': make_id(f"{text[:100]}-{author}"),
        'text': text[:500],
        'author': str(author),
        'url': url,
        'raw_engagement': likes + rts * 2,
        'engagement': likes + rts * 2 + boost,
        'created_at': created_at,
        'created_dt': parse_relative_time(created_at),
        'source_type': source_type,
        'fetched_at': datetime.now(timezone.utc).isoformat()
    }

# Process home feed
for tweet in safe_load(f"{temp_dir}/home_feed.json"):
    item = extract_tweet(tweet, 'home_feed', boost=100)
    if item:
        all_items.append(item)

# Process following feed
for tweet in safe_load(f"{temp_dir}/following_feed.json"):
    item = extract_tweet(tweet, 'following_feed', boost=50)
    if item:
        all_items.append(item)

# Process trending items
for item in safe_load(f"{temp_dir}/trending.json"):
    headline = item.get('headline', '')
    if not headline:
        continue
    all_items.append({
        'id': make_id(headline),
        'text': headline,
        'author': 'X_Trending',
        'url': '',
        'raw_engagement': item.get('postCount', 0) or 0,
        'engagement': item.get('postCount', 0) or 0,
        'created_at': item.get('timeAgo', ''),
        'created_dt': parse_relative_time(item.get('timeAgo', '')),
        'source_type': 'trending',
        'fetched_at': datetime.now(timezone.utc).isoformat()
    })

# Process search results and account tweets
for fname in sorted(os.listdir(temp_dir)):
    if not (fname.startswith('search_') or fname.startswith('account_')):
        continue
    source_type = 'search' if fname.startswith('search_') else 'account'
    for tweet in safe_load(f"{temp_dir}/{fname}"):
        if not isinstance(tweet, dict):
            continue
        if 'headline' in tweet and 'text' not in tweet:
            all_items.append({
                'id': make_id(tweet['headline']),
                'text': tweet['headline'],
                'author': 'X_Trending',
                'url': '',
                'raw_engagement': tweet.get('postCount', 0) or 0,
                'engagement': tweet.get('postCount', 0) or 0,
                'created_at': '',
                'created_dt': None,
                'source_type': 'trending',
                'fetched_at': datetime.now(timezone.utc).isoformat()
            })
            continue
        item = extract_tweet(tweet, source_type)
        if item:
            all_items.append(item)

# Filter: only keep AI-related items
STRONG_AI_KEYWORDS = {'ai ', ' ai', 'artificial intelligence', 'gpt', 'claude', 'gemini', 'llm', 
    'openai', 'anthropic', 'deepmind', 'machine learning', 'chatbot', 'midjourney', 
    'stable diffusion', 'dall-e', 'sora', 'copilot', 'cursor', 'perplexity', 'devin',
    'hugging face', 'nvidia', 'gpu', 'robot', 'generative ai', 'foundation model',
    'agi', 'coding agent', 'ai agent', 'ai model', 'benchmark', 'llama', 'mistral',
    'nano banana', 'imagen', 'flux', 'gemma', 'phi-', 'grok', 'deepseek',
    'text to image', 'text-to-image', 'image generation', 'video generation',
    'coding assistant', 'ai tool', 'ai startup', 'ai company', 'ai safety'}

def is_ai_related(text):
    t = text.lower()
    return any(kw in t for kw in STRONG_AI_KEYWORDS)

ai_items = [item for item in all_items if is_ai_related(item['text'])]
print(f"[Filter] {len(ai_items)} AI-related items out of {len(all_items)} total")

# ---- TOPIC CLUSTERING ----
# Group items talking about the same thing, boost the cluster
def get_topic_keywords(text):
    """Extract key noun phrases for clustering"""
    t = text.lower()
    # Remove common words and URLs
    t = re.sub(r'https?://\S+', '', t)
    t = re.sub(r'@\w+', '', t)
    # Known product/topic names to cluster on
    topics = [
        'nano banana', 'perplexity computer', 'gemini 3', 'gemini 3.1', 'claude opus',
        'cursor', 'devin', 'evmbench', 'moonlake', 'grok', 'deepseek', 'llama',
        'sora', 'imagen', 'flux', 'o4', 'o3', 'codex', 'copilot', 'gemma',
        'vercept', 'anthropic acqui', 'nvidia partner', 'openai o', 'google ai studio',
    ]
    found = []
    for topic in topics:
        if topic in t:
            found.append(topic)
    return found if found else None

# Build clusters
clusters = {}  # topic -> list of items
unclustered = []

for item in ai_items:
    topics = get_topic_keywords(item['text'])
    if topics:
        primary_topic = topics[0]
        if primary_topic not in clusters:
            clusters[primary_topic] = []
        clusters[primary_topic].append(item)
    else:
        unclustered.append(item)

# For each cluster, pick best item and boost it
clustered_items = []
for topic, items in clusters.items():
    # Sort by raw engagement
    items.sort(key=lambda x: x['raw_engagement'], reverse=True)
    best = items[0].copy()
    # Cluster boost: more mentions = more important news
    cluster_size = len(items)
    cluster_boost = min(cluster_size * 200, 2000)  # Up to 2000 boost for 10+ mentions
    # Sum engagement across cluster
    total_engagement = sum(i['raw_engagement'] for i in items)
    best['engagement'] = total_engagement + cluster_boost
    best['cluster_size'] = cluster_size
    best['cluster_topic'] = topic
    # Collect all URLs from cluster for reference
    best['cluster_urls'] = [i['url'] for i in items if i.get('url')][:5]
    clustered_items.append(best)
    if cluster_size > 1:
        print(f"  [Cluster] '{topic}': {cluster_size} items, boosted to {best['engagement']}")

# Add unclustered items
for item in unclustered:
    item['cluster_size'] = 1
    item['cluster_topic'] = ''
    item['cluster_urls'] = [item.get('url', '')]
    clustered_items.append(item)

# ---- HARD 24H CUTOFF ----
# Only keep items from the last 24 hours. Old viral tweets = noise.
fresh_items = []
stale_count = 0
for item in clustered_items:
    h = hours_ago(item.get('created_dt'))
    if h > 24:
        stale_count += 1
        continue  # DROP anything older than 24h
    # Recency boost within 24h window
    if h < 3:
        item['engagement'] = int(item['engagement'] * 3.0)
        item['recency'] = 'breaking'
    elif h < 6:
        item['engagement'] = int(item['engagement'] * 2.5)
        item['recency'] = 'fresh'
    elif h < 12:
        item['engagement'] = int(item['engagement'] * 2.0)
        item['recency'] = 'today'
    else:
        item['engagement'] = int(item['engagement'] * 1.5)
        item['recency'] = 'recent'
    fresh_items.append(item)

if stale_count:
    print(f"  [Recency] Dropped {stale_count} items older than 24h")

# ---- HISTORY DEDUP ----
# Don't show news we've already pushed to Supabase before
history_file = os.environ.get('HISTORY_FILE', '')
shown_titles = set()
if history_file:
    try:
        with open(history_file) as f:
            history = json.load(f)
        # Keep last 7 days of history
        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        history = [h for h in history if h.get('shown_at', '') > cutoff]
        shown_titles = {h['key'] for h in history}
        print(f"  [History] Loaded {len(shown_titles)} previously shown items")
    except:
        history = []
else:
    history = []

# Deduplicate by text similarity + history
seen = set()
unique = []
for item in fresh_items:
    key = item['text'][:80].lower().strip()
    # Also check cluster topic as history key
    cluster_key = item.get('cluster_topic', '')
    if key in seen:
        continue
    if key in shown_titles or (cluster_key and cluster_key in shown_titles):
        continue
    seen.add(key)
    unique.append(item)

unique.sort(key=lambda x: x['engagement'], reverse=True)
print(f"  [History] {len(fresh_items) - len(unique)} items filtered as already shown")

# Clean up items for JSON serialization (remove datetime objects)
for item in unique:
    if 'created_dt' in item:
        del item['created_dt']

output = {
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'count': len(unique),
    'items': unique[:50]
}
with open(output_file, 'w') as f:
    json.dump(output, f, indent=2)
print(f"[Done] {len(unique)} unique items saved (from {len(all_items)} total)")
PYTHON

# ---- AI HEADLINE REWRITING ----
# Use OpenRouter to turn raw tweets into clean, professional news headlines
echo "[AI Rewrite] Generating clean headlines..."
python3 << 'PYEOF'
import json, urllib.request, os

output_file = os.environ['OUTPUT_FILE']
openrouter_key = os.environ.get('OPENROUTER_API_KEY', '')

with open(output_file) as f:
    data = json.load(f)

top_items = data['items'][:20]
if not top_items or not openrouter_key:
    print("[AI Rewrite] Skipped (no key or no items)")
    exit(0)

# Build the prompt with all items
items_text = ""
for i, item in enumerate(top_items):
    cluster_info = f" [{item.get('cluster_size', 1)} sources]" if item.get('cluster_size', 1) > 1 else ""
    items_text += f"{i+1}. @{item['author']}: {item['text'][:300]}{cluster_info}\n\n"

prompt = f"""You are an AI news editor for a tech newsletter. Rewrite these raw X/Twitter posts into clean, professional news headlines + one-line summaries.

Rules:
- Each headline should be clear, informative, and newsworthy
- Include the key product/company name
- If multiple sources mention the same thing, that's BIG news — make the headline reflect its importance
- Keep each headline under 80 chars
- Keep each summary under 150 chars
- Output JSON array: [{{"idx": 1, "headline": "...", "summary": "..."}}]
- Only output the JSON, nothing else

Raw posts:
{items_text}"""

try:
    req_data = json.dumps({
        "model": "google/gemini-2.0-flash-001",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2000,
        "temperature": 0.3
    }).encode()

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=req_data,
        headers={
            'Authorization': f'Bearer {openrouter_key}',
            'Content-Type': 'application/json'
        }
    )
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    content = result['choices'][0]['message']['content']
    
    # Parse JSON from response (handle markdown code blocks)
    content = content.strip()
    if content.startswith('```'):
        content = content.split('\n', 1)[1]
        content = content.rsplit('```', 1)[0]
    
    rewrites = json.loads(content)
    
    # Apply rewrites to items
    for rw in rewrites:
        idx = rw.get('idx', 0) - 1
        if 0 <= idx < len(top_items):
            top_items[idx]['ai_headline'] = rw.get('headline', '')
            top_items[idx]['ai_summary'] = rw.get('summary', '')
    
    # Save back
    data['items'][:20] = top_items
    with open(output_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    rewritten = sum(1 for i in top_items if i.get('ai_headline'))
    print(f"[AI Rewrite] {rewritten}/{len(top_items)} items rewritten")

except Exception as e:
    print(f"[AI Rewrite] Error: {e}")
    # Continue without rewrites — raw data still works
PYEOF

# Push to Supabase
echo "[$(date -u)] Pushing to Supabase..."
# Secrets loaded from .env.secrets at top of script
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

# Insert top 20 (up from 15)
rows = []
for idx, item in enumerate(data['items'][:20]):
    # Use AI headline if available, otherwise clean the raw text
    headline = item.get('ai_headline', '')
    summary = item.get('ai_summary', '')
    
    if not headline:
        text = item['text'].replace('\n', ' ').strip()
        headline = text.split('. ')[0][:150]
        author = item.get('author', 'unknown')
        headline = f"@{author}: {headline}"
    
    if not summary:
        summary = item['text'].replace('\n', ' ').strip()[:500]
    
    # Ensure unique URL (Supabase has unique constraint)
    item_url = item.get('url') or (item.get('cluster_urls', [''])[0] if item.get('cluster_urls') else '')
    if not item_url:
        item_url = f"https://x.com/search?q={item.get('id', idx)}"
    
    rows.append({
        'source_id': source_id,
        'url': item_url,
        'title': headline,
        'raw_summary': summary,
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

# Update shown history
echo "[History] Updating shown history..."
python3 << 'HISTEOF'
import json, os
from datetime import datetime, timezone, timedelta

history_file = os.environ.get('HISTORY_FILE', '')
output_file = os.environ['OUTPUT_FILE']
if not history_file:
    exit(0)

# Load existing history
try:
    with open(history_file) as f:
        history = json.load(f)
except:
    history = []

# Keep last 7 days only
cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
history = [h for h in history if h.get('shown_at', '') > cutoff]

# Add newly shown items
with open(output_file) as f:
    data = json.load(f)

now = datetime.now(timezone.utc).isoformat()
for item in data['items'][:20]:
    key = item['text'][:80].lower().strip()
    history.append({'key': key, 'shown_at': now})
    # Also track cluster topic
    if item.get('cluster_topic'):
        history.append({'key': item['cluster_topic'], 'shown_at': now})

with open(history_file, 'w') as f:
    json.dump(history, f)
print(f"[History] Saved {len(history)} entries")
HISTEOF

echo "[$(date -u)] X news fetch complete."
