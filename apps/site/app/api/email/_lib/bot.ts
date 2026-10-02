import { checkBotId } from "botid/server";

export type BotCheck = (request: Request) => Promise<{ isBot: boolean; isVerifiedBot: boolean }>;

export async function checkEmailBot(request: Request) {
  if (
    !request.headers.has("x-is-human") ||
    request.headers.get("x-path") !== "/api/email" ||
    request.headers.get("x-method") !== "POST"
  ) {
    return { isBot: true, isVerifiedBot: false };
  }

  // An explicit HUMAN bypass only affects development; production always uses real detection.
  return checkBotId({ developmentOptions: { bypass: "HUMAN" } });
}
