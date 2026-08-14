#!/usr/bin/env python3
"""Rebuild src/stats.json, the map from CMS user keys to stats.ioinformatics.org people.

For every archived year this scrapes https://stats.ioinformatics.org/results/<year>
and matches each row to a CMS user of src/ioi-<year>/data.json. Names alone are
ambiguous (several IOIs have two contestants with the same name, and guests share
names with contestants), so contestants are primarily matched on their score
vector, which is identical in both sources.

Usage: python3 scripts/build_stats.py [--report report.json]
"""

import argparse
import collections
import html
import json
import re
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
RESULTS_URL = "https://stats.ioinformatics.org/results/{year}"
N_TASKS = 6
N_COLUMNS = 3 + N_TASKS + 3  # rank, name, country, tasks..., score, percentage, medal


def normalize(name):
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z ]", " ", name.lower()).split())


def tokens(name):
    return frozenset(normalize(name).split())


def to_score(cell):
    try:
        return round(float(cell), 2)
    except ValueError:
        return 0.0


def fetch_results(year):
    """Return one record per contestant listed on the year's results page."""
    with urllib.request.urlopen(RESULTS_URL.format(year=year)) as response:
        page = response.read().decode("utf-8")

    records = []
    for row in re.findall(r"<tr>((?:(?!</tr>).)*people/\d+(?:(?!</tr>).)*)</tr>", page, re.S):
        cells = [html.unescape(re.sub(r"<[^>]*>", "", cell)).strip()
                 for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) != N_COLUMNS:
            raise ValueError(f"unexpected results layout for {year}: {cells}")
        country = re.search(r"countries/([A-Z]{3})", row)
        records.append({
            "id": int(re.search(r"people/(\d+)", row).group(1)),
            "name": html.unescape(re.search(r'people/\d+">([^<]*)', row).group(1)).strip(),
            "country": country.group(1) if country else None,
            "scores": tuple(sorted(to_score(c) for c in cells[3:3 + N_TASKS])),
            "score": to_score(cells[3 + N_TASKS]),
        })
    return records


def load_users(year):
    data = json.loads((SRC / f"ioi-{year}" / "data.json").read_text())
    users = {}
    for key, user in data["users"].items():
        scores = [round(float(data["scores"].get(key, {}).get(task, 0)), 2) for task in data["tasks"]]
        users[key] = {
            "name": f"{user['f_name']} {user['l_name']}",
            "team": user["team"],
            "scores": tuple(sorted(scores)),
            "score": round(sum(scores), 2),
        }
    return users


def same_score(user, record):
    return user["scores"] == record["scores"] and user["score"] == record["score"]


def same_country(user, record):
    # the mixed IOI teams have no country on the stats site
    return record["country"] is None or record["country"] == user["team"][:3]


def name_overlaps(user, record):
    return tokens(user["name"]) <= tokens(record["name"]) or tokens(record["name"]) <= tokens(user["name"])


# Ordered from the most to the least trustworthy criterion. Every round is
# repeated until it stops matching, and only ever matches a user to a record
# that no other unmatched user could claim.
RULES = [
    lambda u, r: same_score(u, r) and normalize(u["name"]) == normalize(r["name"]),
    lambda u, r: same_score(u, r) and tokens(u["name"]) == tokens(r["name"]),
    lambda u, r: same_score(u, r) and u["score"] > 0,
    lambda u, r: same_score(u, r) and same_country(u, r),
    lambda u, r: same_country(u, r) and normalize(u["name"]) == normalize(r["name"]),
    lambda u, r: same_country(u, r) and tokens(u["name"]) == tokens(r["name"]),
    lambda u, r: same_country(u, r) and name_overlaps(u, r),
]


def match(users, records):
    unmatched = dict(users)
    available = list(records)
    people = {}

    for rule in RULES:
        matched_any = True
        while matched_any:
            matched_any = False
            for key, user in list(unmatched.items()):
                candidates = [r for r in available if rule(user, r)]
                if len(candidates) == 1:
                    people[key] = candidates[0]["id"]
                    del unmatched[key]
                    available.remove(candidates[0])
                    matched_any = True

    return people, unmatched, available


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, help="write unmatched contestants to this file")
    args = parser.parse_args()

    years = sorted(int(path.name[-4:]) for path in SRC.glob("ioi-2*") if path.name[-4:].isdigit())
    stats = {}
    report = collections.OrderedDict()

    for year in years:
        users = load_users(year)
        records = fetch_results(year)
        people, unmatched, leftover = match(users, records)
        stats[str(year)] = dict(sorted(people.items()))
        report[str(year)] = {
            "users": len(users),
            "results_rows": len(records),
            "matched": len(people),
            "unmatched_users": [[k, u["name"], u["team"], u["score"]] for k, u in unmatched.items()],
            "unmatched_results": [[r["id"], r["name"], r["country"], r["score"]] for r in leftover],
        }
        print(f"{year}: matched {len(people)}/{len(users)} contestants "
              f"({len(leftover)} unused results rows)")

    (SRC / "stats.json").write_text(json.dumps(stats, indent=1) + "\n")
    if args.report:
        args.report.write_text(json.dumps(report, indent=1) + "\n")


if __name__ == "__main__":
    main()
