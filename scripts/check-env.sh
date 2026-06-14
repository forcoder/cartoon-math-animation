#!/usr/bin/env bash
# check-env.sh — verify the user has configured the keys needed to actually
# call the LLM. Exits 0 if OK, 1 if missing (with a friendly message).

set -euo pipefail

ENV_FILE="${1:-.env.local}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "  cp .env.example $ENV_FILE"
  echo "  # then fill in LLM_BASE_URL, LLM_API_KEY, LLM_MODEL"
  exit 1
fi

# Source the file (POSIX-compatible: only simple KEY=VALUE lines).
MISSING=0
while IFS='=' read -r key value; do
  # Skip comments and blank lines.
  [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
  if [ -z "$value" ]; then
    echo "ERROR: $key is not set in $ENV_FILE"
    MISSING=1
  fi
done < <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Fix: edit $ENV_FILE with your real values."
  echo "  LLM_BASE_URL=https://api.longcat.chat/openapi/v1"
  echo "  LLM_API_KEY=<your LongCat key>"
  echo "  LLM_MODEL=LongCat-2.0-Preview"
  exit 1
fi

echo "✓ $ENV_FILE looks good. Run 'npm run dev' then open http://localhost:3000"