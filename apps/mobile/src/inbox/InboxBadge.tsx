/** The header's needs you badge (Paper MX-C) opening the inbox; hidden while nothing needs you. */
import { NeedsYouBadge } from "../home/ui/NeedsYouBadge.tsx";
import { useInbox } from "./InboxProvider.tsx";

export const InboxBadge = () => {
  const inbox = useInbox();

  return <NeedsYouBadge count={inbox.count} onPress={inbox.open} />;
};
