---
status: accepted
fixes: on Windows `spawnInJob` failed with CreateProcessW error 2 or 87 once a collection ran while it was building the call (ENG-317, ENG-341)
---

# bun:ffi buffers are passed as typed arrays, and Windows' long-held ones are owned

## Context

`ptr(view)` in Bun 1.4.3 returns the view's current storage address as a number
(`FFIObject.rs` → `JSArrayBufferView::vector()`). It doesn't pin or root anything. A buffer
made inline, `f(ptr(wide(path)), …)`, is unreachable as soon as `ptr()` returns. A local is
only live until its last use: once the DFG/FTL JIT compiles the function, a local whose last
use was `ptr(local)` is dead, and the next allocation can collect it and reuse its memory.

Measured on Windows 11 with Bun 1.4.3 (lucas-desktop), with `spawnInJob` run 400 times and
a forced collection while the environment block is built:

- At 381b3159, `ptr(wide(application))` and `ptr(wide(commandLine))` were built inline, and
  then `environmentBlock(env)` allocated. 400 of 400 runs failed with CreateProcessW error 2
  (and sometimes 123), which is the failure windows-latest CI hit.
- At 40be84b1 those buffers were held in locals. With JSC tiering up early
  (`BUN_JSC_thresholdFor*`), 98 of 1,000 runs still failed with error 87. The
  `PROC_THREAD_ATTRIBUTE_LIST` keeps a pointer to the handle values passed to
  `UpdateProcThreadAttribute`, and nothing referenced that array after `handleList` returned.
  With the values in a separate array, 626 of 1,000 failed.
- With the values in the list's own buffer and every buffer passed as an argument:
  0 of 3,000 failed.

Bun 1.4's FFI converts a typed array passed for a `ptr` argument in the engine. The DFG call
node takes the view as an operand and reads its `vector()` while it builds the native frame,
so the view is live until the call is made. During a native call the JS thread doesn't
allocate, so no collection can free the view.

## Decision

- **Pass the typed array, not `ptr()` of it**, for every `ptr` argument of a `bun:ffi` call:
  `CreateFileW(wide(path), …, attributes, …)`.
- **`ptr()` is only for an address stored in memory Windows reads**: the attribute list's
  address in `STARTUPINFOEXW`, or the handle values inside the list. The memory holding that
  address must keep its target alive. The handle values live in the attribute list's own
  buffer, and the list is passed again after `CreateProcessW` (to
  `DeleteProcThreadAttributeList`), which keeps it, and so them, alive across the call.
- **Memory Windows holds across calls is created over its own `ArrayBuffer`**: the
  attribute list and the pipe's `OVERLAPPED`. JSC can move a small typed array's storage
  when its `.buffer` is first read; one made over an `ArrayBuffer` never moves. A reference
  from long-lived JS state (the pipe's pending instance) keeps it reachable.
- **An `OVERLAPPED` is not released until its I/O has completed.** Stopping the pipe cancels
  the pending `ConnectNamedPipe` and then waits for it (`GetOverlappedResult` with `bWait`)
  before the instance is dropped, as `CancelIoEx`'s contract requires.
- **A `RegisterWaitForSingleObject` wait is always unregistered blocking** before its
  `JSCallback` is closed, including from the callback's own JS handler. A threadsafe
  callback only posts to the JS thread, so blocking can't deadlock, and the wait thread is
  then out of the thunk that `close()` lets JSC free.
- koffi (the Desktop App's `packages/client/src/windowsPipe/`) marshals its arguments
  during the call and keeps nothing afterwards, so it needs none of this.

## Consequences

- `windowsNative.test.ts` runs `spawnInJob` 400 times in a Bun with eager JIT tiers and a
  collection in the middle of every call. It fails at both 381b3159 and 40be84b1.
- `SetFileSecurityW(ptr(wide(path)), …, attributes[1]!)` read a `BigInt` (an allocation)
  after the inline path. With a GC on every slow-path allocation it failed 1 of 800 runs
  before the fix and 0 of 800 after. That rate is too low for a test.
- POSIX `bun:ffi` callers (`service/libc.ts`, `files/inotify.ts`, `languages/media/native.ts`,
  `packages/bench/src/proc.ts`) pass `ptr()` of locals that nothing allocates between and the
  call, or that a later use keeps alive (`execve`'s `keepAlive`). They are safe and unchanged.
