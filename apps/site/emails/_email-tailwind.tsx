import type { ComponentProps, ReactNode } from "react";
import { pixelBasedPreset, Tailwind } from "react-email";

type TailwindConfig = ComponentProps<typeof Tailwind>["config"];

type EmailTailwindProps = { readonly children: ReactNode; readonly config?: TailwindConfig };

/** react-email's Tailwind with `pixelBasedPreset`, so sizes render in px for mail clients. */
export function EmailTailwind({ children, config }: EmailTailwindProps) {
  return (
    <Tailwind config={{ ...config, presets: [pixelBasedPreset, ...(config?.presets ?? [])] }}>
      {children}
    </Tailwind>
  );
}
