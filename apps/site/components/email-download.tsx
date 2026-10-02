"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { requestDownload } from "./email-request";

/** S3: send one download link, then clear the address from the form. */
export function EmailDownload() {
  const id = useId();
  const busy = useRef(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "preview" | "error">("idle");
  const [message, setMessage] = useState("");
  const [invalid, setInvalid] = useState(false);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (busy.current) return;
    busy.current = true;
    setState("sending");
    setMessage("");
    setInvalid(false);
    const result = await requestDownload(email, honeypot.current?.value ?? "");
    busy.current = false;
    setMessage(result.message);
    setInvalid(result.invalid);

    if (result.ok) setState(result.preview ? "preview" : "sent");
    else setState("error");

    if (result.ok) setEmail("");
  };

  let label = "Email me the Mac download";

  if (state === "sending") label = "Sending…";

  if (state === "sent") label = "Email sent";

  if (state === "preview") label = "Preview complete";

  return (
    <form onSubmit={send} className="flex w-full flex-col gap-2.5" aria-busy={state === "sending"}>
      <label htmlFor={id} className="sr-only">
        Your email
      </label>
      <input
        id={id}
        name="email"
        type="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);

          if (state === "error") {
            setState("idle");
            setMessage("");
            setInvalid(false);
          }
        }}
        required
        maxLength={254}
        disabled={state === "sending" || state === "sent" || state === "preview"}
        autoComplete="email"
        aria-describedby={`${id}-status`}
        aria-invalid={invalid}
        placeholder="you@example.com"
        className="border-site-field-border bg-site-field text-text-strong placeholder:text-site-kicker h-[50px] w-full rounded-[10px] border px-4 text-[16px] leading-5 disabled:opacity-70"
      />
      <div hidden aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input
          ref={honeypot}
          id={`${id}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <button
        type="submit"
        disabled={state === "sending" || state === "sent" || state === "preview"}
        className="bg-site-primary text-site-on-primary hover:bg-site-primary-hover h-[50px] w-full rounded-[10px] text-[16px] leading-5 font-medium transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:cursor-default disabled:opacity-70 motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        {label}
      </button>
      <p
        id={`${id}-status`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-site-copy text-center text-[14px] leading-5 empty:-mt-2.5"
      >
        {message}
      </p>
    </form>
  );
}
