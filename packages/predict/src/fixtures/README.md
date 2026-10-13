`mellum-sum.sse` is the unmodified response captured on 2026-10-13 from the orchestrator's shared llama-server at 127.0.0.1:8080, alias `mellum2-12b-a2.5b`, Mellum2 IQ4_XS, context 8192 and cache reuse 256. Input: `sum.py`, prefix `def add(a, b):\n    return `, suffix `\n`, Mellum SPM, temperature 0, max_tokens 32. Actual output: `a + b`.

The replay test splits it into individual UTF-8 bytes before decoding. This is live-recorded provider framing and generated output; error/boundary fixtures in the test files are synthetic. No upstream implementation was copied.
