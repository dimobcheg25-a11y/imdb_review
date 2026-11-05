"""Збирає дані з TMDB для кожного тайтлу з ratings.csv і кешує їх у cache/tmdb/<imdb_id>.json.

Повторний запуск докачує лише нові тайтли. `--refresh` перекачує все.
"""
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT / "cache" / "tmdb"
API = "https://api.themoviedb.org/3"
LANG = "uk-UA"
CAST_LIMIT = 20
CREW_JOBS = {
    "Director": "directors",
    "Screenplay": "writers",
    "Writer": "writers",
    "Original Music Composer": "composers",
    "Director of Photography": "cinematographers",
}


def load_token():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith("TMDB_READ_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("TMDB_READ_TOKEN не знайдено у .env")


TOKEN = load_token()


def get(path):
    sep = "&" if "?" in path else "?"
    url = f"{API}{path}{sep}language={LANG}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "accept": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429 or e.code >= 500:
                time.sleep(2 ** attempt)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Не вдалося отримати {path}")


def person(p):
    return {"id": p["id"], "name": p["name"], "img": p.get("profile_path")}


def crew_groups(crew):
    out = {}
    for c in crew:
        jobs = [c["job"]] if "job" in c else [j["job"] for j in c.get("jobs", [])]
        for job in jobs:
            key = CREW_JOBS.get(job)
            if key and all(x["id"] != c["id"] for x in out.setdefault(key, [])):
                out[key].append(person(c))
    return out


def first_releases(rd):
    """Найраніші дати кінотеатрального (типи TMDB 2, 3) і цифрового (тип 4) релізу в будь-якій країні."""
    first = {}
    for country in rd.get("results", []):
        for r in country.get("release_dates", []):
            day = (r.get("release_date") or "")[:10]
            key = "digital" if r.get("type") == 4 else "cinema" if r.get("type") in (2, 3) else None
            if day and key and (key not in first or day < first[key]):
                first[key] = day
    return first


def fetch(imdb_id):
    found = get(f"/find/{imdb_id}?external_source=imdb_id")
    if not found:
        return {"imdb": imdb_id, "missing": True}
    if found["movie_results"]:
        kind, tid = "movie", found["movie_results"][0]["id"]
    elif found["tv_results"]:
        kind, tid = "tv", found["tv_results"][0]["id"]
    elif found.get("tv_episode_results"):
        ep = found["tv_episode_results"][0]
        kind, tid = "tv", ep["show_id"]
    else:
        return {"imdb": imdb_id, "missing": True}

    credits = "credits" if kind == "movie" else "aggregate_credits"
    extra = ",release_dates" if kind == "movie" else ""
    d = get(f"/{kind}/{tid}?append_to_response={credits},keywords{extra}")
    if not d:
        return {"imdb": imdb_id, "missing": True}
    cr = d.get(credits) or {}
    cast = sorted(cr.get("cast", []), key=lambda c: c.get("order", 999))[:CAST_LIMIT]
    countries = [c["iso_3166_1"] for c in d.get("production_countries", [])]
    rec = {
        "imdb": imdb_id,
        "kind": kind,
        "tmdb": tid,
        "title": d.get("title") or d.get("name"),
        "poster": d.get("poster_path"),
        "lang": d.get("original_language"),
        "countries": countries or d.get("origin_country", []),
        "genres": [g["name"] for g in d.get("genres", [])],
        "companies": [{"name": c["name"], "country": c.get("origin_country") or ""} for c in d.get("production_companies", [])],
        "overview": d.get("overview") or "",
        "cast": [person(c) for c in cast],
        **crew_groups(cr.get("crew", [])),
    }
    if kind == "movie":
        col = d.get("belongs_to_collection")
        if col:
            rec["collection"] = {"id": col["id"], "name": col["name"]}
        rec["budget"] = d.get("budget") or None
        rec["revenue"] = d.get("revenue") or None
        rec["releases"] = first_releases(d.get("release_dates") or {})
    else:
        rec["creators"] = [person(c) for c in d.get("created_by", [])]
        rec["seasons"] = d.get("number_of_seasons")
        rec["episodes"] = d.get("number_of_episodes")
        rec["networks"] = [n["name"] for n in d.get("networks", [])]
        rec["status"] = d.get("status")
        # Дати виходу сезонів (без спецвипусків) — щоб знати, чи виходив новий сезон у певному році.
        rec["season_list"] = [
            {"n": s["season_number"], "air": s.get("air_date"), "eps": s.get("episode_count"), "poster": s.get("poster_path")}
            for s in d.get("seasons", []) if s.get("season_number")
        ]
    kw = d.get("keywords") or {}
    rec["keywords"] = [k["name"] for k in kw.get("keywords", kw.get("results", []))][:15]
    return rec


def needs_fetch(path):
    if not path.exists():
        return True
    rec = json.loads(path.read_text(encoding="utf-8"))
    if rec.get("missing"):
        return False
    if rec.get("kind") == "tv":
        return "season_list" not in rec
    return "companies" not in rec or "releases" not in rec


def main():
    refresh = "--refresh" in sys.argv
    CACHE.mkdir(parents=True, exist_ok=True)
    with open(ROOT / "ratings.csv", encoding="utf-8") as f:
        ids = [r["Const"] for r in csv.DictReader(f)]
    todo = [i for i in ids if refresh or needs_fetch(CACHE / f"{i}.json")]
    print(f"Усього {len(ids)}, до завантаження {len(todo)}")
    done = errors = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch, i): i for i in todo}
        for fut in as_completed(futures):
            imdb_id = futures[fut]
            try:
                rec = fut.result()
                (CACHE / f"{imdb_id}.json").write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            except Exception as e:
                errors += 1
                print(f"  помилка {imdb_id}: {e}")
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(todo)}")
    print(f"Готово. Помилок: {errors}")


if __name__ == "__main__":
    main()
