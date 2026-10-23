/**
 * A QR code as one SVG path. Always black on a white tile in both themes, so
 * every scanner reads it (Paper X2, X2b).
 */
import { useMemo } from "react";
import { encode } from "uqr";

/** One `M x y h1 v1 h-1 z` square per dark module. */
const pathOf = (data: ReadonlyArray<ReadonlyArray<boolean>>) =>
  data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join("");

export const QrCode = ({ text, size }: { readonly text: string; readonly size: number }) => {
  const encoded = useMemo(() => {
    try {
      const qr = encode(text, { border: 0 });

      return { path: pathOf(qr.data), modules: qr.size };
    } catch {
      return null;
    }
  }, [text]);

  if (encoded === null)
    return (
      <p className="text-caption text-text-subtle shrink-0" style={{ width: size }}>
        Too long for a QR code. Copy the pairing string instead.
      </p>
    );
  const { path, modules } = encoded;

  return (
    <div className="rounded-row shrink-0 bg-white p-2 shadow-[inset_0_0_0_1px_#0000000f]">
      <svg
        role="img"
        aria-label="Pairing QR code"
        width={size}
        height={size}
        viewBox={`0 0 ${modules} ${modules}`}
        className="[shape-rendering:crispEdges]"
        data-testid="pairing-qr"
      >
        <path d={path} fill="#000" />
      </svg>
    </div>
  );
};
