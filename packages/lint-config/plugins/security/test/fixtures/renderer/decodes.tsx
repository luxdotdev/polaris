// Planted: Host bytes handed straight to a decoder, and Mermaid unguarded. Each line is one report.
import mermaid from "mermaid";
import type { MermaidConfig } from "mermaid";

export const planted = async (bytes: Uint8Array, img: HTMLImageElement) => {
  const blob = new Blob([bytes]);
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  await img.decode();
  await createImageBitmap(blob);
  document.createElement("img");
  new ImageDecoder({ data: bytes, type: "image/gif" });
  await import("@streamdown/mermaid");

  return mermaid;
};

// A type-only import and a text decode: no report.
export const fine = (config: MermaidConfig, bytes: Uint8Array) =>
  [config, new TextDecoder().decode(bytes)] as const;
