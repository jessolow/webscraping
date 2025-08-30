import os
import sys
import hashlib
from datetime import datetime, date
from typing import List, Dict, Any

from google_play_scraper import reviews, Sort, search

try:
    from supabase import create_client, Client
except Exception as e:
    print("[fatal] supabase package not available. Run: pip install -r requirements.txt", file=sys.stderr)
    raise


def sha256_hex(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def chunked(items: List[Dict[str, Any]], size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def json_safe(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, (bytes, bytearray)):
        return obj.decode("utf-8", errors="ignore")
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [json_safe(v) for v in obj]
    return obj


def main() -> int:
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        print("[fatal] Missing SUPABASE_URL or SERVICE_ROLE_KEY in env", file=sys.stderr)
        return 2

    app_id = os.environ.get("GP_APP_ID", "com.tonik.mobile")
    query = os.environ.get("GP_APP_QUERY", "Tonik Digital Bank")
    country = os.environ.get("GP_COUNTRY", "ph")
    lang = os.environ.get("GP_LANG", "en")
    max_count = int(os.environ.get("GP_MAX_REVIEWS", "1200"))

    print(f"[info] fetching Google Play reviews app_id={app_id} country={country} lang={lang} max={max_count}")

    def fetch_with_params(aid: str, ctry: str | None) -> List[Dict[str, Any]]:
        acc: List[Dict[str, Any]] = []
        next_tok = None
        while len(acc) < max_count:
            kwargs = dict(app_id=aid, lang=lang, sort=Sort.NEWEST, count=200, continuation_token=next_tok)
            if ctry:
                kwargs["country"] = ctry
            try:
                batch, next_tok = reviews(**kwargs)  # type: ignore[arg-type]
            except Exception as e:
                print(f"[warn] reviews fetch error (aid={aid} ctry={ctry}): {e}", file=sys.stderr)
                break
            if not batch:
                break
            acc.extend(batch)
            if not next_tok:
                break
        return acc

    # First attempt: provided app_id with country
    all_reviews: List[Dict[str, Any]] = fetch_with_params(app_id, country)

    # If none, try without country (global)
    if not all_reviews:
        print("[info] no results with region filter, retrying global store")
        all_reviews = fetch_with_params(app_id, None)

    # If still none, try searching app id in PH store
    if not all_reviews:
        print(f"[info] searching for app by query: {query}")
        try:
            results = search(query, lang=lang, country=country, n=5)
        except Exception as e:
            results = []
            print(f"[warn] search failed: {e}", file=sys.stderr)
        for res in results:
            cand = res.get("appId")
            if not cand:
                continue
            print(f"[info] trying candidate appId={cand}")
            all_reviews = fetch_with_params(cand, country)
            if not all_reviews:
                all_reviews = fetch_with_params(cand, None)
            if all_reviews:
                app_id = cand
                break

    print(f"[info] fetched {len(all_reviews)} raw reviews")

    # Deduplicate by reviewId
    seen = set()
    rows: List[Dict[str, Any]] = []
    for r in all_reviews:
        rid = r.get("reviewId")
        if not rid or rid in seen:
            continue
        seen.add(rid)
        at_val = r.get("at")
        posted_at = None
        if at_val:
            if isinstance(at_val, datetime):
                posted_at = at_val.isoformat()
            else:
                try:
                    posted_at = datetime.fromisoformat(str(at_val)).isoformat()
                except Exception:
                    posted_at = None
        rows.append({
            "source": "google_play",
            "platform_app_id": app_id,
            "review_id": rid,
            "author_name": r.get("userName"),
            "author_hash": sha256_hex(r.get("userName") or ""),
            "rating": r.get("score"),
            "title": r.get("title"),
            "content": r.get("content") or r.get("text"),
            "posted_at": posted_at,
            "thumbs_up": int(r.get("thumbsUpCount") or r.get("thumbsUp") or 0),
            "data": json_safe(r),
        })

    print(f"[info] prepared {len(rows)} unique rows")

    client: Client = create_client(supabase_url, service_role_key)

    inserted = 0
    for chunk in chunked(rows, 500):
        resp = client.table("raw_reviews").upsert(chunk, on_conflict="source,review_id").execute()
        # supabase-py v2 returns data or count depending on table policy; ignore content
        inserted += len(chunk)

    print(f"[ok] upserted {inserted} rows into raw_reviews")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


