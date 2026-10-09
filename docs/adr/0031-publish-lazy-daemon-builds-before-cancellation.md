# Publish lazy Daemon builds before cancellation

Language services, Constellation handlers and Host resources share a first-use build, retained by the Daemon Scope. A requesting Client may disconnect or cancel a feed during that build.

With Effect 4, `cached(build.pipe(uninterruptible))` restores interruption before the cache publishes its Exit. The cancelled first request can therefore cache an interruption despite successful construction. Every later request receives that interruption; language discovery never reaches its handler and no server starts.

Protect the memoized read itself: create `cached(build)`, then wrap the returned load with `uninterruptible`. Construction and publication finish before the requesting fiber observes cancellation. The requesting RPC still cancels, future requests reuse the successful graph, and resources close once in the existing Daemon Scope. Build failures retain their normal cached failure semantics. This adds no eager startup, retry timer, parallel service graph or expanded deadline.

The lazy RPC regression cancels its first invocation during a controlled build, verifies that subsequent invocations succeed with one build, and verifies exactly one resource finalizer at Daemon shutdown.
