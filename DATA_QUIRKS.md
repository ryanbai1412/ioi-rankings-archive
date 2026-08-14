# Data quirks

This is an audit of the archived data, year by year. Almost nothing here is a bug in the website —
it is a record of the oddities that came with the scraped CMS data (missing faces, missing scores,
guest teams, renamed users, lost tokens, floating point noise) so that nobody has to rediscover them.

Facts below were checked against the bundled data (`src/ioi-yyyy/data.json`), the raw scrapes
(`data/ioi-yyyy/`), the shipped assets (`src/public/`), and the official results on
[stats.ioinformatics.org](https://stats.ioinformatics.org/). Where a cause is a guess rather than a
verified fact, it is marked *(inferred)*.

## Contents

- [At a glance](#at-a-glance)
- [Cross-year quirks](#cross-year-quirks)
- [2017](#2017) · [2019](#2019) · [2020](#2020) · [2021](#2021) · [2022](#2022) · [2023](#2023) · [2024](#2024) · [2025](#2025) · [2026](#2026)
- [What was checked](#what-was-checked)

## At a glance

| Year | Contestants | Teams | No score | Faces missing | Unmapped to stats | Headline quirk |
| --- | --- | --- | --- | --- | --- | --- |
| 2017 | 308 | 85 | 5 | 0 | 1 | `XXX_2d1` user keys, Iran-2 filed as `IRI`, Israel absent, tokens lost |
| 2019 | 331 | 88 | 3 | 0 (327 unusable) | 0 | 327 of 331 "faces" are Wayback Machine HTML pages |
| 2020 | 347 | 87 | 3 | 1 | 0 | `ARG3` has no face; Singapore fields 8 contestants |
| 2021 | 355 | 88 | 0 | 0 | 0 | Cleanest year: every contestant scored, integer scores only |
| 2022 | 357 | 89 | 8 | 0 | 4 | Single 8-person `IOI` team; Indonesia fields 8 |
| 2023 | 354 | 89 | 8 | 0 | 0 | 3.7 MB face photos; Hungary fields 8 |
| 2024 | 370 | 95 | 7 | 4 | 4 | Lowercase keys; Israeli faces filed as `ioi4x`; halved China day-2 scores |
| 2025 | 334 | 87 | 1 | 0 | 0 | Heaviest float noise (up to 20 decimals) |
| 2026 | 386 | 97 | 15 | 1 | 7 | Only `.jpg` year; 4 mixed IOI teams; 15 contestants with no score |

"No score" = contestant present in `users` with no entry in `scores` (or a total of 0).
"Unmapped to stats" = contestant with no entry in `src/stats.json`, so the user detail panel has no
link to their stats.ioinformatics.org profile.

## Cross-year quirks

**2018 is missing entirely.** Years jump 2017 → 2019. No CMS scrape exists for IOI 2018 (Tsukuba);
`vite.config.js`, the landing page and the sitemap all skip it.

**Rankings include guests, and that is correct.** Several years contain second host teams
(`SGP5`–`SGP8`, `IDN5`–`IDN8`, `HUN5`–`HUN8`, `UZB5`–`UZB8`, `AZE2`, `EGY2`, `BOL2`) and mixed/neutral
`IOI*` teams. They occupy ranks in the CMS scoreboard, and the medal cut-offs in
`src/Config.js` were chosen to reproduce what stats.ioinformatics.org shows, guests included. Every
archived contestant's medal colour matches the official one — the only two exceptions are guests with
an out-of-competition Honourable Mention (`HUN8` in 2023, `UZB5` in 2026), which the archive shows as
no medal.

**Medal cut-offs land inside tie groups** in 2021 (silver, rank 86: `ARM1`, `HKG3`, `HKG4`, `IRL1` on
289; bronze, rank 173: `AUS1`, `BEL1`, `DEU4`, `JOR1` on 203), 2022 (bronze, rank 179: `FIN2`, `IND2`
on 147) and 2023 (bronze, rank 178: `ARM3`, `AZE3`, `KAZ3`, `NZL2` on 153). CMS gives tied contestants
the same rank, so the whole group gets the medal and those years display slightly more medallists than
the nominal cut-off — which is exactly what happened officially.

**Faces are JPEGs named `.png`.** In every year except 2026 the face files carry a `.png` extension but
contain JFIF/JPEG data (2020 has 2 real PNGs, 2022 has 53, 2023 has 54, 2024 has 72). Browsers sniff the
content, so it renders; anything that trusts the extension will not. 2026 is the only year with
`"face_ext": "jpg"` in `asset_config`, and even there `IRN3.jpg` is a real PNG.

**A missing face file is a broken image.** `Config.get_face_url()` builds
`faces/<user_key>.<ext>` unconditionally; there is no per-user fallback, so `ARG3` (2020), `isr1`–`isr4`
(2024) and `VEN4` (2026) render as a broken image in the user detail panel.

**Flags are keyed on the first three characters** of the team key (`Config.get_flag_url`), so `IOI1`,
`IOI2`, `IOI3` and `IOI4` all fall back to the single generic `IOI.png`. `data/ioi-2026/flags/` actually
ships four distinct `IOI1`–`IOI4` flags, but the site never uses them. 2017's `IRI` is special-cased to
`IRN`.

**Tokens are gone.** No submission in any year carries a token flag (`tokened=0` everywhere), which only
matters for 2017 (see below).

**Contest names are rewritten.** `DataStore.create_contest` forces every contest name to `Day 1`/`Day 2`
by regex; the raw names range from `day1` to `International Olympiad in Informatics 2025 - Day 1` and, in
2019, the inconsistent `Day1`/`Day2`.

**Nobody's score ever decreases** in the history stream, in any year, and no duplicate submission IDs
exist anywhere.

**Score precision drifts.** Scores are stored as raw floats, so many years carry binary-float artefacts
like `29.690000000000005`. 2021 is the only year with pure integers.

**Submissions land after the contest window** in most years, usually by a few minutes (a scraping/clock
artefact), but see 2019 and 2024 for extreme cases.

**Raw and bundled data agree.** For every year, `data/ioi-yyyy/` and `src/ioi-yyyy/data.json` contain the
same users, teams, tasks, contests and scores, and the same face files as `src/public/ioi-yyyy/faces/`.

**Legacy scrape leftovers** sit in `data/`: `patch.sh` (2017, 2019, 2022, 2023), `Ranking.css.bak`
(2017, 2019, 2020, 2021), `logo.svg` (2017), `new_logo.png` (2019). They are not used by the site.

## 2017

Tehran, Iran. 308 contestants, 85 teams, 13 897 submissions, 3 108 history events.

- **User keys are `XXX_2d1`, not `XXX1`.** All 308 keys look like `ARG_2d1` — the CMS instance encoded a
  `-` as `_2d`. `DataStore.create_user` rewrites them for display.
- **Iran's second team is `IRI`.** Users `IRI_2d1`–`IRI_2d4` are displayed as `IRN5`–`IRN8`, and
  `Config.get_flag_url` maps `IRI` → `IRN` because no `IRI.png` flag exists.
- **Israel is missing.** Four Israeli contestants (Yuval Salant, Ron Solan, Aviel Boag, Nir Shalmon —
  two silvers and two bronzes officially) appear in the official results but not in the CMS scrape.
  They competed off-site *(inferred)*.
- **`PSE_2d1` (Samed Alhajajla) has no official record** — he is in the CMS with 37 submissions and a
  score of 0, but has no row on stats.ioinformatics.org, and is the year's only contestant with no
  `stats.json` mapping.
- **Tokens are lost, so per-task scores cannot be recomputed.** 2017 is the only year using the
  `max_tokened_last` score mode, and token flags were not scraped, so recomputing task scores from the
  submission list disagrees with the scoreboard for 279 (user, task) pairs. The scoreboard values and the
  history stream are consistent with each other and with the official totals; only the submission list
  cannot reproduce them.
- **Empty teams:** `EGY` and `DOM` exist with zero contestants.
- **Small teams:** `CUB`, `ISL`, `MNE`, `SLV`, `TKM` and `USA` field 1 contestant each (`USA` has one!),
  `COL`, `JOR`, `LKA`, `PSE` field 3, `NGA` 2. The lone American, `USA_2d1`, matches the official
  results — the US really did send one contestant.
- **No score:** `MAR_2d2`, `MAR_2d3`, `NGA_2d2`, `PSE_2d1`, `PSE_2d4` (all five did submit).
- **Day 2 ran 5h30m** (04:30–10:00 UTC) versus 5h for day 1 — the scraped contest window, not the real
  contest length *(inferred)*.
- **24 submissions and 10 history events fall outside the contest windows**, the latest 130 minutes
  after day 1 ended.
- **`FIN_2d2.png` is a 2.9 KB face**, the smallest in the archive; face sizes range over 90 distinct
  dimensions.
- Highest score: `JPN_2d4` with 589.52. Busiest contestant: `IDN_2d3` with 139 submissions.

## 2019

Baku, Azerbaijan. 331 contestants, 88 teams, 13 007 submissions, 4 578 history events.

- **327 of the 331 "faces" are HTML.** `src/public/ioi-2019/faces/*.png` mostly contain Wayback Machine
  error pages, not images — the scrape went through web.archive.org and the photos were never archived.
  Only `CHN1.png`, `RUS2.png`, `TUR3.png` and `USA3.png` are real JPEGs.
- **A submission is dated three days after the contest.** `CAN2` has a `rect` submission at
  2019-08-09 13:08 UTC, 4 508 minutes after day 1 closed. Six other submissions and four history events
  are also outside the windows.
- **Day 2 has odd bounds:** 05:20–10:33 UTC (5h13m).
- **Contest names are `Day1` and `Day2`** in the raw data — the only year where the two days are named
  inconsistently with each other (`Day 1` vs `Day2`).
- **Azerbaijan fields two teams:** `AZE` (`AZE1`–`AZE4`) and `AZE2` (`AZE5`–`AZE8`).
- **No score:** `PSE3`, `TKM3`, `UZB4` (all three did submit).
- **83 float-noise scores** such as `29.690000000000005`, the first year the artefacts appear.
- Highest score: `USA3` with 547.09. Busiest contestant: `RUS4` with 127 submissions.

## 2020

Singapore (online). 347 contestants, 87 teams, 18 563 submissions, 4 339 history events.

- **`ARG3` has no face file** — 346 faces for 347 contestants, and the panel shows a broken image.
- **`NGA3.png` and `NGA4.png` are the CMS default placeholder** (byte-identical to `img/face.png`).
- **Singapore fields 8 contestants** (`SGP1`–`SGP8`) as the online host.
- **No score:** `ISL1`, `NGA2`, `VEN1` (all three did submit; `VEN1` submitted twice all contest).
- **Face sizes are wildly uneven:** 342 are 360×450, but `HKG3.png` is 596 KB and one photo is
  1800×2400.
- **Both days end at exactly 15:59** — the last submission in each window lands on the second the
  contest closes.
- Highest score: `USA1` with a perfect 600. Three contestants tie on 592.62.

## 2021

Singapore (online). 355 contestants, 88 teams, 11 722 submissions, 3 483 history events.

The cleanest year in the archive: every contestant has a score, every face exists, no submissions fall
outside the contest windows, and all 1 835 scores are integers with no float noise.

- **Singapore again fields 8 contestants** (`SGP1`–`SGP8`).
- **`POL3.png` and `POL4.png` are byte-identical** — the same photo used for two contestants.
- **Two medal cut-offs land inside ties** (silver rank 86 and bronze rank 173, both 4-way).
- **Only 199 distinct total scores among 355 contestants** — integer scoring makes ties common.
- **Face dimensions come in two flavours,** 144×180 (193 files) and 135×180 (161 files), plus one
  134×180.
- Highest score: `CHN3` with a perfect 600. China took the top four places.

## 2022

Yogyakarta, Indonesia. 357 contestants, 89 teams, 14 825 submissions, 4 594 history events.

- **The mixed team is a single 8-person `IOI` team** (`IOI1`–`IOI8`), unlike 2023–2026 where mixed
  contestants are split into `IOI1`, `IOI2`, … teams of four.
- **Indonesia fields 8 contestants** (`IDN1`–`IDN8`) as host.
- **No score:** all four of `ECU1`–`ECU4`, plus `JOR1`, `NGA1`, `TKM3`, `VEN4`. `ECU1`, `JOR1`, `NGA1`,
  `TKM3` and `VEN4` have empty submission lists — `ECU1` submitted nothing at all.
- **Four contestants have no official record and no stats mapping:** `ECU1` (Braulio de Jesús Rivas
  Abad), `JOR1` (Mohammad Alwarawreh), `TKM3` (Nazira Rustamova), `VEN4` (Valentina Victoria Vegas
  Velasquez) — they are in the CMS but not in the official results *(inferred: registered but did not
  compete)*.
- **One submission is dated a day late:** `ARM2` on `prison` at 2022-08-11 11:50 UTC, 1 490 minutes after
  day 1 closed.
- **`DOM` and `MNE` field 1 contestant each**, `ISL` 3.
- Highest score: `CHN1` and `CHN2` both perfect on 600.

## 2023

Szeged, Hungary. 354 contestants, 89 teams, 14 263 submissions, 4 202 history events.

- **Hungary fields 8 contestants** (`HUN1`–`HUN8`) as host. `HUN8` (Bendegúz Péter Vámosi) officially
  received an out-of-competition Honourable Mention, which the archive cannot represent.
- **Two mixed teams,** `IOI1` (`IOI1`–`IOI4`) and `IOI2` (`IOI5`–`IOI8`) — note the team key and the user
  key namespaces overlap confusingly here.
- **`IOI5` sits exactly on the gold cut-off** (rank 30, 333.5).
- **The bronze cut-off splits a 4-way tie** on 153 (`ARM3`, `AZE3`, `KAZ3`, `NZL2`).
- **Faces are huge:** `GBR2.png` is 3.7 MB and `GBR1.png` 2.8 MB, against a 768×1024 norm for 353 of the
  354 files (`VNM4.png` is the odd one at 135×180).
- **No score:** `CHL2`, `DOM2`, `ECU3`, `ECU4`, `JOR4`, `MNE4`, `TKM3`, `VEN1`. `ECU3` has an empty
  submission list; the other seven did submit.
- Highest score: `CHN2` with 580.

## 2024

Alexandria, Egypt. 370 contestants, 95 teams, 15 051 submissions, 4 989 history events.

- **All user keys are lowercase** (`alb1`, `ioi23`, …), unique to this year. `DataStore` uppercases them
  for display, but `stats.json`, the face filenames and any external tooling see lowercase.
- **The four Israeli contestants have no face files, and four orphan `ioi4x.png` files exist**:
  `isr1`–`isr4` are missing, while `ioi41.png`–`ioi44.png` sit in the faces directory with no matching
  user (there is no `IOI4` team in 2024). *(Inferred: the team was renamed from `IOI4` to `ISR` in the
  CMS after the photos were uploaded.)* `ioi44.png` is the default placeholder anyway.
- **Four placeholder faces:** `arm4.png`, `ioi44.png`, `uzb3.png`, `uzb4.png` are byte-identical to the
  CMS default `img/face.png`.
- **`chn3` and `chn4` have day-2 scores that are exactly half** of what their own submission list and
  history stream show (`chn3`: mosaic 100→50, hieroglyphs 100→50, sphinx 64→32; `chn4`: mosaic 100→50,
  hieroglyphs 28→14, sphinx 100→50). The halved values are the ones that match the official results, so
  the scoreboard is right and the submission list / score graph disagree with it for these two
  contestants. This is the only year where the history stream contradicts the final scores.
- **`chn1` scored 0 on every task** with an empty submission list, despite being present.
- **Three mixed teams** `IOI1`, `IOI2`, `IOI3`, plus a second Egyptian team `EGY2` (`egy21`–`egy24`) —
  the only year where second-team user keys are `xxx2N` rather than `xxx5`–`xxx8`.
- **No score:** `alb2`, `bol3`, `chn1`, `dza3`, `ecu4`, `nga2`, `ven2`, `ven3`; `bol3`, `chn1`, `dza3`,
  `ven2`, `ven3` have empty submission lists.
- **Four contestants have no official record and no stats mapping:** `bol3`, `dza3`, `ven2`, `ven3`.
- **A submission lands 3.5 hours after day 2 closed** (`chl1` on `mosaic`, 14:26 UTC), and `ioi23` has one
  five minutes past the day-1 buzzer that also appears in the history stream.
- **Face photos are all over the place:** 293 distinct dimensions, from a 12.6 KB placeholder to
  `hun3.png` at 8.6 MB and `alb1.png` at 7.5 MB.
- Highest score: `chn2` with a perfect 600.

## 2025

Sucre, Bolivia. 334 contestants, 87 teams, 18 470 submissions, 6 219 history events.

- **Mixed teams are `IOI1` and `IOI3`** — there is no `IOI2`, and the numbering has a gap. Their
  contestants are `IOI1`–`IOI4` and `IOI5`–`IOI8` respectively, and these are the only teams with
  human-readable names (`Team IOI 1`, `Team IOI 3`).
- **Bolivia fields a second team** `BOL2` (`BOL5`–`BOL8`) as host.
- **The worst float noise in the archive:** scores carry up to 20 decimal places, 2 133 submission scores
  and 55 task scores show binary-float artefacts (`42.263999999999996`, `18.00030000000001`).
- **19 submissions land after day 1 closed**, the latest 96 minutes late; day 2 has stragglers up to
  29 minutes late. The history stream stops cleanly at 18:59 both days.
- **No score:** `IRL3` only — the best "everyone competed" record after 2021. `GHA2` submitted but also
  finished on 0.
- **Nine teams are under strength,** including `RWA` with a single contestant.
- **Every face is exactly 350×450** — the most uniform set in the archive.
- Highest score: `CHN4` with 591.23. Busiest contestant: `THA3` with 172 submissions.

## 2026

Tashkent, Uzbekistan. 386 contestants, 97 teams, 17 270 submissions, 5 622 history events.

- **The only year with `"face_ext": "jpg"`** in `asset_config`, so faces are `.jpg` — and `IRN3.jpg` is
  a PNG behind the JPEG extension, mirroring the inverse problem every other year has.
- **`VEN4` has no face file** (385 faces for 386 contestants).
- **Four mixed teams** `IOI1`–`IOI4` with user keys `IOI11`–`IOI44`, which `DataStore` displays as
  `IOI1_1` … `IOI4_4` so the team digit and the contestant digit stay legible.
- **`data/ioi-2026/flags/` ships distinct `IOI1`–`IOI4` flags that the site never shows**, because flag
  lookup truncates the team key to three characters and falls back to the shared `IOI.png`.
- **Uzbekistan fields 8 contestants** (`UZB1`–`UZB8`) as host. `UZB5` (Sardor Salimov) officially got an
  out-of-competition Honourable Mention, which the archive cannot represent.
- **15 contestants have no score at all** — `ALB3`, `ECU3`, `GHA2`, `ISL2`, `JOR3`, `JOR4`, `LBY3`,
  `NGA1`–`NGA4`, `PSE3`, `RWA2`, `VEN2`, `VEN3` — the most of any year. `ISL2`, `LBY3`, `NGA1`–`NGA4` and
  `PSE3` have empty submission lists, and those same seven are the year's unmapped-to-stats contestants
  with no official record *(inferred: registered but did not compete)*. All of Nigeria falls in this
  group.
- **`PAK3` has an empty last name** (`Faisal`, blank) — the only contestant in the archive with a missing
  name component.
- **`MNG1` and `MNG3` are both named Erkhem Ganzorig** — the only duplicate name in the archive, and they
  are distinct people with distinct stats IDs.
- **`magiccity` has 51 subtask columns**, by far the widest submission table in the archive.
- **Montenegro fields a single contestant**; `ALB`, `DOM` and `GHA` field 3.
- Highest score: `CHN1` with 498.27 — the lowest winning score in the archive. `IOI33` is second.

## What was checked

Roughly 80 automated checks were run over all nine years, in four rounds:

1. **Structure and completeness** — dataset presence, user/team/task/contest/score/submission/history
   counts, contest windows and durations, task definitions, score modes, subtask headers, users with no
   scores, empty submission lists, orphan keys in every direction.
2. **Assets** — missing faces, orphan face files, duplicate and placeholder images, file magic vs
   extension, image dimensions, file sizes, flag coverage for every team key, `asset_config` flags,
   leftover scrape artefacts.
3. **Consistency** — raw `data/` vs bundled `src/` data, scores vs submission lists, scores vs the
   history stream, monotonicity of history, duplicate submission IDs, timestamps outside contest
   windows, score precision and float artefacts, medal boundaries and ties.
4. **External cross-check** — every contestant against their stats.ioinformatics.org record: presence,
   total score, medal, and contestants present in one source but not the other.
