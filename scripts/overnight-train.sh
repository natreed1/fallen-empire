#!/usr/bin/env bash
# Long-running AI evolution: seed from public/ai-params.json, heavy search, parallel workers.
# Usage: npm run train-ai-overnight
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/artifacts"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="${ROOT}/artifacts/overnight-train-${STAMP}.log"
PIDFILE="${ROOT}/artifacts/overnight-train.pid"
STARTED="${ROOT}/artifacts/overnight-train-${STAMP}.started.txt"

export TRAIN_GENERATIONS="${TRAIN_GENERATIONS:-100}"
export TRAIN_POPULATION_SIZE="${TRAIN_POPULATION_SIZE:-24}"
export TRAIN_MATCHES_PER_PAIR="${TRAIN_MATCHES_PER_PAIR:-24}"
export TRAIN_MAX_CYCLES="${TRAIN_MAX_CYCLES:-480}"
export TRAIN_MAP_SIZE="${TRAIN_MAP_SIZE:-52}"
export TRAIN_ELITE_COUNT="${TRAIN_ELITE_COUNT:-8}"
export TRAIN_MUTATION_STRENGTH="${TRAIN_MUTATION_STRENGTH:-0.2}"
export TRAIN_DRAW_PENALTY="${TRAIN_DRAW_PENALTY:-22}"
export TRAIN_VARIANCE_PENALTY="${TRAIN_VARIANCE_PENALTY:-0.42}"
export TRAIN_FROM_CHAMPION="${TRAIN_FROM_CHAMPION:-1}"
export TRAIN_SHOW_BATTLES="${TRAIN_SHOW_BATTLES:-2}"
export NUM_WORKERS="${NUM_WORKERS:-6}"

{
  echo "overnight-train started $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "TRAIN_GENERATIONS=$TRAIN_GENERATIONS TRAIN_POPULATION_SIZE=$TRAIN_POPULATION_SIZE"
  echo "TRAIN_MATCHES_PER_PAIR=$TRAIN_MATCHES_PER_PAIR TRAIN_MAX_CYCLES=$TRAIN_MAX_CYCLES"
  echo "TRAIN_MAP_SIZE=$TRAIN_MAP_SIZE NUM_WORKERS=$NUM_WORKERS"
  echo "TRAIN_ELITE_COUNT=$TRAIN_ELITE_COUNT TRAIN_DRAW_PENALTY=$TRAIN_DRAW_PENALTY"
  echo "log=$LOG"
} | tee "$STARTED"

nohup npx ts-node -r tsconfig-paths/register --project tsconfig.train.json scripts/train-ai.ts >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo ""
echo "Background PID $(cat "$PIDFILE") (also in $PIDFILE)"
echo "Log file: $LOG"
echo "Tail: tail -f $LOG"
