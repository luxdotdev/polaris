---
status: proposed (ENG-941)
---

# Comments are events in the shared session's log

## Context

Review feedback today is a set of drafts kept on one device (`localStorage`, the latest 30
sessions). The Daemon sees them only once they are sent as a Turn, through `SendFeedback` and
`Turn.feedback`. In a Shared Session, a Teammate's Comment must reach the owner and every other
Teammate, survive restarts on every side, keep its author, and be sent later by someone else.
A Comment also anchors to things that move: a diff line in a later Turn, or text in a message.

A separate comment table on the Host would be simpler, but would not replay with the session,
would carry no Actor history, and would need its own feed to Clients and its own sync story.

## Decision

- Comments live in the Agent Session's event log: `CommentAdded`, `CommentEdited`,
  `CommentResolved` and `CommentReopened`, each with its Actor (ADR 0078, with the Teammate
  variant). They fold into the session's state and reach Clients on the session's existing feed.
- A Comment anchors to a diff line range on a file side at a Turn (the draft shape, `path`, `side`,
  `start`, `end`, `code`), or to a message and a text range in it. When the anchored code changes
  in a later Turn, the Comment is shown as outdated; it is never moved.
- Sending Comments is `SendFeedback` taking Comment IDs: one Turn whose Actor is whoever sent it,
  recording which Comments it carried. Each Comment keeps its author, and is shown as sent with
  that Turn.
- Adding a Comment needs the comment Grant; resolving needs the Comment's author, the owner or a
  Contributor. Comments change no Session State and never reach the Harness except through a Turn.
- An owner's drafts stay on their device until posted; posting adds the Comment.

## Consequences

A Comment is as durable as the session and replays with it, and the share log, the Actor on each
Comment and the Turn that carried it are one history. The Quint spec and its README mapping gain
the Comment events, the comment Grant and `SendFeedback` with Comment IDs in the same change.
Comments in sessions that were never shared are still possible, but solo users keep their local
drafts flow unchanged.
