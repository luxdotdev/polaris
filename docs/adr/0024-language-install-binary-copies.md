# Bound language install copies and progress

Remote acceptance also exposed expensive per-chunk language-tool snapshots. Byte
progress is now emitted at most every 100 ms, with exact bytes on phase transitions.
There is no timer, polling, deadline extension, artifact change or durable event.
The rate test fails on the original per-chunk behavior and checks final byte counts.

The real Node archive also exposed element-wise `Uint8Array.from` copies of the
large executable: the isolated Pi installer reached 2.4 GiB RSS and took 33.3 s.
Typed-array constructors copy binary storage directly while retaining isolation
from adapter mutation. A regression fixture forbids element iteration and checks
that later adapter mutation cannot change staged bytes. Archive and size checks
are unchanged.
