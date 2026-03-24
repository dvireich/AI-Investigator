#!/usr/bin/env bash
# Fails if any coverage-ignore comment is found in src/ directories.
# Pattern covers: v8 ignore, istanbul ignore, c8 ignore (all variants).
# Run from the repo root.

set -euo pipefail

PATTERN='v8 ignore|istanbul ignore|c8 ignore'
SEARCH_DIRS=("backend/src" "frontend/src")

found=0
for dir in "${SEARCH_DIRS[@]}"; do
  if grep -rn --include="*.ts" --include="*.tsx" -E "$PATTERN" "$dir" 2>/dev/null; then
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo ""
  echo "ERROR: coverage-ignore comments found in source files."
  echo "All code must be testable. Remove the ignore and write a real test instead."
  exit 1
fi

echo "OK: no coverage-ignore comments found."
