/**
 * Comments in Review (M2-F, ENG-223): a pull request's threads and pending review on GitHub,
 * an Agent Session's feedback batch, the composer under selected lines, and Submit review.
 */
export { closeComposer } from "./data/actions.ts";

export { openComposer, useComments } from "./data/store.ts";

export { CommentsSection } from "./ui/CommentsSection.tsx";

export { CommentsSync } from "./ui/CommentsSync.tsx";

export { FeedbackCard } from "./ui/FeedbackCard.tsx";

export { SubmitReviewAction } from "./ui/SubmitReview.tsx";

// An Agent Session's Comments (ADR 0113; DESIGN.md, Shared Sessions).
export { openCommentDraft, useCommentDraft } from "./data/session.ts";

export {
  type ActorViewer,
  type LineThread,
  lineThreads,
  turnAuthorLabel,
} from "./model/session.ts";

export { PersonAvatar as ActorAvatar } from "./ui/session/parts.tsx";

export { useSessionComments } from "./ui/session/hooks.ts";

export { LineDraft, LineThreadCard } from "./ui/session/lines.tsx";

export { CommentTicks, type CommentTick } from "./ui/session/ticks.tsx";

export { MESSAGE_ATTR, SelectionComment, TURN_ATTR } from "./ui/session/selection.tsx";

export { SendComments } from "./ui/session/send.tsx";

export { MessageComments, QuotedComments, TurnAuthor } from "./ui/session/transcript.tsx";
