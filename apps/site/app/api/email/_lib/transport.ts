import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandOutput,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";
import { links, site } from "../../../../components/links";
import { readSesConfig, type EmailEnv } from "./ses";

export type { EmailEnv } from "./ses";

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

  const config = readSesConfig(env);

  if (!config) return null;

  const client = makeClient(config);

  return {
    preview: false,
    send: async (email) => {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: env.POLARIS_EMAIL_FROM?.trim(),
          ConfigurationSetName: env.POLARIS_EMAIL_CONFIGURATION_SET?.trim(),
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
