#!/bin/bash

set -euo pipefail

if ! command -v biome >/dev/null 2>&1; then
  echo "biome not found; run 'mise install' or 'bun install'"
  exit 1
fi

frontend_files=(
)

for directory in packages apps tests scripts; do
  if [ ! -d "${directory}" ]; then
    continue
  fi

  while IFS= read -r -d '' file; do
    frontend_files+=("${file}")
  done < <(
    find "${directory}" \
      -type d \( -name node_modules -o -name dist -o -name src-tauri -o -name target \) -prune \
      -o -type f \
      \( -name '*.ts' \
      -o -name '*.tsx' \
      -o -name '*.js' \
      -o -name '*.jsx' \
      -o -name '*.mjs' \
      -o -name '*.cjs' \
      -o -name '*.css' \
      -o -name '*.svelte' \) \
      -print0
  )
done

if [ ${#frontend_files[@]} -eq 0 ]; then
  exit 0
fi

biome format --write "${frontend_files[@]}"
