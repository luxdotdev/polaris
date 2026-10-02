#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture_root=$(mktemp -d /private/tmp/polaris-lsp-feasibility.XXXXXX)
mkdir -p "$fixture_root/tmp"
cp "$source_dir/fixture-package.json" "$fixture_root/package.json"
gzip -dc "$source_dir/pnpm-lock.yaml.gz" > "$fixture_root/pnpm-lock.yaml"
printf 'Disposable fixture: %s\n' "$fixture_root"
node "$source_dir/install.mjs" "$fixture_root"
node "$source_dir/cleanup.mjs" "$fixture_root"
node "$source_dir/client.mjs" "$fixture_root"
node "$source_dir/format.mjs" "$fixture_root"
node "$source_dir/providers.mjs" "$fixture_root"
node "$source_dir/typescript.mjs" "$fixture_root"
node "$source_dir/lsp.mjs" "$fixture_root"
node "$source_dir/faults.mjs" "$fixture_root"
printf 'PASS; evidence/logs retained under %s\n' "$fixture_root"
