# G2 preamble evidence

`before.json` is Harness's shared idle/sessions quick ×3 run from committed `ecc8cf30e135f902d897d34b75b01734977a9c35`. Its dirty flag records untracked dependency symlinks in the isolated worktree; Harness reported clean source. The after run and comparisons are recorded alongside it. No vendor process or real user home is used.

The after run measures this branch's working changes over that base. Background load is 3.9/4.9 busy cores. The pair flags only no-client RSS: before samples 134.14/74.30/72.11 MiB and after 131.55/75.75/128.44 MiB overlap. Idle footprint falls 92.70 → 88.92 MiB and wakeups stay 10.60/s. Five/ten-session peak footprint rises 102.09 → 108.22 / 120.66 → 127.63 MiB after first-session bootstrap activation, within paired tolerances. No clean overall performance pass is claimed.

`legacy-baseline.json` preserves the committed baseline used for `comparisons.json`: four before and six after gating exceedances. The machine's quick baseline refreshes only `sessions.m5.footprint_peak_mib` to the observed after samples, documenting the approved first-session activation cost. Every other metric and the baseline's original environment remain intact, so this metric's provenance is this evidence folder rather than that original environment. The other five after exceedances remain visible; the baseline is not broadly refreshed.

`preamble-text.json` contains the generated v1 context for each capability set. `preamble-tokens.json` counts those exact strings with `tiktoken==0.12.0`, `o200k_base`: Plain/Lead 212, worker 195, Gate 242, read-only 167, and other Harnesses 177 tokens. Role skills are additional instructions and are excluded from this short-context count. These are offline tokenizer counts, not measured provider billing or Anthropic token counts.

Reproduce the counts in an environment with that tokenizer installed:

```python
import json
import tiktoken
from pathlib import Path

texts = json.loads(Path("preamble-text.json").read_text())
encoding = tiktoken.get_encoding("o200k_base")
print({name: len(encoding.encode(text)) for name, text in texts.items()})
```

The scripted bootstrap tests exercise the actual preamble, bound tools and Constellations service; the integration test goes through a temporary real Daemon. They verify instruction delivery and the resulting tool call, rather than live Model comprehension. Neither probe produces a repository-read tool call. Fake Codex/Claude drivers verify the native instruction fields; ACP coverage verifies that hidden context is absent from normalized visible prompts.
