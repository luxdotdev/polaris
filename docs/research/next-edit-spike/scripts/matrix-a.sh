#!/bin/sh
# Full runs for Sweep Q8 and Zeta 2.1 Q4_K_M, one server at a time on 127.0.0.1:8091.
set -e
cd "$(dirname "$0")"
SW=$(cat ~/.cache/next-edit-spike/sweep.path)
Z4=~/.cache/next-edit-spike/models/zeta-2.1.Q4_K_M.gguf
NG="--spec-type ngram-simple --spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48"
bun run.ts sweep-q8-none sweep "$SW"
bun run.ts sweep-q8-ngram sweep "$SW" $NG
bun run.ts zeta-q4-frozen-ngram zeta-frozen "$Z4" $NG
bun run.ts zeta-q4-live-ngram zeta "$Z4" $NG
bun run.ts zeta-q4-frozen-none zeta-frozen "$Z4"
echo done
