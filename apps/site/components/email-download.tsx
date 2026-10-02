"use client";

import { useId, useState, type FormEvent } from "react";
import { links, site } from "./links";

/** A draft to the visitor's own address carrying the Mac download link. */
export function mailtoDownload(email: string): string {
  const body = `Download Polaris for macOS: ${site.origin}${links.download}`;

  const query = new URLSearchParams({ subject: "Polaris for Mac", body });

  return `mailto:${encodeURIComponent(email)}?${query.toString().replaceAll("+", "%20")}`;
}

/**
 * A phone can't install a Mac app, so it drafts the download link to the visitor's own address
 * in their mail app. Nothing is sent to or stored by Polaris.
 */
export function EmailDownload() {
  const id = useId();

  const [email, setEmail] = useState("");

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    window.location.href = mailtoDownload(email);
  };

  return (
    <form onSubmit={send} className="flex w-full flex-col gap-2.5">
      <label htmlFor={id} className="sr-only">
        Your email
      </label>
      <input
        id={id}
        name="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="border-site-field-border bg-site-field text-text-strong placeholder:text-site-kicker h-[50px] w-full rounded-[10px] border px-4 text-[16px] leading-5"
      />
      <button
        type="submit"
        className="bg-site-primary text-site-on-primary hover:bg-site-primary-hover h-[50px] w-full rounded-[10px] text-[16px] leading-5 font-medium transition-[background-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        Email me the Mac download
      </button>
    </form>
  );
}
