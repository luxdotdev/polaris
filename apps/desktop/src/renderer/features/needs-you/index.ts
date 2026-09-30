/**
 * Needs You (B2): the inbox slot, the hover card slot, the publisher that feeds the menu bar
 * star, Dock badge and notifications, and the handler for what they send back.
 */
export { NeedsYouInbox } from "./ui/Inbox.tsx";

export { NeedsYouHover, type NeedsYouHoverProps } from "./ui/Hover.tsx";

export { NeedsYouPublisher } from "./ui/Publisher.tsx";

export { onNeedsYouEvent } from "./bridge.ts";

export { buildInbox, type Inbox } from "./model/inbox.ts";
