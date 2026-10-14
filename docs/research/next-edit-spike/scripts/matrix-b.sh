#!/bin/sh
# Sweep sanity check against the card's example, and the diff-last prompt experiment.
set -e
cd "$(dirname "$0")"
SW=$(cat ~/.cache/next-edit-spike/sweep.path)
NG="--spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48"
llama-server -m "$SW" --host 127.0.0.1 --port 8093 -c 8192 -np 1 -ngl 99 > ../raw/sanity-sweep.server.log 2>&1 &
pid=$!
until curl -sf 127.0.0.1:8093/health >/dev/null; do sleep 1; done
bun sanity-sweep.ts http://127.0.0.1:8093 > ../raw/sanity-sweep.txt
kill $pid; wait $pid 2>/dev/null || true
bun run.ts sweep-q8-ngram-difflast sweep-difflast "$SW" $NG
