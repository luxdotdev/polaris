import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandOutput,
  type SESv2ClientConfig,
} from "@aws-sdk/client-sesv2";
import { createElement } from "react";
import { render } from "react-email";
import { DownloadEmail, downloadSubject } from "../../../../emails/download";
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
      const html = await render(createElement(DownloadEmail));
      const text = await render(createElement(DownloadEmail), { plainText: true });

      await client.send(
        new SendEmailCommand({
          FromEmailAddress: env.POLARIS_EMAIL_FROM?.trim(),
          ConfigurationSetName: env.POLARIS_EMAIL_CONFIGURATION_SET?.trim(),
          Destination: { ToAddresses: [email] },
          Content: {
            Simple: {
              Subject: { Data: downloadSubject, Charset: "UTF-8" },
              Body: {
                Html: { Charset: "UTF-8", Data: html },
                Text: { Charset: "UTF-8", Data: text },
              },
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(10000) }
      );
    },
  };
}
