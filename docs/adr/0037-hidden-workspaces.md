---
status: accepted
implements: hiding a Workspace from the top bar (owner ask, 2026-10-13)
---

# Hiding a Workspace is a Host flag, and it never hides a Needs You

The owner wants to pick which Workspaces the top bar shows, without deleting
anything. The protocol already had `SetWorkspaceHidden { workspaceId, hidden }`
and `Workspace.hidden`, decided by the Engine as a plain `WorkspaceUpdated`;
only the UI was missing. This change adds UI only: no command, event or
decision changes, so the spec is untouched.

## The flag lives on the Host

Hidden is part of the Workspace the Host keeps, so every Client connected to
that Host agrees. We kept it there rather than adding a per-Client list:
the Workspace registry is the Host's (CONTEXT.md, Workspace), re-adding a
folder already un-hides it on the Host (`onboarding/ensureWorkspace.ts`), and
a second Mac showing a Workspace the user hid on the first would be the
surprise. A per-Client override can come later if two Macs want different bars.

## Hidden is not gone

Hiding removes a Workspace from the top bar's chips, their ⌃N, the machine
sidebar's groups and the count that turns on the machine bar at 11. It keeps:

- **Its sessions.** Agent Sessions keep running; their feeds, review data,
  worktrees and terminals are untouched.
- **Reach.** The jump menu lists hidden Workspaces, marked "hidden", and the
  Host's menu and the Command Palette show them again.
- **Selection.** A hidden Workspace the user opens (a jump, a session in it
  from the inbox or a notification) stays open: `resolveSelection` accepts any
  registered Workspace the navigation chose, but never picks a hidden one on
  its own. It is listed as a chip after its Host's others, marked "hidden",
  with no ⌃N, until the user goes elsewhere. Before this change, opening a
  session in a hidden Workspace snapped back to the first chip.

## Needs You wins over hidden

A hidden Workspace with a session that needs you (not dismissed on this Mac)
is listed the same way, with its count, until the session is answered
(PRODUCT.md: attention pointed at risk). Hiding is about clutter, and an
agent waiting on the user is never clutter. The inbox, "Needs you elsewhere",
the machine tab's count, the menu bar star and notifications counted it all
along and still do.

We considered un-hiding a Workspace automatically when it needs you or when
the user opens it. That silently undoes the user's choice on every Client of
that Host; the listed-while-relevant chip shows the same signal and leaves the
choice alone.
