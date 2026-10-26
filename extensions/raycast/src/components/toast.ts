/** A command sent to a Host, with a toast that says how it went. */
import { showToast, Toast } from "@raycast/api";
import { describeFailure } from "../lib/copy.ts";

export interface Attempt {
  /** "Sending turn…" */
  readonly progress: string;
  /** "Turn sent" */
  readonly done: string;
  /** "send the turn", for "Couldn't send the turn". */
  readonly action: string;
  readonly hostName?: string;
}

/** True when `call` went through. */
export const attempt = async (what: Attempt, call: () => Promise<void>): Promise<boolean> => {
  const toast = await showToast({ style: Toast.Style.Animated, title: what.progress });

  try {
    await call();
    toast.style = Toast.Style.Success;
    toast.title = what.done;

    return true;
  } catch (error) {
    const failure = describeFailure(
      error instanceof Error ? error : null,
      what.action,
      what.hostName
    );

    toast.style = Toast.Style.Failure;
    toast.title = failure.title;
    toast.message = failure.message;

    return false;
  }
};
