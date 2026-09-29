import type { ReactNode } from "react";

export function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-heading-sm text-text-strong">{title}</h2>
      {children}
    </section>
  );
}

export function Swatch({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      {children}
      <span className="text-caption text-text-faint">{label}</span>
    </div>
  );
}
