import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { LanguageCheckout, LanguageError } from "@polaris/protocol";
import { Schema } from "effect";

export interface CheckoutRegistration {
  checkout: LanguageCheckout;
  workspacePath: string;
}

/** Supplied by the authenticated Daemon registry, never by a Client payload. */
export type CheckoutRegistry = (checkout: LanguageCheckout) => Promise<CheckoutRegistration>;

export interface CanonicalCheckout {
  checkout: LanguageCheckout;
  root: string;
  workspaceRoot: string;
}

export const within = (root: string, path: string): boolean => {
  const suffix = relative(root, path);

  return (
    suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))
  );
};

export const invalid = (message: string) =>
  new LanguageError({ reason: "invalid-input", message, retryable: false });

export const checkoutKey = (checkout: LanguageCheckout): string =>
  JSON.stringify(
    LanguageCheckout.match(checkout, {
      Workspace: (value) => [value.workspaceId, "workspace"],
      Worktree: (value) => [value.workspaceId, "worktree", value.worktreeId],
      ReviewCheckout: (value) => [value.workspaceId, "review", value.reviewCheckoutId],
    })
  );

export async function canonicalCheckout(
  registry: CheckoutRegistry,
  input: LanguageCheckout
): Promise<CanonicalCheckout> {
  const checkout = Schema.decodeUnknownSync(LanguageCheckout)(input);
  const registered = await registry(checkout);

  if (checkoutKey(registered.checkout) !== checkoutKey(checkout)) {
    throw invalid("Checkout identity does not match the Host registry");
  }

  const root = await realpath(registered.checkout.path);

  if ((await realpath(checkout.path)) !== root)
    throw invalid("Checkout path does not match the Host registry");
  const workspaceRoot = await realpath(registered.workspacePath);

  return { checkout: { ...registered.checkout, path: root }, root, workspaceRoot };
}

export async function checkoutPath(context: CanonicalCheckout, input: string): Promise<string> {
  const lexical = resolve(context.root, input);

  if (!within(context.root, lexical)) throw invalid("Path leaves the checkout");
  const canonical = await realpath(lexical);

  if (!within(context.root, canonical)) throw invalid("Canonical path leaves the checkout");

  return canonical;
}

/** An open document's path: like `checkoutPath`, but an unsaved document need not exist on disk. */
export async function checkoutDocumentPath(
  context: CanonicalCheckout,
  input: string
): Promise<string> {
  const lexical = resolve(context.root, input);

  const missing = await lstat(lexical).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === "ENOENT"
  );

  if (!missing) return checkoutPath(context, lexical);
  const parent = await checkoutPath(context, dirname(lexical));

  return join(parent, basename(lexical));
}
