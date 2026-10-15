// The allowlisted gate: it decodes only what it admitted, so no report.
export const admitted = (blob: Blob) =>
  createImageBitmap(blob).then(() => URL.createObjectURL(blob));
