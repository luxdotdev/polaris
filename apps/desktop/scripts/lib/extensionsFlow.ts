/**
 * Settings → Extensions in the smoke test (ENG-401): pair an Extension with
 * the local Host, see its pairing string once (it decodes to this Host and
 * its token), Done, then revoke it in two steps and see it gone.
 */
import type { ElectronApplication, Page } from "playwright-core";

interface ExtensionsFlowInput {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly step: (message: string) => void;
  readonly shoot: (name: string) => Promise<void>;
}

const PAIRINGS = `window.polaris.request("extensions.list", { hostKey: "local" }).then((r) => JSON.stringify(r.ok ? r.value.map((p) => [p.name, p.grant, p.revokedAt !== null]) : r.error))`;

export const extensionsFlow = async ({ app, page, step, shoot }: ExtensionsFlowInput) => {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("settings.open")?.click();
  });
  await page.getByRole("button", { name: "Extensions" }).click();

  const local = page.locator('[data-testid="extensions-host"][data-host="local"]');

  await local.getByTestId("pair-extension").click();
  const form = local.getByTestId("pair-form");

  await form.getByLabel("Name").fill("Phone shortcuts");
  await form.getByLabel("Approve").check();
  await form.getByLabel("Send turns").check();
  await shoot("settings-extensions-pair");
  await form.getByRole("button", { name: "Pair" }).click();

  const reveal = local.getByTestId("pairing-reveal");

  await reveal.waitFor({ timeout: 10_000 });
  const pairingString = (await reveal.getByTestId("pairing-string").textContent()) ?? "";

  const body = pairingString.replace(/^polaris-pair:v1:/, "");

  // SAFETY: the Daemon encodes a PairingPayload; the checks below fail loudly when it doesn't.
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    readonly hostName: string;
    readonly url: string | null;
    readonly token: string;
    readonly name: string;
  };

  if (!payload.token.startsWith("pol_ext_") || payload.name !== "Phone shortcuts")
    throw new Error("the pairing string doesn't carry the Pairing");
  step(`paired; the pairing string names ${payload.hostName} (url ${payload.url})`);
  await shoot("settings-extensions-paired");

  const saved = await page.evaluate<string>(PAIRINGS);

  if (saved !== JSON.stringify([["Phone shortcuts", ["read", "approve", "turn"], false]]))
    throw new Error(`the Pairing wasn't made with its Grant: ${saved}`);
  await reveal.getByRole("button", { name: "Done" }).click();

  const row = local.getByTestId("pairing-row");

  await row.getByRole("button", { name: "Revoke" }).click();
  await shoot("settings-extensions-revoke");
  await row.getByTestId("confirm-revoke").click();
  await local.getByText("No extensions paired with").waitFor({ timeout: 10_000 });
  step("revoked; the Host lists no live Pairing");

  await page.keyboard.press("Escape");
  await page.getByTestId("settings").waitFor({ state: "detached", timeout: 5_000 });
};
