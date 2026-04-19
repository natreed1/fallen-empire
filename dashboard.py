#!/usr/bin/env python3
"""
Streamlit dashboard for training_metrics.csv and artifacts/training-live.log
Run from repo root: streamlit run dashboard.py
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "training_metrics.csv"
LIVE_LOG = ROOT / "artifacts" / "training-live.log"
REFRESH_SEC = 5
STALE_SEC = float(os.environ.get("METRICS_STALE_SEC", "300"))
LOG_TAIL_LINES = int(os.environ.get("LOG_TAIL_LINES", "40"))


def _read_log_tail(n: int) -> str:
    if not LIVE_LOG.is_file():
        return ""
    try:
        with open(LIVE_LOG, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        return "".join(lines[-n:])
    except OSError as e:
        return f"(could not read log: {e})"


def main() -> None:
    st.set_page_config(
        layout="wide",
        page_title="Game AI Training Live Tracker",
    )
    st.title("Game AI Training Live Tracker")

    if not CSV_PATH.is_file():
        st.warning("No **training_metrics.csv** yet. Run `npm run train-ai` from the repo root to generate metrics.")
        time.sleep(REFRESH_SEC)
        st.rerun()
        return

    df = pd.read_csv(CSV_PATH)
    for col in (
        "epoch",
        "loss",
        "reward",
        "avg_cycle",
        "draw_rate",
        "max_cycle_rate",
        "avg_city_margin",
        "eval_seconds",
        "mean",
        "std",
    ):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if df.empty:
        st.warning("training_metrics.csv is empty.")
        time.sleep(REFRESH_SEC)
        st.rerun()
        return

    last = df.iloc[-1]
    try:
        last_ts = pd.to_datetime(last["timestamp"], utc=True, errors="coerce")
    except Exception:
        last_ts = pd.NaT

    now = pd.Timestamp.now(tz="UTC")
    stale = False
    if pd.isna(last_ts):
        stale = True
    else:
        age_sec = (now - last_ts).total_seconds()
        stale = age_sec > STALE_SEC

    st.caption(f"Last metric row: **{last.get('timestamp', '?')}**  ·  Auto-refresh every {REFRESH_SEC}s")
    if stale:
        st.warning(
            f"Metrics look stale (last row older than {STALE_SEC:.0f}s or bad timestamp). "
            "Training may have stopped, crashed, or is not logging."
        )

    prev = df.iloc[-2] if len(df) >= 2 else None

    def delta(cur: float, prev_val: float | None) -> str | None:
        if prev_val is None or pd.isna(prev_val) or pd.isna(cur):
            return None
        return f"{cur - prev_val:.4g}"

    c1, c2, c3, c4, c5, c6 = st.columns(6)
    with c1:
        st.metric("Current epoch", int(last["epoch"]) if pd.notna(last["epoch"]) else "—")
    with c2:
        st.metric(
            "Latest loss (match σ)",
            f"{float(last['loss']):.4f}" if pd.notna(last["loss"]) else "—",
            delta=delta(float(last["loss"]), float(prev["loss"]) if prev is not None else None),
        )
    with c3:
        st.metric(
            "Latest reward (fitness)",
            f"{float(last['reward']):.4f}" if pd.notna(last["reward"]) else "—",
            delta=delta(float(last["reward"]), float(prev["reward"]) if prev is not None else None),
        )
    with c4:
        ac = last.get("avg_cycle")
        pac = prev.get("avg_cycle") if prev is not None else None
        st.metric(
            "Avg game cycles",
            f"{float(ac):.1f}" if pd.notna(ac) else "—",
            delta=delta(float(ac), float(pac)) if pd.notna(ac) and pac is not None and pd.notna(pac) else None,
        )
    with c5:
        dr = last.get("draw_rate")
        st.metric(
            "Draw rate",
            f"{float(dr) * 100:.1f}%" if pd.notna(dr) else "—",
        )
    with c6:
        mcr = last.get("max_cycle_rate")
        st.metric(
            "Max-cycle hit rate",
            f"{float(mcr) * 100:.1f}%" if pd.notna(mcr) else "—",
        )

    m1, m2 = st.columns(2)
    with m1:
        st.subheader("Loss vs epoch")
        chart_df = df[["epoch", "loss"]].dropna()
        if not chart_df.empty:
            st.line_chart(chart_df.set_index("epoch"))
        else:
            st.info("No loss data.")

    with m2:
        st.subheader("Reward vs epoch")
        chart_df = df[["epoch", "reward"]].dropna()
        if not chart_df.empty:
            st.line_chart(chart_df.set_index("epoch"))
        else:
            st.info("No reward data.")

    m3, m4 = st.columns(2)
    with m3:
        st.subheader("Avg cycles vs epoch")
        chart_df = df[["epoch", "avg_cycle"]].dropna()
        if not chart_df.empty:
            st.line_chart(chart_df.set_index("epoch"))
        else:
            st.info("No avg_cycle data.")

    with m4:
        st.subheader("Draw rate vs epoch")
        chart_df = df[["epoch", "draw_rate"]].dropna()
        if not chart_df.empty:
            st.line_chart(chart_df.set_index("epoch"))
        else:
            st.info("No draw_rate data.")

    with st.expander("Live training log", expanded=False):
        tail = _read_log_tail(LOG_TAIL_LINES)
        if tail.strip():
            st.code(tail, language=None)
        else:
            st.info(
                f"No log at {LIVE_LOG.relative_to(ROOT)} yet. "
                "Run training (or `python3 runner.py`) to append output."
            )

    st.subheader("Last 10 rows")
    st.dataframe(df.tail(10), use_container_width=True)

    time.sleep(REFRESH_SEC)
    st.rerun()


main()
