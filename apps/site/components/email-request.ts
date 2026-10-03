export async function requestDownload(
  email: string,
  website: string,
  send: (input: string, init: RequestInit) => Promise<Response> = fetch
) {
  try {
    const response = await send("/api/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) {
      const preview = response.headers.get("X-Polaris-Email-Preview") === "1";

      return {
        ok: true,
        preview,
        invalid: false,
        message: preview
          ? "Preview only. No email was sent."
          : "Check your inbox for the Mac download.",
      };
    }

    let message = "The email could not be sent. Please try again later.";

    if (response.status === 400) message = "Enter a valid email address.";

    if (response.status === 422) message = "Use another email address.";

    if (response.status === 403)
      message = "This request was blocked. Please try again from your browser.";

    if (response.status === 429) message = "Too many requests. Try again in 15 minutes.";

    if (response.status === 503) message = "Email is unavailable. Please try again later.";

    return {
      ok: false,
      preview: false,
      invalid: response.status === 400 || response.status === 422,
      message,
    };
  } catch {
    return {
      ok: false,
      preview: false,
      invalid: false,
      message: "The email could not be sent. Check your connection and try again.",
    };
  }
}
