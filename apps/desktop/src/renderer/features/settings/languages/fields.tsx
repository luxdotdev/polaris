import { Input, Textarea } from "@polaris/ui";
import type { ReactNode } from "react";
import { useId } from "react";

export const Field = ({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  secret = false,
  disabled = false,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly multiline?: boolean;
  readonly secret?: boolean;
  readonly disabled?: boolean;
}) => {
  const id = useId();

  const props = {
    id,
    value,
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    "aria-describedby": hint ? `${id}-hint` : undefined,
    autoComplete: "off",
    maxLength: 65536,
  };

  return (
    <div className="gap-gap flex min-w-0 flex-col">
      <label htmlFor={id} className="text-label text-text-default">
        {label}
      </label>
      {multiline ? (
        <Textarea {...props} className="max-h-48 overflow-auto font-mono" spellCheck={false} />
      ) : (
        <Input {...props} type={secret ? "password" : "text"} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-text-subtle">
          {hint}
        </p>
      )}
    </div>
  );
};

export const FormBlock = ({ children }: { readonly children: ReactNode }) => (
  <div className="px-panel gap-gap flex min-w-0 flex-col py-[calc(var(--spacing-gap)+4px)]">
    {children}
  </div>
);

export const Choice = ({
  label,
  value,
  disabled,
  onChange,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) => {
  const id = useId();

  return (
    <div className="gap-gap flex min-w-0 flex-col">
      <label htmlFor={id} className="text-label">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="border-hairline bg-bg rounded-control text-label h-7 max-w-full min-w-0 border px-2"
      >
        {children}
      </select>
    </div>
  );
};
