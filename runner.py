#!/usr/bin/env python3
"""
Poll git for updates every 60s; pull and restart training when behind remote.
Run from repo root: python3 runner.py

Env:
  TRAIN_COMMAND — shell command for training (default: npm run train-ai)
  POLL_INTERVAL_SEC — seconds between checks (default: 60)
  PYTHON — Python for log_metrics (used by train-ai child only via npm)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIVE_LOG = ROOT / "artifacts" / "training-live.log"
POLL_INTERVAL_SEC = int(os.environ.get("POLL_INTERVAL_SEC", "60"))
TRAIN_COMMAND = os.environ.get("TRAIN_COMMAND", "npm run train-ai")
WAIT_AFTER_TERM_SEC = int(os.environ.get("WAIT_AFTER_TERM_SEC", "30"))


def _which_npm() -> str | None:
    return shutil.which("npm")


def commits_behind_upstream() -> int | None:
    """Return N commits behind @{upstream}, or None if not applicable."""
    r = subprocess.run(
        ["git", "rev-list", "HEAD..@{upstream}", "--count"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return None
    try:
        return int(r.stdout.strip())
    except ValueError:
        return None


def fetch() -> None:
    subprocess.run(["git", "fetch"], cwd=ROOT, check=False, capture_output=True)


def is_behind_from_status() -> bool:
    r = subprocess.run(
        ["git", "status", "-uno"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return False
    out = r.stdout
    return "Your branch is behind" in out


def git_pull() -> bool:
    r = subprocess.run(["git", "pull"], cwd=ROOT)
    return r.returncode == 0


def start_training() -> tuple[subprocess.Popen, object]:
    LIVE_LOG.parent.mkdir(parents=True, exist_ok=True)
    log_f = open(LIVE_LOG, "ab", buffering=0)
    print(f"[!] Starting training → logging to {LIVE_LOG.relative_to(ROOT)}", flush=True)
    proc = subprocess.Popen(
        TRAIN_COMMAND,
        cwd=ROOT,
        shell=True,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    return proc, log_f


def ensure_training_running(
    proc: subprocess.Popen | None,
    log_f: object | None,
) -> tuple[subprocess.Popen | None, object | None]:
    if proc is not None and proc.poll() is None:
        return proc, log_f
    if proc is not None and proc.returncode is not None:
        print(f"[!] Training process exited with code {proc.returncode}", flush=True)
    if log_f is not None:
        try:
            log_f.close()
        except OSError:
            pass
    if not _which_npm():
        print("[!] npm not found on PATH; cannot start training.", file=sys.stderr, flush=True)
        sys.exit(1)
    return start_training()


def terminate_training(proc: subprocess.Popen | None, log_f: object | None) -> None:
    if proc is None or proc.poll() is not None:
        if log_f is not None:
            try:
                log_f.close()
            except OSError:
                pass
        return
    print("[!] Stopping training (SIGTERM)...", flush=True)
    proc.terminate()
    try:
        proc.wait(timeout=WAIT_AFTER_TERM_SEC)
    except subprocess.TimeoutExpired:
        print("[!] Training did not exit; sending SIGKILL", flush=True)
        proc.kill()
        proc.wait(timeout=10)
    if log_f is not None:
        try:
            log_f.close()
        except OSError:
            pass


def main() -> None:
    if not (ROOT / ".git").is_dir():
        print(f"[!] Not a git repo: {ROOT}", file=sys.stderr, flush=True)
        sys.exit(1)

    training_proc: subprocess.Popen | None = None
    log_out: object | None = None
    print(f"[!] Runner root={ROOT}  poll={POLL_INTERVAL_SEC}s  train={TRAIN_COMMAND!r}", flush=True)

    while True:
        training_proc, log_out = ensure_training_running(training_proc, log_out)
        time.sleep(POLL_INTERVAL_SEC)

        fetch()
        behind = commits_behind_upstream()
        if behind is None:
            behind = 1 if is_behind_from_status() else 0

        if behind <= 0:
            continue

        print(f"[!] New code detected ({behind} commit(s) behind upstream)", flush=True)
        terminate_training(training_proc, log_out)
        training_proc = None
        log_out = None

        if not git_pull():
            print("[!] git pull failed; will retry on next cycle", flush=True)
            continue

        print("[!] Starting training after pull", flush=True)
        training_proc, log_out = start_training()


if __name__ == "__main__":
    main()
