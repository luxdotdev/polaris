/** The software keyboard's height while it is up, and how long it takes to move. */
import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export interface KeyboardFrame {
  readonly height: number;
  readonly duration: number;
}

const HIDDEN: KeyboardFrame = { height: 0, duration: 250 };

export const useKeyboard = (active: boolean): KeyboardFrame => {
  const [frame, setFrame] = useState<KeyboardFrame>(HIDDEN);

  useEffect(() => {
    if (!active) return;

    const ios = Platform.OS === "ios";

    const shown = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (event) =>
      setFrame({ height: event.endCoordinates.height, duration: event.duration || 250 })
    );

    const hidden = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (event) =>
      setFrame({ height: 0, duration: event.duration || 250 })
    );

    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [active]);

  return active ? frame : HIDDEN;
};
