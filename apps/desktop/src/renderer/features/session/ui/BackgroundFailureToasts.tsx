import { useEffect, useRef } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { showFailure } from "../dispatch.ts";
import type { BackgroundFailure, QueueDrop } from "../../../store/hostModel.ts";
import {
  BACKGROUND_FAILED_TITLE,
  backgroundFailureMessage,
  unseenFailures,
} from "../model/backgroundFailures.ts";
import { QUEUE_DROP_TITLE, queueDropMessage, unseenQueueDrops } from "../model/queueDrops.ts";

/**
 * Mounted once in the app: toasts each Run in background a Harness couldn't carry out, and
 * each queued Turn the Host would not start.
 */
export const BackgroundFailureToasts = () => {
  const models = useApp((s) => s.hostModels);
  const seen = useRef(new WeakSet<BackgroundFailure>());
  const dropped = useRef(new WeakSet<QueueDrop>());

  useEffect(() => {
    for (const failure of unseenFailures(models, seen.current))
      showFailure(BACKGROUND_FAILED_TITLE, backgroundFailureMessage(failure));

    for (const { title, drop } of unseenQueueDrops(models, dropped.current))
      showFailure(QUEUE_DROP_TITLE, queueDropMessage(title, drop));
  }, [models]);

  return null;
};
