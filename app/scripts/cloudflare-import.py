#!/usr/bin/env python3
"""Import only reusable L8R style metadata and writing examples into a fresh Worker.

Dry run is the default. No Supabase mutation, image transfer, or cloud call occurs
unless --apply is supplied. Uses only the Python standard library.
"""

import argparse
import csv
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "tmp" / "cloudflare-migration" / "source"
EXPECTED_SOURCE_ROWS = 38
TABLES = (
    "studio_drafts", "studio_story_workspaces", "studio_assets", "studio_style_packs",
    "studio_generations", "studio_usage_events", "shared_news_selection",
    "newsletter_versions", "past_newsletters", "news_items", "used_stories",
)
PACK_COLUMNS = ("id", "slug", "version", "payload", "active", "created_at")
ASSET_COLUMNS = ("id", "draft_id", "role", "checksum", "payload", "created_at")
EXAMPLE_COLUMNS = ("id", "title", "file_name", "content_html", "content_text", "imported_at")
JSON_COLUMNS = {"payload"}
UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class ImportFailure(Exception):
    """A safe, content-free validation or transport failure."""


def read_csv(path, headers):
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != list(headers):
                raise ImportFailure("backup columns do not match")
            result = list(reader)
        if any(None in row or any(value is None for value in row.values()) for row in result):
            raise ImportFailure("backup has malformed CSV rows")
        return result
    except (OSError, UnicodeError, csv.Error) as exc:
        raise ImportFailure("backup cannot be read") from exc


