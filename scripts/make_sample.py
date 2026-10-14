"""Generate public/sample.csv: synthetic campaign data for the public demo.

Same columns as a 30-day campaign extract. The numbers are invented, but the file contains the same kinds of patterns
the tool is built to catch:
  - a sudden lead drop-off for two days while clicks stay normal (a tracking fault)
  - a slow decline in lead cost that pushes a large campaign below break-even
  - cheap leads that rarely qualify
  - a campaign that starts late in the month
  - small, noisy campaigns, some just below break-even
  - two invalid rows (a duplicate and an impossible one) for the validation to reject

Usage: py scripts/make_sample.py   (Python 3, standard library only; same output every run)
"""

import csv
import random
from datetime import date, timedelta
from pathlib import Path

SEED = 20260701
START = date(2026, 7, 1)
DAYS = 30
OUT = Path(__file__).resolve().parent.parent / "public" / "sample.csv"

# id, platform, daily spend, cost per click, click-to-lead rate, qualification rate, pattern
CAMPAIGNS = [
    ("S-11", "Meta", 900, 1.55, 0.085, 0.55, None),
    ("S-12", "Google", 700, 1.05, 0.070, 0.62, None),
    ("S-13", "TikTok", 850, 1.30, 0.065, 0.60, None),
    ("S-14", "Meta", 1800, 1.20, 0.078, 0.66, None),
    ("S-15", "Google", 750, 1.40, 0.080, 0.57, None),
    ("S-16", "TikTok", 700, 1.60, 0.062, 0.56, None),
    ("S-17", "Meta", 650, 1.25, 0.055, 0.55, "frozen"),
    ("S-18", "Google", 1250, 1.75, 0.062, 0.66, None),
    ("S-19", "TikTok", 1600, 1.85, 0.110, 0.58, None),
    ("S-20", "Meta", 1650, 2.05, 0.112, 0.61, None),
    ("S-21", "Google", 800, 1.75, 0.052, 0.66, None),
    ("S-22", "TikTok", 1400, 2.10, 0.090, 0.64, None),
    ("S-31", "Meta", 150, 1.75, 0.050, 0.47, None),
    ("S-32", "Google", 150, 1.20, 0.048, 0.50, None),
    ("S-33", "TikTok", 105, 1.35, 0.070, 0.62, None),
    ("S-34", "Meta", 135, 1.70, 0.062, 0.56, None),
    ("S-35", "Google", 135, 1.60, 0.055, 0.49, None),
    ("S-36", "TikTok", 85, 1.75, 0.050, 0.60, None),
    ("S-41", "Meta", 1750, 1.60, 0.070, 0.63, "drop"),
    ("S-42", "Google", 1500, 2.20, 0.090, 0.62, "decline"),
    ("S-43", "TikTok", 1100, 1.50, 0.044, 0.94, None),
    ("S-44", "Meta", 1400, 1.20, 0.100, 0.14, None),
    ("S-45", "Google", 1350, 1.40, 0.066, 0.57, None),
    ("S-46", "TikTok", 520, 1.90, 0.058, 0.55, "late"),
]

DROP_DAYS = {date(2026, 7, 13): 0.03, date(2026, 7, 14): 0.06}
FROZEN_DAY = date(2026, 7, 20)
LATE_START = date(2026, 7, 22)


def binomial(rng: random.Random, n: int, p: float) -> int:
    return sum(1 for _ in range(n) if rng.random() < p)


def main() -> None:
    rng = random.Random(SEED)
    rows = []
    for cid, platform, spend_base, cpc, cvr, qual, pattern in CAMPAIGNS:
        prev = None
        for i in range(DAYS):
            day = START + timedelta(days=i)
            if pattern == "late" and day < LATE_START:
                continue
            if pattern == "frozen" and day == FROZEN_DAY and prev:
                rows.append({**prev, "date": day.isoformat()})
                continue

            spend = spend_base * rng.gauss(1, 0.08)
            this_cvr = cvr * rng.gauss(1, 0.12)
            if pattern == "decline":
                # Leads get steadily more expensive over the month.
                this_cvr *= 1 - 0.6 * i / (DAYS - 1)
            if pattern == "drop" and day in DROP_DAYS:
                this_cvr = cvr * DROP_DAYS[day]

            clicks = max(1, round(spend / (cpc * rng.gauss(1, 0.05))))
            leads = min(clicks, binomial(rng, clicks, max(0.0, this_cvr)))
            qualified = binomial(rng, leads, qual)
            row = {
                "date": day.isoformat(),
                "campaign_id": cid,
                "platform": platform,
                "spend": f"{spend:.2f}",
                "clicks": clicks,
                "leads": leads,
                "qualified_leads": qualified,
            }
            rows.append(row)
            prev = row

    rows.sort(key=lambda r: (r["date"], r["campaign_id"]))

    # Two rows the validation must reject.
    rows.insert(400, dict(rows[399]))
    bad = dict(rows[150])
    bad["qualified_leads"] = int(bad["leads"]) + 5
    rows.insert(151, bad)

    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUT}")


if __name__ == "__main__":
    main()
