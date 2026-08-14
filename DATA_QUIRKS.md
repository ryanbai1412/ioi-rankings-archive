# Data quirks

Tracker of known quirks in the archived data. Most originate in the upstream CMS scrape and are
preserved deliberately. Verified against `src/ioi-yyyy/data.json`, `data/ioi-yyyy/`, `src/public/`, and
stats.ioinformatics.org. Causes marked *(inferred)* are guesses.

## Cross-year

| Quirk | Years | Effect |
| --- | --- | --- |
| No IOI 2018 scrape | — | Years jump 2017 → 2019 |
| Face files are JPEG behind a `.png` extension | all but 2026 | Extension-trusting tooling breaks; browsers sniff and render |
| Missing face file has no fallback (`Config.get_face_url`) | 2020, 2024, 2026 | Broken image in user detail |
| Flag lookup truncates team key to 3 chars (`Config.get_flag_url`) | 2023–2026 | `IOI1`–`IOI4` all render the generic `IOI.png`; the per-team flags in `data/ioi-2026/flags/` are never used |
| Token flags not scraped (`tokened=0`) | all | Only material for 2017, which scores `max_tokened_last` |
| Medal cut-off falls inside a tie group | 2021, 2022, 2023 | CMS shares the rank, so the whole group gets the medal — matches official |
| Guest contestants (second host teams, `IOI*` teams) occupy ranks | 2019–2026 | Intended: `MEDAL_BOUNDARIES` are set to reproduce official results including guests |
| Out-of-competition Honourable Mention not representable | 2023 (`HUN8`), 2026 (`UZB5`) | Only two contestants whose archive medal differs from official |
| Raw float scores carry binary artefacts (`29.690000000000005`) | all but 2021 | Cosmetic; worst in 2025 (up to 20 dp) |
| Submissions timestamped after the contest window | all but 2020, 2021 | Usually minutes; see 2019 and 2024 |

## 2017

- User keys are `XXX_2d1`, not `XXX1` (`-` encoded as `_2d`); patched for display in `DataStore`.
- Iran's second team is keyed `IRI`, displayed as `IRN5`–`IRN8`, flag special-cased to `IRN`.
- Israel is absent: 4 contestants (2 silver, 2 bronze officially) are in the official results but not in
  the scrape *(inferred: competed off-site)*.
- `PSE_2d1` has 37 submissions but no official record and no `stats.json` mapping.
- `max_tokened_last` scoring + no tokens ⇒ 279 (user, task) scores cannot be reconstructed from the
  submission list. Scoreboard, history and official totals agree; only the submission list can't.
- Teams `EGY` and `DOM` exist with zero contestants.
- No score: `MAR_2d2`, `MAR_2d3`, `NGA_2d2`, `PSE_2d1`, `PSE_2d4`.

## 2019

- 327 of 331 face files are Wayback Machine HTML pages, not images. Only `CHN1`, `RUS2`, `TUR3`, `USA3`
  are real *(inferred: scraped via web.archive.org, which never archived the photos)*.
- `CAN2` has a `rect` submission dated 2019-08-09 13:08 UTC — 3 days (4 508 min) after day 1 closed.
- Day 2 window is 05:20–10:33 UTC (5h13m); the two days are named inconsistently (`Day1`, `Day2`).
- Azerbaijan fields a second team `AZE2` (`AZE5`–`AZE8`).
- No score: `PSE3`, `TKM3`, `UZB4`.

## 2020

- `ARG3` has no face file.
- `NGA3.png`, `NGA4.png` are the CMS default placeholder.
- Singapore fields 8 contestants (`SGP1`–`SGP8`).
- No score: `ISL1`, `NGA2`, `VEN1`.

## 2021

- `POL3.png` and `POL4.png` are byte-identical.
- Singapore fields 8 contestants (`SGP1`–`SGP8`).
- Two medal cut-offs split 4-way ties (silver rank 86, bronze rank 173).
- Otherwise the cleanest year: no missing scores or faces, no out-of-window timestamps, integer scores.

## 2022

