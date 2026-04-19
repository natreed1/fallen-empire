#!/usr/bin/env python3
"""
Append one training metrics row to training_metrics.csv (repo root cwd).
Invoked from scripts/train-ai.ts via: python3 log_metrics.py < stdin JSON
"""

from __future__ import annotations

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

CSV_NAME = "training_metrics.csv"

OPTIONAL_NUMERIC_KEYS = (
    "avg_cycle",
    "draw_rate",
    "max_cycle_rate",
    "avg_city_margin",
    "eval_seconds",
    "mean",
    "std",
)

FIELDNAMES = (
    "epoch",
    "loss",
    "reward",
    "timestamp",
    *OPTIONAL_NUMERIC_KEYS,
    "extras",
)


def log_metrics(epoch: float | int, loss: float, reward: float, **kwargs) -> None:
    """Append a row to training_metrics.csv; create file with headers if missing."""
    timestamp = kwargs.pop("timestamp", None)
    if not timestamp:
        timestamp = datetime.now(timezone.utc).isoformat()

    row: dict[str, str | int | float] = {
        "epoch": epoch,
        "loss": loss,
        "reward": reward,
        "timestamp": timestamp,
    }
    for key in OPTIONAL_NUMERIC_KEYS:
        val = kwargs.pop(key, None)
        row[key] = "" if val is None else val

    extras = json.dumps(kwargs, separators=(",", ":")) if kwargs else ""
    row["extras"] = extras

    path = Path.cwd() / CSV_NAME
    write_header = not path.exists()

    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        if write_header:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in FIELDNAMES})


def main() -> None:
    raw = sys.stdin.read()
    if not raw.strip():
        print("log_metrics: expected JSON on stdin", file=sys.stderr)
        sys.exit(1)
    data = json.loads(raw)
    log_metrics(**data)


if __name__ == "__main__":
    main()
