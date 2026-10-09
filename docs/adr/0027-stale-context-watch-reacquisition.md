# Retain editor buffers across an acquisition/watch generation race

The Pi acceptance stopped after an early Not now decision. A regression test
reproduces a related acquisition/watch gap: Trust can replace a context after
its acquisition response but before the renderer subscribes to its watch. The
old watch then fails with a typed stale-generation error, without a Replaced
event reaching that subscriber. Previously the renderer discarded its session.

A stale-generation watch failure now uses the same reacquisition path as a
Replaced event, retaining current unsaved buffers and fencing old queued work.
Three consecutive stale watches are the bound; an owned Snapshot resets it.
Other failures, including rejected authority, still make the session unavailable.
There is no timer, deadline extension, Daemon lifecycle change or weaker fence.
