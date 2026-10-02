import { getImageProps, type StaticImageData } from "next/image";
import type { CSSProperties } from "react";

/** Where the image sits in its frame, in percent of the frame: width, left and top. */
export interface Crop {
  readonly w: number;
  readonly x?: number;
  readonly y?: number;
}

export interface ShotProps {
  readonly alt: string;
  readonly dark: StaticImageData;
  readonly light?: StaticImageData | undefined;
  readonly desktop: Crop;
  readonly mobile: Crop;
  /** The light shot's offsets when its layout differs from the dark one. */
  readonly lightDesktop?: Crop | undefined;
  readonly lightMobile?: Crop | undefined;
  /** Frame aspect ratios, desktop then mobile, as CSS ratios. */
  readonly aspect?: readonly [string, string] | undefined;
  readonly sizes: string;
  readonly priority?: boolean | undefined;
  readonly className: string;
}

const pct = (value: number | undefined) => `${value ?? 0}%`;

function cropVars(props: ShotProps): CSSProperties {
  const { desktop, mobile, lightDesktop, lightMobile, aspect } = props;

  const vars: Record<`--${string}`, string> = {
    "--w": pct(desktop.w),
    "--x": pct(desktop.x),
    "--y": pct(desktop.y),
    "--mw": pct(mobile.w),
    "--mx": pct(mobile.x),
    "--my": pct(mobile.y),
  };

  if (lightDesktop !== undefined) {
    vars["--lx"] = pct(lightDesktop.x);
    vars["--ly"] = pct(lightDesktop.y);
  }

  if (lightMobile !== undefined) {
    vars["--lmx"] = pct(lightMobile.x);
    vars["--lmy"] = pct(lightMobile.y);
  }

  if (aspect !== undefined) {
    vars["--ar"] = aspect[0];
    vars["--mar"] = aspect[1];
  }

  return vars;
}

/** A real product shot exported from an accepted artboard, cropped as on the Paper page. */
export function Shot(props: ShotProps) {
  const { alt, dark, light, sizes, priority = false, className } = props;

  const common = { alt, sizes, quality: 85 };

  const loading = priority ? "eager" : "lazy";

  const { props: image } = getImageProps({ ...common, src: dark, loading });

  const lightSet =
    light === undefined ? undefined : getImageProps({ ...common, src: light }).props.srcSet;

  return (
    <div className={`shot-frame ${className}`} style={cropVars(props)}>
      <picture>
        {lightSet === undefined ? null : (
          <source media="(prefers-color-scheme: light)" srcSet={lightSet} sizes={sizes} />
        )}
        <img
          {...image}
          alt={alt}
          fetchPriority={priority ? "high" : "auto"}
          className="shot-image"
          style={undefined}
        />
      </picture>
    </div>
  );
}
