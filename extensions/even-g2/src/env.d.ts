/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** A pairing string the dev server seeds when the WebView has none (`bun run dev:glasses`). */
  readonly VITE_POLARIS_PAIRING?: string;
}
