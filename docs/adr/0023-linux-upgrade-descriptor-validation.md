# Validate Linux upgrade resources after Bun resets descriptor flags

The Slice 6 probe on linux-arm64, Bun 1.3.13, passed an inheritable Unix listener
through execve in the same PID. The new runtime reported FD_CLOEXEC set while
SO_ACCEPTCONN still proved the listener valid. Treating that flag as evidence of
failed inheritance rejected a usable handoff and left the upgrade receipt at exec.

On Linux, validate open descriptors and their resources instead of requiring the
startup flag to remain cleared. The listener must still be a listening socket;
child descriptors must be stream sockets or PTY masters. Preserve PID ownership,
descriptor bounds, all-or-nothing validation, and reapply close-on-exec before
spawning children. Darwin retains its existing flag check. Invalid handoffs still
fall back to cold startup without closing unrelated descriptors.

The opt-in remote acceptance checks the compiled Daemon upgrade receipt and PID.
The handoff-flags fixture reproduces startup flag resets on a real listener and
child socket; invalid-envelope and compiled upgrade tests retain the failure gates.