def decode(value):
    try:
        result = json.loads(value, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (TypeError, ValueError) as exc:
        raise ImportFailure("backup contains invalid JSON") from exc
    if not isinstance(result, dict):
        raise ImportFailure("backup JSON must be an object")
    return result


def require_id(value):
    if not isinstance(value, str) or not UUID_PATTERN.fullmatch(value):
        raise ImportFailure("backup contains an invalid ID")
    try:
        uuid.UUID(value)
    except ValueError as exc:
        raise ImportFailure("backup contains an invalid ID") from exc
    return value


def compact(value):
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ImportFailure("backup has a non-JSON value") from exc


def insert(table, columns, record):
    params = []
    for name in columns:
        if name not in record:
            raise ImportFailure("backup is missing required fields")
        value = record[name]
        if name in JSON_COLUMNS:
            value = compact(value)
        elif name == "active":
            if type(value) is not bool:
                raise ImportFailure("backup has an invalid active flag")
            value = int(value)
        elif not (value is None or isinstance(value, (str, int, float)) and not isinstance(value, bool)):
            raise ImportFailure("backup field has an invalid type")
        params.append(value)
    placeholders = ",".join("?" for _ in columns)
    return {"sql": f"INSERT INTO {table}({','.join(columns)}) VALUES({placeholders})", "params": params}


def plan(source):
    rows = read_csv(source / "current-studio-records.csv", ("table_name", "payload"))
    if len(rows) != EXPECTED_SOURCE_ROWS:
        raise ImportFailure("backup row count does not match")
    records = []
    for entry in rows:
        if entry["table_name"] not in TABLES:
            raise ImportFailure("backup has an unknown table")
        records.append((entry["table_name"], decode(entry["payload"])))
    packs = [record for table, record in records if table == "studio_style_packs"]
    examples = [record for table, record in records if table == "past_newsletters"]
    assets = [record for table, record in records if table == "studio_assets" and record.get("role") == "style" and record.get("draft_id") is None]
    if len(packs) != 1 or len(assets) != 3 or len(examples) != 3:
        raise ImportFailure("backup reusable record counts do not match")
    pack = packs[0]
    if pack.get("active") is not True or pack.get("version", 0) < 1:
        raise ImportFailure("backup active style pack is invalid")
    require_id(pack.get("id"))
    payload = pack.get("payload")
    if not isinstance(payload, dict) or payload.get("id") != pack["id"] or payload.get("slug") != pack.get("slug"):
        raise ImportFailure("style pack payload does not match its row")
    style_ids = [require_id(asset.get("id")) for asset in assets]
    if len(set(style_ids)) != 3:
        raise ImportFailure("style assets contain duplicate IDs")
    for field in ("anchorIds", "assetIds"):
        ids = payload.get(field)
        if not isinstance(ids, list) or len(ids) != 3 or len(set(ids)) != 3 or set(ids) != set(style_ids):
            raise ImportFailure("style pack does not reference exactly three reusable assets")
    for asset in assets:
        if asset.get("role") != "style" or asset.get("draft_id") is not None or asset.get("payload", {}).get("id") != asset["id"]:
            raise ImportFailure("reusable style asset is invalid")
        if asset["payload"].get("draftId") is not None or asset["payload"].get("role") != "style":
            raise ImportFailure("reusable style asset payload does not match")
    if len({require_id(example.get("id")) for example in examples}) != 3:
        raise ImportFailure("writing examples contain duplicate IDs")
    backup_pack = read_csv(source / "studio-style-packs.csv", ("payload",))
    if len(backup_pack) != 1 or decode(backup_pack[0]["payload"]) != pack:
        raise ImportFailure("style pack backup disagrees with Studio records")
    statements = [insert("studio_style_packs", PACK_COLUMNS, pack)]
    statements += [insert("studio_assets", ASSET_COLUMNS, asset) for asset in assets]
    statements += [insert("past_newsletters", EXAMPLE_COLUMNS, example) for example in examples]
    return statements, {"style_packs": 1, "style_assets": 3, "writing_examples": 3, "excluded_source_rows": len(rows) - 7}


def endpoint():
    raw = os.environ.get("L8R_DATA_URL", "")
    secret = os.environ.get("L8R_DATA_SECRET", "")
    try:
        parsed = urllib.parse.urlsplit(raw)
        loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        parsed.port
    except ValueError as exc:
        raise ImportFailure("Worker configuration is invalid") from exc
    if not (parsed.scheme == "https" or parsed.scheme == "http" and loopback) or \
            parsed.path != "/internal" or parsed.query or parsed.fragment or \
            parsed.username or parsed.password or not parsed.hostname or len(secret) < 32:
        raise ImportFailure("Worker configuration is invalid")
    return raw, secret


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def call(url, secret, request):
    data = compact(request).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": "Bearer " + secret, "Content-Type": "application/json",
        "User-Agent": "L8R-Newsletter-Migration/1.0",
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            if response.status != 200:
                raise ImportFailure("Worker request failed")
            body = json.loads(response.read(20_000_000))
    except (OSError, urllib.error.HTTPError, ValueError, TimeoutError) as exc:
        raise ImportFailure("Worker request failed") from exc
    if not isinstance(body, dict) or body.get("ok") is not True or "result" not in body:
        raise ImportFailure("Worker returned an invalid response")
    return body["result"]


def count_query():
    return {"op": "query", "sql": "SELECT " + ",".join(
        f"(SELECT count(*) FROM {table}) AS {table}" for table in TABLES if table != "shared_news_selection"
    ), "params": []}


def empty_target(url, secret):
    state = call(url, secret, {"op": "newsletter_state"})
    counts = call(url, secret, count_query())
    if not isinstance(state, dict) or state.get("id") != "default" or state.get("revision") != 0 or \
            state.get("draft_id") is not None or state.get("current_draft") is not None or \
            state.get("draft_choices") != [] or state.get("curated_stories") != [] or \
            state.get("selected_ids") != [] or state.get("research_reports") != [] or \
            state.get("wizard_state") is not None:
        raise ImportFailure("Worker target is not a fresh empty workspace")
    rows = counts.get("rows") if isinstance(counts, dict) else None
    if not isinstance(rows, list) or len(rows) != 1 or set(rows[0]) != set(TABLES) - {"shared_news_selection"} or \
            any(type(value) is not int or value != 0 for value in rows[0].values()):
        raise ImportFailure("Worker target contains existing records")


def guard_statements():
    # These execute inside the same Durable Object batch as the seven INSERTs.
    # The first fails its CHECK if the initialized row disappeared. The second
    # fails its CHECK if any data appeared since the read-only preflight.
    missing = {"sql": "INSERT INTO shared_news_selection(id,session_id,updated_at) SELECT 'blocked','blocked','blocked' WHERE NOT EXISTS(SELECT 1 FROM shared_news_selection WHERE id='default')", "params": []}
    empty_checks = " AND ".join(f"(SELECT count(*) FROM {table})=0" for table in TABLES if table != "shared_news_selection")
    shared_checks = "revision=0 AND draft_id IS NULL AND current_draft IS NULL AND draft_choices='[]' AND curated_stories='[]' AND selected_ids='[]' AND research_reports='[]' AND wizard_state IS NULL"
    guard = {"sql": f"UPDATE shared_news_selection SET id=CASE WHEN {shared_checks} AND {empty_checks} THEN 'default' ELSE 'blocked' END WHERE id='default'", "params": []}
    return [missing, guard]


def run(argv=None):
    parser = argparse.ArgumentParser(description="Import reusable L8R style metadata and writing examples into a fresh Cloudflare Worker")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="backup directory")
    parser.add_argument("--apply", action="store_true", help="write to a verified empty Worker")
    args = parser.parse_args(argv)
    statements, counts = plan(args.source)
    if not args.apply:
        print("dry-run " + " ".join(f"{name}={count}" for name, count in counts.items()))
        return
    url, secret = endpoint()
    empty_target(url, secret)
    batch = guard_statements() + statements
    if len(batch) > 100:
        raise ImportFailure("import batch exceeds Worker limit")
    result = call(url, secret, {"op": "batch", "statements": batch})
    if not isinstance(result, list) or len(result) != len(batch) or any(not isinstance(item, dict) for item in result):
        raise ImportFailure("Worker import response is incomplete")
    print("applied " + " ".join(f"{name}={count}" for name, count in counts.items()))


if __name__ == "__main__":
    try:
        run()
    except ImportFailure as exc:
        print(f"import failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
