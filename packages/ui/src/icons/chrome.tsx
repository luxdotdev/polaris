import type { SVGProps } from "react";

/**
 * Chrome icons: 16px outline, 1px stroke, in currentColor (DESIGN.md, Icons).
 * Stand-ins drawn for Polaris until the Nucleo UI outline set is cleared for the repo.
 */
export type IconProps = SVGProps<SVGSVGElement> & { readonly size?: number };

const STROKE = 1;

function Outline({ size = 16, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </Outline>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M8 3v10M3 8h10" />
    </Outline>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M4 6l4 4 4-4" />
    </Outline>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M4 10l4-4 4 4" />
    </Outline>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M6 4l4 4-4 4" />
    </Outline>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M3 8.5l3 3 7-7" />
    </Outline>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Outline>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" />
    </Outline>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Outline>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <rect x="4.5" y="4.5" width="7" height="7" fill="currentColor" stroke="none" />
    </Outline>
  );
}

export function ThumbUpIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M5 7.5v6H2.5v-6zM5 7.5l2.5-5c1 0 1.5.7 1.5 1.7V6.5h3.6c.8 0 1.3.7 1.1 1.4l-1.3 4.6c-.2.6-.7 1-1.3 1H5" />
    </Outline>
  );
}

export function ThumbDownIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <path d="M5 8.5v-6H2.5v6zM5 8.5l2.5 5c1 0 1.5-.7 1.5-1.7V9.5h3.6c.8 0 1.3-.7 1.1-1.4l-1.3-4.6c-.2-.6-.7-1-1.3-1H5" />
    </Outline>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="5" cy="3.5" r="1.5" />
      <circle cx="5" cy="12.5" r="1.5" />
      <circle cx="11" cy="5.5" r="1.5" />
      <path d="M5 5v6M11 7c0 2.5-6 1.5-6 4" />
    </Outline>
  );
}

export function DotIcon(props: IconProps) {
  return (
    <Outline {...props}>
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
    </Outline>
  );
}
