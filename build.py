"""Об'єднує ratings.csv з кешем TMDB і пише data.js для дашборду (index.html)."""
import csv
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
CACHE = ROOT / "cache"
GEO_URLS = {
    "world.json": "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json",
    "codes.json": "https://cdn.jsdelivr.net/npm/i18n-iso-countries@7.11.0/codes.json",
}

GENRES = {
    "Drama": "Драма", "Adventure": "Пригоди", "Action": "Бойовик", "Comedy": "Комедія",
    "Thriller": "Трилер", "Fantasy": "Фентезі", "Sci-Fi": "Фантастика", "Crime": "Кримінал",
    "Family": "Сімейний", "Mystery": "Детектив", "Animation": "Анімація", "Romance": "Мелодрама",
    "Horror": "Жахи", "Biography": "Біографія", "Sport": "Спорт", "Musical": "Мюзикл",
    "History": "Історичний", "War": "Воєнний", "Music": "Музичний", "Short": "Короткометражний",
    "Western": "Вестерн", "Documentary": "Документальний", "News": "Новини", "Talk-Show": "Ток-шоу",
    "Reality-TV": "Реаліті-шоу", "Film-Noir": "Нуар", "Game-Show": "Гра-шоу", "Adult": "Для дорослих",
}
TYPES = {
    "Movie": "Фільм", "TV Series": "Серіал", "TV Mini Series": "Мінісеріал", "Short": "Короткометражка",
    "Video": "Відео", "TV Movie": "Телефільм", "TV Special": "ТВ-спецвипуск", "TV Episode": "Епізод",
    "TV Short": "ТВ-короткометражка", "Video Game": "Відеогра", "Music Video": "Кліп",
    "Podcast Series": "Подкаст", "Podcast Episode": "Епізод подкасту",
}
# Українські студії радянського часу: їхні фільми не приховуємо.
UA_STUDIOS = ("dovzhenko", "kyivnaukfilm", "kievnauchfilm", "odesa", "odessa", "ukranimafilm", "ukrtelefilm", "yalta")



STREAMING_WINDOW_DAYS = 31


def streaming_release(rel):
    """Стрімінгова прем'єра: цифровий реліз раніше або не пізніше ніж через місяць після кінотеатрів.
    Касові збори таких фільмів не показують їхній реальний дохід."""
    if "digital" not in rel:
        return False
    if "cinema" not in rel:
        return True
    if rel["cinema"] < "2015":  # до ери стрімінгу цифрові дати в TMDB — це перевидання
        return False
    from datetime import date
    gap = (date.fromisoformat(rel["digital"]) - date.fromisoformat(rel["cinema"])).days
    return gap <= STREAMING_WINDOW_DAYS

def is_russian(tm):
    """Російське й радянське (крім українських студій). Західні копродукції з РФ лишаємо."""
    countries = tm.get("countries") or []
    if "RU" in countries:
        return tm.get("lang") == "ru" or countries[0] == "RU"
    if "SU" in countries:
        names = " ".join(c["name"].lower() for c in tm.get("companies", []))
        return not any(s in names for s in UA_STUDIOS)
    return tm.get("lang") == "ru"


PEOPLE_ROLES = ["cast", "directors", "writers", "composers", "cinematographers", "creators"]


def num(s, cast=float):
    try:
        return cast(s)
    except (TypeError, ValueError):
        return None


def geo():
    out = {}
    (CACHE / "geo").mkdir(parents=True, exist_ok=True)
    for name, url in GEO_URLS.items():
        path = CACHE / "geo" / name
        if not path.exists():
            with urllib.request.urlopen(url, timeout=60) as r:
                path.write_bytes(r.read())
        out[name] = json.loads(path.read_text(encoding="utf-8"))
    num2a2 = {row[2]: row[0] for row in out["codes.json"]}
    return out["world.json"], num2a2


def category(type_, genres):
    animated = "Animation" in genres
    if type_ in ("TV Series", "TV Mini Series"):
        return "anim_series" if animated else "series"
    if type_ in ("Movie", "TV Movie", "Video"):
        return "cartoon" if animated else "movie"
    return "other"


def main():
    people, people_idx, collections, collections_idx = [], {}, [], {}

    def pid(p):
        if p["id"] not in people_idx:
            people_idx[p["id"]] = len(people)
            people.append([p["name"], p.get("img")])
        return people_idx[p["id"]]

    titles, missing, hidden = [], [], []
    with open(ROOT / "ratings.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            imdb_id = row["Const"]
            path = CACHE / "tmdb" / f"{imdb_id}.json"
            tm = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"missing": True}
            if tm.get("missing"):
                missing.append(f"{imdb_id} {row['Title']}")
            elif is_russian(tm):
                hidden.append(f"{imdb_id} {tm.get('title') or row['Title']}")
                continue
            genres_en = [g.strip() for g in row["Genres"].split(",") if g.strip()]
            t = {
                "id": imdb_id,
                "t": tm.get("title") or row["Title"],
                "ot": row["Original Title"],
                "y": num(row["Year"], int),
                "r": int(row["Your Rating"]),
                "ir": num(row["IMDb Rating"]),
                "v": num(row["Num Votes"], int),
                "d": row["Date Rated"],
                "rd": row["Release Date"] or None,
                "type": TYPES.get(row["Title Type"], row["Title Type"]),
                "cat": category(row["Title Type"], genres_en),
                "rt": num(row["Runtime (mins)"], int),
                "g": [GENRES.get(g, g) for g in genres_en],
                "c": tm.get("countries", []),
                "l": tm.get("lang"),
                "p": tm.get("poster"),
                "ov": tm.get("overview", ""),
                "tg": tm.get("genres", []),
            }
            for role in PEOPLE_ROLES:
                lst = tm.get(role) or []
                if lst:
                    t[role] = [pid(p) for p in lst]
            # Для фільмів без режисерів у TMDB беремо їх з IMDb не можна (немає id), тож лишаємо як є.
            col = tm.get("collection")
            if col:
                if col["id"] not in collections_idx:
                    collections_idx[col["id"]] = len(collections)
                    collections.append(col["name"])
                t["col"] = collections_idx[col["id"]]
            for k in ("seasons", "episodes"):
                if tm.get(k):
                    t[k] = tm[k]
            if tm.get("budget"):
                t["bud"] = tm["budget"]
            if tm.get("revenue"):
                t["rev"] = tm["revenue"]
            if streaming_release(tm.get("releases") or {}):
                t["sf"] = 1
            sl = [[x["n"], x["air"], x.get("eps"), x.get("poster")] for x in tm.get("season_list") or [] if x.get("air")]
            if sl:
                t["sl"] = sl  # [номер, дата виходу, серій, постер сезону]
            if tm.get("networks"):
                t["net"] = tm["networks"]
            titles.append(t)

    world, num2a2 = geo()
    data = {
        "titles": titles,
        "people": people,
        "collections": collections,
        "world": world,
        "num2a2": num2a2,
    }
    js = "window.DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "data.js").write_text(js, encoding="utf-8")
    print(f"Тайтлів: {len(titles)}, людей: {len(people)}, франшиз: {len(collections)}")
    print(f"data.js: {len(js.encode('utf-8')) / 1024:.0f} КБ")
    print(f"Приховано російських і радянських: {len(hidden)}")
    if missing:
        print(f"Не знайдено в TMDB ({len(missing)}):")
        for m in missing:
            print("  " + m)


if __name__ == "__main__":
    main()
