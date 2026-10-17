# A defect fails only its request

effect/rpc treats a handler's defect as fatal by default: the server answers with a connection-level `Defect` message instead of the request's `Exit`, and the RpcClient dies every request and stream in flight on that connection with it. One broken handler (for instance a lazy build that died on Windows, ENG-299) ended the Client's host and session streams and every other request, and the Client reconnected.

The Daemon runs its RpcServer with `disableFatalDefects`. A defect becomes that request's `Exit` with a `Die` cause, encoded as before with `Schema.Defect()` (name and message, no stack). Other requests, streams and the connection carry on. The wire is unchanged: per-request `Exit` frames with a `Die` cause were already part of the protocol (unknown tags, encoding failures), so Clients of any version decode it as that one call dying. The Desktop App shows it as that request's `Defect` IPC error.

A defect no longer reaches the Client as an event that something is badly wrong, so the Daemon logs it: the `ConnectionBlobs` middleware, which wraps every request and stream, logs any cause with a defect at error level with the RPC's tag and the whole cause, stack included.

Expected failures must not be defects. Lazy builds whose failure is part of an RPC's contract map it to a typed error per request (`lazyRpcLayer`'s `failure`): a language graph that fails to build answers each language RPC with its `LanguageError` (`PredictionError` for the prediction context query). Builds whose failures are Host breakage (the Constellation graph's `ServiceError`, the resources broker) stay defects, now scoped to the request and logged.

A handler that throws synchronously while being called, before it returns an Effect or Stream, still reaches effect/rpc's connection-level path; handlers are written as Effects, and the lazy layers defer all work into one.

Daemons before this change (0.1.0 among them) still send the connection-level `Defect`, after which effect/rpc's RpcClient has dropped every request and stream while the transport stays open. The Client treats that frame as a lost connection (`packages/client/src/rpc.ts`): in-flight and later requests fail with an `RpcClientError` naming the defect, the ping bookkeeping is cleared, a warning is logged once, and HostConnection reconnects through the Connection State machine (a transient `connection-lost`, retried at once like any drop).
