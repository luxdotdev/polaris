import type { SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { validEmail } from "./validation";

export type EmailEnv = Readonly<Record<string, string | undefined>>;

/** Validation and delivery use the same explicit Region and credential policy. */
export function readSesConfig(env: EmailEnv): SESv2ClientConfig | null {
  if (env.POLARIS_EMAIL_TRANSPORT === "fake") return null;
  const region = env.AWS_REGION?.trim();
  const sender = env.POLARIS_EMAIL_FROM?.trim();

  if (!region || !sender || !validEmail(sender) || !env.POLARIS_EMAIL_CONFIGURATION_SET?.trim())
    return null;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) return null;

  if (!accessKeyId && env.POLARIS_EMAIL_USE_ROLE !== "true") return null;

  const config: SESv2ClientConfig = {
    region,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
  };

  if (accessKeyId && secretAccessKey) {
    config.credentials = { accessKeyId, secretAccessKey };

    if (env.AWS_SESSION_TOKEN) {
      config.credentials = { accessKeyId, secretAccessKey, sessionToken: env.AWS_SESSION_TOKEN };
    }
  }

  return config;
}
