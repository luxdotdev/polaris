/**
 * Test helper: random, never-issued credentials in the shapes of real ones.
 * They are built at test time, and every prefix is split, so no secret-shaped
 * string sits in the repository for a scanner or a push check to find.
 * Not used at run time.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const random = (length: number, alphabet: string) =>
  Array.from(randomBytes(length), (byte) => alphabet[byte % alphabet.length]).join("");

const digits = (length: number) => random(length, "0123456789");

export interface SyntheticSecret {
  /** Betterleaks' rule id that must report it. */
  readonly ruleId: string;
  readonly path: string;
  readonly content: string;
  /** The secret value, to check it never appears in a Finding. */
  readonly value: string;
}

const pem = () =>
  generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString()
    .trim();

/** Eight formats, each in its own file, each on line `line` (default 1). */
export const syntheticSecrets = (): ReadonlyArray<SyntheticSecret> => {
  const github = `${"gh"}p_${random(36, ALNUM)}`;
  const aws = `${"AK"}IA${random(16, BASE32)}`;
  const slack = `${"xo"}xb-${digits(11)}-${digits(13)}-${random(24, ALNUM)}`;
  const stripe = `${"sk"}_live_${random(99, ALNUM)}`;
  const openai = `${"sk"}-proj-${random(74, ALNUM)}${"T3Blbk"}FJ${random(74, ALNUM)}`;
  const anthropic = `${"sk"}-ant-api03-${random(93, ALNUM)}AA`;
  const key = pem();
  const password = random(24, ALNUM);

  return [
    {
      ruleId: "github-pat",
      path: "src/github.ts",
      content: `export const token = "${github}";\n`,
      value: github,
    },
    {
      ruleId: "aws-access-token",
      path: "deploy/aws.py",
      content: `AWS_ACCESS_KEY_ID = "${aws}"\nAWS_SECRET_ACCESS_KEY = "${random(40, ALNUM)}"\n`,
      value: aws,
    },
    {
      ruleId: "slack-bot-token",
      path: "bot/slack.go",
      content: `const slackToken = "${slack}"\n`,
      value: slack,
    },
    {
      ruleId: "stripe-access-token",
      path: "src/billing.ts",
      content: `const stripe = new Stripe("${stripe}");\n`,
      value: stripe,
    },
    {
      ruleId: "openai-api-key",
      path: "src/ai.ts",
      content: `const client = new OpenAI({ apiKey: "${openai}" });\n`,
      value: openai,
    },
    {
      ruleId: "anthropic-api-key",
      path: "src/claude.ts",
      content: `const key = "${anthropic}";\n`,
      value: anthropic,
    },
    { ruleId: "private-key", path: "keys/service.pem", content: `${key}\n`, value: key },
    {
      ruleId: "generic-credential-uri",
      path: "config/db.env",
      content: `DATABASE_URL=postgres://admin:${password}@db.corp-internal.net:5432/prod\n`,
      value: password,
    },
  ];
};
