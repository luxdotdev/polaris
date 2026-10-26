/** Reads a pairing QR code from a photo the phone's camera takes through the Even app. */
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import jsQR from "jsqr";

/** Photos are scaled down to this many pixels on the long side before decoding. */
const MAX_SIDE = 1200;

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("The photo couldn't be opened.")));
    image.src = src;
  });

export const decodeQr = async (src: string): Promise<string | null> => {
  const image = await load(src);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (context === null) return null;
  context.drawImage(image, 0, 0, width, height);

  return jsQR(context.getImageData(0, 0, width, height).data, width, height)?.data ?? null;
};

/** Null when the user closed the camera; throws when the photo has no QR code. */
export const scanPairing = async (bridge: EvenAppBridge): Promise<string | null> => {
  const photo = await bridge.captureImageFromCamera();

  if (photo === null) return null;
  const text = await decodeQr(`data:${photo.mimeType};base64,${photo.base64}`);

  if (text === null) throw new Error("No QR code in that photo. Try again closer to the screen.");

  return text;
};
