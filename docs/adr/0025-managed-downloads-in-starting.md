# Managed downloads belong to the existing Starting launch

Cold basedpyright setup on the Pi exceeded the Client's 30-second discovery RPC
deadline. Discovery awaited managed installation even though the broker already
owns asynchronous installation in its Starting state, before launch reservation.

Discovery now checks the pinned artifact's platform and exact approval plus
developer prerequisites. Only private Node is deferred; Host installation facts
still report it as missing until installed. Starting performs the actual downloads
with the existing launch admission, current Trust/settings guard, cancellation and
selection barrier. Missing Python and disabled automatic downloads remain blocked.
No timeout, lifecycle transition, protocol event, timer or retry budget changes.
