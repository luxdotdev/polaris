/** `polaris://` links the Desktop App opens (its `shared/deepLink.ts`); ids percent-encoded. */
export const sessionLink = (hostId: string, sessionId: string): string =>
  `polaris://session/${encodeURIComponent(hostId)}/${encodeURIComponent(sessionId)}`;

export const workspaceLink = (hostId: string, workspaceId: string): string =>
  `polaris://workspace/${encodeURIComponent(hostId)}/${encodeURIComponent(workspaceId)}`;
