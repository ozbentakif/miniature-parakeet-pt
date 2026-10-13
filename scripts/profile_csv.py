"""Quick data-quality profile of a CSV file. Standard library only.

Usage: py scripts/profile_csv.py path/to/file.csv [--group COLUMN]

Reports, per column: inferred type, missing values, distinct values, and
min / max / mean / sum for numbers or the date range for dates.
Also reports duplicate rows and, with --group, row counts per value.
"""
import argparse
import csv
import statistics
import sys
from collections import Counter
from datetime import datetime

DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d.%m.%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S")
MISSING = {"", "na", "n/a", "null", "none", "nan", "-"}


def to_number(v):
    s = v.strip().replace(",", "").replace("$", "").replace("%", "").replace("€", "").replace("£", "")
    try:
        return float(s)
    except ValueError:
        return None


def to_date(v):
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(v.strip(), fmt)
        except ValueError:
            pass
    return None


def profile(path, group=None):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        rows = [r for r in reader if any(c.strip() for c in r)]

    print(f"File: {path}")
    print(f"Rows: {len(rows):,}   Columns: {len(header)}")
    bad = [i + 2 for i, r in enumerate(rows) if len(r) != len(header)]
    if bad:
        print(f"WARNING: {len(bad)} rows have a different number of fields than the header (first lines: {bad[:5]})")

    dupes = sum(n - 1 for n in Counter(tuple(r) for r in rows).values() if n > 1)
    print(f"Exact duplicate rows: {dupes}")
    print()

    for i, name in enumerate(header):
        values = [r[i] if i < len(r) else "" for r in rows]
        present = [v for v in values if v.strip().lower() not in MISSING]
        missing = len(values) - len(present)
        nums = [n for n in (to_number(v) for v in present) if n is not None]
        dates = [d for d in (to_date(v) for v in present) if d is not None] if len(nums) < len(present) else []
        distinct = len(set(present))
        line = f"- {name}: missing {missing} ({missing / max(len(values), 1):.0%}), distinct {distinct}"

        if present and len(nums) == len(present):
            negatives = sum(1 for n in nums if n < 0)
            zeros = sum(1 for n in nums if n == 0)
            line += (f", number: min {min(nums):,.2f}, max {max(nums):,.2f}, mean {statistics.fmean(nums):,.2f}, "
                     f"sum {sum(nums):,.2f}, zeros {zeros}, negatives {negatives}")
        elif present and len(dates) == len(present):
            days = len({d.date() for d in dates})
            line += f", date: {min(dates).date()} to {max(dates).date()} ({days} distinct days)"
        else:
            top = ", ".join(f"{v} ({n})" for v, n in Counter(present).most_common(5))
            mixed = f", {len(nums)} numeric values mixed in" if nums else ""
            line += f", text{mixed}, top: {top}"
        print(line)

    if group:
        if group not in header:
            sys.exit(f"\nColumn '{group}' not found. Columns: {', '.join(header)}")
        gi = header.index(group)
        print(f"\nRows per {group}:")
        for v, n in Counter(r[gi] for r in rows).most_common():
            print(f"  {v}: {n}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("path")
    ap.add_argument("--group", help="column to count rows by")
    a = ap.parse_args()
    profile(a.path, a.group)
