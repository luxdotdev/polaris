/** The file in Paper E2 (reconnect.ts) and the proposal shown there. */
import type { InlinePatch } from "../model/patch.ts";

export const CODE = `import { type Host, type ConnectionState } from "../context";
import { dial, DialError } from "./transport";
import { log } from "../log";

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 500;

/** Keep retrying on our own until the host answers or we give up. */
export async function reconnect(host: Host): Promise<ConnectionState> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await dial(host.address, { timeoutMs: 4_000 });
      return "connected";
    } catch (err) {
      if (isAuthPrompt(err)) return "needs-attention";
      log.debug(\`reconnect \${host.name} failed\`, { attempt });
      await sleep(BASE_DELAY_MS * attempt);
    }
  }
  return "offline";
}

function isAuthPrompt(err: unknown): boolean {
  return err instanceof DialError && err.code === "AUTH_REQUIRED";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;

const OLD = "      await sleep(BASE_DELAY_MS * attempt);";

const NEW = [
  "      const backoff = Math.min(BASE_DELAY_MS * 2 ** attempt, 30_000);",
  "      await sleep(backoff * (0.8 + Math.random() * 0.4));",
].join("\n");

export const PROPOSAL = (content: string): InlinePatch => {
  const from = content.indexOf(OLD);

  return {
    summary: "Exponential backoff with ±20% jitter, capped at 30 s",
    replacements: from === -1 ? [] : [{ from, to: from + OLD.length, text: NEW }],
  };
};
