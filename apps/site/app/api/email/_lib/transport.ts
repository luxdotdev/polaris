import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandOutput,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";
import { links, site } from "../../../../components/links";
import { validEmail } from "./validation";

export type EmailEnv = Readonly<Record<string, string | undefined>>;

export type EmailTransport = { send: (email: string) => Promise<void>; preview: boolean };

export type SesFactory = (config: SESv2ClientConfig) => {
  send: (
    command: SendEmailCommand,
    options: { abortSignal: AbortSignal }
  ) => Promise<Pick<SendEmailCommandOutput, "MessageId">>;
};

export function createTransport(
  env: EmailEnv,
  makeClient: SesFactory = (config) => new SESv2Client(config)
): EmailTransport | null {
  if (env.NODE_ENV !== "production") return { send: async () => {}, preview: true };

  if (env.POLARIS_EMAIL_TRANSPORT === "fake") return null;
  const region = env.AWS_REGION?.trim();
  const sender = env.POLARIS_EMAIL_FROM?.trim();

  if (!region || !sender || !validEmail(sender)) return null;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  const hasKeys = Boolean(accessKeyId && secretAccessKey);

  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) return null;

  if (!hasKeys && env.POLARIS_EMAIL_USE_ROLE !== "true") return null;

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

  const client = makeClient(config);

  return {
    preview: false,
    send: async (email) => {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: sender,
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: "Polaris for Mac", Charset: "UTF-8" },
              Body: {
                Text: {
                  Charset: "UTF-8",
                  Data: `Download Polaris for macOS:\n${site.origin}${links.download}\n\nRun Claude Code and Codex side by side, on any machine.\n\nView source:\n${links.source}\n\nYou requested this download link on ${site.origin}.`,
                },
              },
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(10000) }
      );
    },
  };
}
