import type { SESv2ClientConfig } from "@aws-sdk/client-sesv2";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";
import { validEmail } from "./validation";

export type EmailEnv = Readonly<Record<string, string | undefined>>;

export type RoleCredentials = (roleArn: string) => NonNullable<SESv2ClientConfig["credentials"]>;

const ROLE_ARN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/;

const vercelRole: RoleCredentials = (roleArn) => awsCredentialsProvider({ roleArn });

/**
 * Validation and delivery use the same explicit Region and an IAM role assumed with
 * Vercel's OIDC token; static access keys are never read (docs/adr/0018).
 */
export function readSesConfig(
  env: EmailEnv,
  credentialsFor: RoleCredentials = vercelRole
): SESv2ClientConfig | null {
  if (env.POLARIS_EMAIL_TRANSPORT === "fake") return null;
  const region = env.AWS_REGION?.trim();
  const sender = env.POLARIS_EMAIL_FROM?.trim();
  const roleArn = env.AWS_ROLE_ARN?.trim();

  if (!region || !sender || !validEmail(sender) || !env.POLARIS_EMAIL_CONFIGURATION_SET?.trim())
    return null;

  if (!roleArn || !ROLE_ARN.test(roleArn)) return null;

  return {
    region,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    credentials: credentialsFor(roleArn),
  };
}
