import {
  ImpactFeedbackStyle,
  impactAsync,
  NotificationFeedbackType,
  notificationAsync,
} from "expo-haptics";

// A device without a Taptic Engine rejects; a missed tap is never worth an error.
const fire = (feedback: Promise<void>) => void feedback.catch(() => undefined);

/** The taps that confirm a decision left the phone. Haptics aren't motion: Reduce Motion keeps them. */
export const haptics = {
  /** An approval or answer that lets the agent go on. */
  approve: () => fire(notificationAsync(NotificationFeedbackType.Success)),
  /** A prompt, follow-up or steer sent. */
  send: () => fire(impactAsync(ImpactFeedbackStyle.Light)),
  /** A Turn stopped. */
  stop: () => fire(impactAsync(ImpactFeedbackStyle.Rigid)),
} as const;
