#!/bin/bash
# X/Twitter AI News Fetcher for Newsletter
# Uses bird CLI to pull latest AI news from multiple sources
# Output: JSON file with deduplicated, scored news items

set -euo pipefail

BIRD="/home/ubuntu/.local/bin/bird"
OUTPUT_DIR="/home/ubuntu/clawd/projects/newsletter-auto/x-news-cache"
OUTPUT_FILE="$OUTPUT_DIR/latest.json"
TEMP_DIR=$(mktemp -d)

mkdir -p "$OUTPUT_DIR"

echo "[$(date -u)] Starting X news fetch..."

# ============================================
# LAYER 1: X's AI-curated trending news
# ============================================
echo "[Layer 1] Fetching X trending AI news..."
$BIRD news --ai-only -n 20 --json > "$TEMP_DIR/trending.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/trending.json"

# ============================================
# LAYER 2: Targeted searches (high-engagement AI posts)
# ============================================
echo "[Layer 2] Running targeted searches..."

SEARCHES=(
  "AI launch OR release min_faves:500 -is:retweet"
  "GPT OR Claude OR Gemini OR LLM announcement min_faves:300 -is:retweet"
  "AI tool new min_faves:200 -is:retweet"
  "artificial intelligence breakthrough min_faves:200 -is:retweet"
  "OpenAI OR Anthropic OR Google AI min_faves:500 -is:retweet"
)

search_idx=0
for query in "${SEARCHES[@]}"; do
  $BIRD search "$query" -n 10 --json > "$TEMP_DIR/search_${search_idx}.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/search_${search_idx}.json"
  search_idx=$((search_idx + 1))
  sleep 2  # Rate limit respect
done

# ============================================
# LAYER 3: Key AI accounts (news breakers)
# ============================================
echo "[Layer 3] Fetching from key AI accounts..."

ACCOUNTS=(
  "_akhaliq"        # ML paper/news aggregator
  "sama"            # Sam Altman
  "AnthropicAI"     # Anthropic official
  "GoogleAI"        # Google AI official
  "OpenAI"          # OpenAI official
  "xaborai"         # xAI / Grok
  "rohanpaul_ai"    # AI tutorials/news
  "ai_explained_"   # AI Explained
  "bindaborireddy"  # Abacus AI
)

for account in "${ACCOUNTS[@]}"; do
  $BIRD user-tweets "$account" -n 5 --json > "$TEMP_DIR/account_${account}.json" 2>/dev/null || echo "[]" > "$TEMP_DIR/account_${account}.json"
  sleep 1
done

# ============================================
# Combine all results into one JSON
# ============================================
echo "[Combine] Merging all sources..."

python3 << 'PYTHON'
import json
import os
import hashlib
from datetime import datetime, timezone

temp_dir = os.environ.get('TEMP_DIR', '/tmp')
output_file = os.environ.get('OUTPUT_FILE', '/tmp/latest.json')

all_items = []

def safe_load(path):
    try:
        with open(path) as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            elif isinstance(data, dict):
                # bird news returns { items: [...] } or similar
                return data.get('items', data.get('tweets', data.get('results', [data])))
            return []
    except:
        return []

def extract_tweet_data(tweet, source_type):
    """Normalize tweet data from different bird commands"""
    if not isinstance(tweet, dict):
        return None
    
    # Handle different tweet formats from bird
    text = tweet.get('text', tweet.get('full_text', tweet.get('content', '')))
    if not text:
        return None
    
    # Skip retweets
    if text.startswith('RT @'):
        return None
    
    author = tweet.get('author', tweet.get('user', {}).get('screen_name', tweet.get('username', '')))
    if isinstance(author, dict):
        author = author.get('screen_name', author.get('username', ''))
    
    tweet_id = str(tweet.get('id', tweet.get('id_str', '')))
    
    # Engagement metrics
    likes = tweet.get('favorite_count', tweet.get('likes', tweet.get('favoriteCount', 0))) or 0
    retweets = tweet.get('retweet_count', tweet.get('retweets', tweet.get('retweetCount', 0))) or 0
    
    # Created time
    created = tweet.get('created_at', tweet.get('createdAt', ''))
    
    url = f"https://x.com/{author}/status/{tweet_id}" if author and tweet_id else tweet.get('url', '')
    
    # Generate stable ID
    hash_input = f"{text[:100]}-{author}"
    item_id = hashlib.md5(hash_input.encode()).hexdigest()[:12]
    
    return {
        'id': item_id,
        'tweet_id': tweet_id,
        'text': text[:500],
        'author': author,
        'url': url,
        'likes': int(likes),
        'retweets': int(retweets),
        'engagement': int(likes) + int(retweets) * 2,
        'created_at': created,
        'source_type': source_type,
        'fetched_at': datetime.now(timezone.utc).isoformat()
    }

# Load trending/news
for item in safe_load(f"{temp_dir}/trending.json"):
    result = extract_tweet_data(item, 'trending')
    if result:
        all_items.append(result)

# Load searches
for i in range(5):
    path = f"{temp_dir}/search_{i}.json"
    for item in safe_load(path):
        result = extract_tweet_data(item, 'search')
        if result:
            all_items.append(result)

# Load account tweets
for fname in os.listdir(temp_dir):
    if fname.startswith('account_'):
        for item in safe_load(f"{temp_dir}/{fname}"):
            result = extract_tweet_data(item, 'account')
            if result:
                all_items.append(result)

# Deduplicate by text similarity (first 80 chars)
seen = set()
unique_items = []
for item in all_items:
    key = item['text'][:80].lower().strip()
    if key not in seen:
        seen.add(key)
        unique_items.append(item)

# Sort by engagement (highest first)
unique_items.sort(key=lambda x: x['engagement'], reverse=True)

output = {
    'fetched_at': datetime.now(timezone.utc).isoformat(),
    'count': len(unique_items),
    'items': unique_items[:50]  # Top 50 items
}

with open(output_file, 'w') as f:
    json.dump(output, f, indent=2)

print(f"[Done] {len(unique_items)} unique items saved (from {len(all_items)} total)")
PYTHON

# Cleanup
rm -rf "$TEMP_DIR"

echo "[$(date -u)] Uploading to GitHub Gist..."
gh gist edit 58bd9d2317950e97c41d561081546c05 "$OUTPUT_FILE" 2>/dev/null && echo "[$(date -u)] Gist updated." || echo "[$(date -u)] Gist update failed."

echo "[$(date -u)] X news fetch complete. Output: $OUTPUT_FILE"
