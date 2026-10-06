# -*- coding: utf-8 -*-
"""Конвертирует выгрузки OddsHarvester в src/data/odds.json.

Использование:
    python scripts/convert_odds.py <файлы .json> [...]

Поддерживаются рынки home_away (победитель с ОТ/буллитами) и double_chance (1X/12/X2).
Несколько файлов одного и того же матча объединяются по (дата, команды).
"""
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "src", "data")
GAMES = os.path.join(DATA, "games.json")
OUT = os.path.join(DATA, "odds.json")


def norm(name):
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def avg_odds(record, market_key, labels):
    values = {label: [] for label in labels}
    for entry in record.get(market_key) or []:
        for label in labels:
            try:
                v = float(entry[label])
            except (KeyError, TypeError, ValueError):
                continue
            if v > 1:
                values[label].append(v)
    if not all(values[label] for label in labels):
        return None
    return {label: sum(values[label]) / len(values[label]) for label in labels}


def main():
    inputs = sys.argv[1:]
    if not inputs:
        sys.exit("укажите файлы выгрузки OddsHarvester")
    with open(GAMES, encoding="utf-8-sig") as f:
        games = json.load(f)
    name_to_abbrev = {norm(t["name"]): t["abbrev"] for t in games["teams"]}

    merged = {}
    unmatched = set()
    for path in inputs:
        with open(path, encoding="utf-8-sig") as f:
            records = json.load(f)
        for r in records:
            h = name_to_abbrev.get(norm(r["home_team"]))
            a = name_to_abbrev.get(norm(r["away_team"]))
            if not h or not a:
                unmatched.add(r["home_team"])
                unmatched.add(r["away_team"])
                continue
            date = (r.get("match_date") or "")[:10]
            rec = merged.setdefault((date, h, a), {"date": date, "home": h, "away": a})

            ha = avg_odds(r, "home_away_market", ["1", "2"])
            if ha:
                rh, ra = 1 / ha["1"], 1 / ha["2"]
                rec["oddsHome"] = round(ha["1"], 3)
                rec["oddsAway"] = round(ha["2"], 3)
                rec["pHome"] = round(rh / (rh + ra), 4)
                rec["pAway"] = round(ra / (rh + ra), 4)

            dc = avg_odds(r, "double_chance_market", ["1X", "12", "X2"])
            if dc:
                rec["odds1X"] = round(dc["1X"], 3)
                rec["odds12"] = round(dc["12"], 3)
                rec["oddsX2"] = round(dc["X2"], 3)

            ou = avg_odds(r, "over_under_5_5_market", ["odds_over", "odds_under"])
            if ou:
                ro, ru = 1 / ou["odds_over"], 1 / ou["odds_under"]
                rec["oddsOver"] = round(ou["odds_over"], 3)
                rec["oddsUnder"] = round(ou["odds_under"], 3)
                rec["pOverMarket"] = round(ro / (ro + ru), 4)
                rec["pUnderMarket"] = round(ru / (ro + ru), 4)

    # Дополняем существующий odds.json: новые записи перезаписывают старые по (дата, команды),
    # а ранее собранные (например, прошедшие матчи) сохраняются.
    existing = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8-sig") as f:
                for x in json.load(f).get("odds", []):
                    existing[(x["date"], x["home"], x["away"])] = x
        except Exception as e:
            print("не удалось прочитать существующий odds.json:", e)
    before = len(existing)
    existing.update(merged)

    odds = sorted(existing.values(), key=lambda x: x["date"])
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"odds": odds}, f)
    print(f"новых из выгрузки: {len(merged)}; было: {before}; итого: {len(odds)}")
    print("не сматчились:", sorted(unmatched) or "нет")
    print("->", OUT)


if __name__ == "__main__":
    main()
