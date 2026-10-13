/**
 * Copy that names the Client's own machine or its OS ("this Mac", "Finder", "macOS"), the one
 * place it varies by platform.
 */
import { type ClientPlatform, clientPlatform, toClientPlatform } from "./platform.ts";

export interface ClientCopy {
  /** In running text: "this Mac", "this PC". */
  readonly machine: string;
  /** The OS by name, for "A macOS notification" and "Match macOS". */
  readonly os: string;
  /** The menu item that selects a file in the file manager. */
  readonly reveal: string;
  /** The update's own app in the file manager. */
  readonly showApp: string;
  /** Where signed-in tokens are kept, ending "Tokens stay …". */
  readonly tokenStore: string;
  /** No token store on this machine, so no sign-in. */
  readonly noTokenStore: string;
  /** The token store refused this session. */
  readonly tokenStoreBlocked: string;
}

const MAC: ClientCopy = {
  machine: "this Mac",
  os: "macOS",
  reveal: "Reveal in Finder",
  showApp: "Show in Finder",
  tokenStore: "in the macOS keychain",
  noTokenStore: "This Mac has no keychain to keep tokens in, so Polaris can't sign in",
  tokenStoreBlocked:
    "Polaris can't use the macOS Keychain from this session, so it can't keep the sign-in",
};

const WINDOWS: ClientCopy = {
  machine: "this PC",
  os: "Windows",
  reveal: "Show in Explorer",
  showApp: "Show in Explorer",
  tokenStore: "encrypted to your Windows account",
  noTokenStore: "This PC can't encrypt tokens for your account, so Polaris can't sign in",
  tokenStoreBlocked: "Polaris can't encrypt tokens from this session, so it can't keep the sign-in",
};

const LINUX: ClientCopy = {
  machine: "this computer",
  os: "Linux",
  reveal: "Show in folder",
  showApp: "Show in folder",
  tokenStore: "in the system keyring",
  noTokenStore: "This computer has no keyring to keep tokens in, so Polaris can't sign in",
  tokenStoreBlocked:
    "Polaris can't use the system keyring from this session, so it can't keep the sign-in",
};

const COPY: Readonly<Record<ClientPlatform, ClientCopy>> = {
  darwin: MAC,
  win32: WINDOWS,
  linux: LINUX,
};

/** This Client's copy; pass a platform (any `process.platform` value) to name another's. */
export const clientCopy = (platform: string = clientPlatform()): ClientCopy =>
  COPY[toClientPlatform(platform)];
