import type { LanguageCheckout, HostId } from "@polaris/protocol";

export interface PreviewDocument {
  readonly hostKey: string;
  readonly hostId: HostId;
  readonly checkout: LanguageCheckout;
  readonly path: string;
}

export type PreviewTarget =
  | { readonly kind: "fragment"; readonly fragment: string }
  | { readonly kind: "external"; readonly url: string }
  | {
      readonly kind: "file";
      readonly path: string;
      readonly relativePath: string;
      readonly fragment: string;
    }
  | { readonly kind: "blocked" };

const controls = (value: string, maximum: number) =>
  Array.from(value).some(
    (character) => character.charCodeAt(0) <= maximum || character.charCodeAt(0) === 127
  );

const blocked: PreviewTarget = { kind: "blocked" };

const segments = (path: string): Array<string> | null => {
  const parts: Array<string> = [];

  for (const part of path.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part !== "" && part !== ".") parts.push(part);
  }

  return parts;
};

/** Lexical routing only; the authenticated Host must recheck canonical containment. */
export const previewTarget = (href: string, document: PreviewDocument): PreviewTarget => {
  if (!href || href.length > 8192 || controls(href, 32) || href.includes("\\")) return blocked;

  if (/^https?:/i.test(href)) {
    try {
      const url = new URL(href);

      return url.username || url.password ? blocked : { kind: "external", url: url.href };
    } catch {
      return blocked;
    }
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) return blocked;

  try {
    const [rawPath = "", rawFragment = ""] = href.split("#", 2);
    const fragment = decodeURIComponent(rawFragment);

    if (!rawPath) return { kind: "fragment", fragment };
    const relativePath = decodeURIComponent(rawPath);

    if (controls(relativePath, 31) || /[\\?:#]/.test(relativePath) || relativePath.startsWith("/"))
      return blocked;
    const root = document.checkout.path.replace(/\/+$/, "");

    if (!document.path.startsWith(`${root}/`)) return blocked;

    const directory = document.path
      .slice(root.length + 1)
      .split("/")
      .slice(0, -1)
      .join("/");

    const parts = segments(`${directory}/${relativePath}`);

    if (parts === null || parts.length === 0) return blocked;

    return { kind: "file", path: `${root}/${parts.join("/")}`, relativePath, fragment };
  } catch {
    return blocked;
  }
};
