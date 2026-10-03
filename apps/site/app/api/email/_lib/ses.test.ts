import { describe, expect, test } from "bun:test";
import { readSesConfig } from "./ses";

const env = {
  AWS_REGION: "us-east-1",
  POLARIS_EMAIL_FROM: "download@example.com",
  POLARIS_EMAIL_CONFIGURATION_SET: "polaris-download",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/polaris-download-email",
};

describe("readSesConfig", () => {
  test("assumes the configured role and never builds static credentials", () => {
    const roles: string[] = [];
    const provider = async () => ({ accessKeyId: "from-sts", secretAccessKey: "from-sts" });

    const config = readSesConfig(
      { ...env, AWS_ACCESS_KEY_ID: "static-key", AWS_SECRET_ACCESS_KEY: "static-secret" },
      (roleArn) => {
        roles.push(roleArn);

        return provider;
      }
    );

    expect(roles).toEqual([env.AWS_ROLE_ARN]);
    expect(config?.credentials).toBe(provider);
  });

  test.each(["", "arn:aws:iam::123456789012:user/static", "arn:aws:iam::12:role/x"])(
    "refuses a missing or non-role ARN %#",
    (AWS_ROLE_ARN) => {
      let calls = 0;

      expect(
        readSesConfig({ ...env, AWS_ROLE_ARN }, () => {
          calls++;
          throw new Error("must not run");
        })
      ).toBeNull();
      expect(calls).toBe(0);
    }
  );
});