- Mixed contestants sit in one 8-person team `IOI` (`IOI1`–`IOI8`), unlike 2023+ where they are split
  into teams of four.
- Indonesia fields 8 contestants (`IDN1`–`IDN8`).
- `ECU1`, `JOR1`, `TKM3`, `VEN4` have no official record and no `stats.json` mapping *(inferred:
  registered, did not compete)*.
- No score: `ECU1`–`ECU4`, `JOR1`, `NGA1`, `TKM3`, `VEN4`; of these `ECU1`, `JOR1`, `NGA1`, `TKM3`,
  `VEN4` submitted nothing.
- `ARM2` has a `prison` submission 1 490 min after day 1 closed.

## 2023

- Hungary fields 8 contestants (`HUN1`–`HUN8`); `HUN8` officially got an out-of-competition HM.
- Mixed teams `IOI1`/`IOI2` hold users `IOI1`–`IOI4`/`IOI5`–`IOI8` — team and user key namespaces
  overlap.
- Bronze cut-off splits a 4-way tie on 153.
- `GBR2.png` is 3.7 MB, `GBR1.png` 2.8 MB.
- No score: `CHL2`, `DOM2`, `ECU3`, `ECU4`, `JOR4`, `MNE4`, `TKM3`, `VEN1`.

## 2024

- All user keys are lowercase (`alb1`, `ioi23`); uppercased only for display, so `stats.json`, face
  filenames and external tooling see lowercase.
- `isr1`–`isr4` have no face files; four orphan `ioi41.png`–`ioi44.png` exist with no matching user
  *(inferred: team renamed `IOI4` → `ISR` after photo upload)*.
- `chn3` and `chn4` have day-2 scores exactly half their own submission-list and history values
  (`chn3` mosaic 100→50, hieroglyphs 100→50, sphinx 64→32; `chn4` mosaic 100→50, hieroglyphs 28→14,
  sphinx 100→50). The halved values match the official results, so the scoreboard is right and the
  submission list and score graph contradict it. Only year where history contradicts final scores.
- Placeholder faces: `arm4.png`, `ioi44.png`, `uzb3.png`, `uzb4.png`.
- Second Egyptian team uses `egy21`–`egy24` keys, not `egy5`–`egy8`.
- `chn1` is present with an empty submission list and 0 on every task.
- No score: `alb2`, `bol3`, `chn1`, `dza3`, `ecu4`, `nga2`, `ven2`, `ven3`; `bol3`, `dza3`, `ven2`,
  `ven3` also have no official record or `stats.json` mapping.
- `chl1` has a `mosaic` submission 206 min after day 2 closed.
- Face photos span 293 distinct dimensions, up to 8.6 MB (`hun3.png`).

## 2025

- Mixed teams are `IOI1` and `IOI3` — no `IOI2`.
- Bolivia fields a second team `BOL2` (`BOL5`–`BOL8`).
- Worst float noise in the archive: 2 133 submission scores and 55 task scores affected, up to 20 dp.
- 19 submissions land after day 1 closed (latest 96 min).
- No score: `IRL3`.

## 2026

- Only year with `"face_ext": "jpg"`; `IRN3.jpg` is a PNG behind that extension.
- `VEN4` has no face file.
- Four mixed teams `IOI1`–`IOI4` with user keys `IOI11`–`IOI44`, displayed as `IOI1_1` … `IOI4_4`.
- Uzbekistan fields 8 contestants (`UZB1`–`UZB8`); `UZB5` officially got an out-of-competition HM.
- 15 contestants have no score (most of any year): `ALB3`, `ECU3`, `GHA2`, `ISL2`, `JOR3`, `JOR4`,
  `LBY3`, `NGA1`–`NGA4`, `PSE3`, `RWA2`, `VEN2`, `VEN3`. Of these `ISL2`, `LBY3`, `NGA1`–`NGA4`, `PSE3`
  also submitted nothing and have no official record or `stats.json` mapping — all of Nigeria included.
- `PAK3` has an empty last name.
- `MNG1` and `MNG3` are both named Erkhem Ganzorig (distinct people, distinct stats IDs).
- `magiccity` has 51 subtask columns.
