#!/usr/bin/env bash
#
# citations-weekly.sh — cron helper for the AI Citation Tracker.
#
# Runs the `seoflow citations` probe pack for a site and appends the run to
# .seoflow/data/citations-history.json (read-only probing — never touches posts).
# Exits 0 when the site has no AI keys (GEMINI_API_KEY / OPENROUTER_API_KEY),
# so a cron line never "fails" just because a site is not configured.
#
# Usage:
#   scripts/citations-weekly.sh [site-dir] [--topic <name>] [--limit <n>]
#
# Examples:
#   # Default site (~/Documents/Projects/chasingwhereabouts), full pack
#   bash scripts/citations-weekly.sh
#
#   # Explicit site, keep it cheap (one topic, 6 probes)
#   bash scripts/citations-weekly.sh ~/Documents/Projects/thevenicepass --topic pass-worth --limit 6
#
#   # Cron (every Monday 06:00):
#   # 0 6 * * 1 cd /path/to/seoflow && bash scripts/citations-weekly.sh >> ~/logs/citations-weekly.log 2>&1
#
# Notes:
#   - Requires node + the repo's dev deps (tsx) — run from the seoflow repo or
#     point SEOFLOW_REPO at it:  SEOFLOW_REPO=/path/to/seoflow bash scripts/citations-weekly.sh
#   - Or use the stdlib-only Python mirror instead:
#       cd <site-dir> && python3 <repo>/python/ai_citation_probe.py

set -euo pipefail

# Resolve the seoflow repo root (this script lives in <repo>/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${SEOFLOW_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUN_TS="$REPO_DIR/run.ts"

SITE_DIR="${1:-$HOME/Documents/Projects/chasingwhereabouts}"
shift || true

if [[ ! -f "$SITE_DIR/seoflow.config.json" ]]; then
  echo "⏭  citations-weekly: no seoflow.config.json in $SITE_DIR — skipping (exit 0)."
  exit 0
fi

if [[ ! -f "$SITE_DIR/.env.local" ]]; then
  echo "⏭  citations-weekly: no .env.local in $SITE_DIR — skipping (exit 0)."
  exit 0
fi

echo "🔎 citations-weekly: $(date -u +%Y-%m-%dT%H:%M:%SZ) — $SITE_DIR"
cd "$SITE_DIR"
npx tsx "$RUN_TS" citations "$@"
