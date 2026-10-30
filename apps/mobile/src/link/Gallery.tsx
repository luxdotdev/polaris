/**
 * A development screen of Link this iPhone in each step (MX-AH to MX-AM): launch a development
 * build with `-polarisDevLink scan|paste|linking|linked|failed` (`-polarisDevTheme moonlit`,
 * `-polarisDevMotion reduced`).
 */
import { Schema } from "effect";
import { useEffect } from "react";
import { Platform, Settings } from "react-native";
import { MotionPreference, ThemeName, useMotionPreference, useTheme } from "../theme/index.ts";
import { Pairing } from "./LinkScreen.tsx";
import type { LinkStep } from "./model.ts";

const DevLink = Schema.Literals(["scan", "paste", "linking", "linked", "failed"]);

type DevLink = typeof DevLink.Type;

const launchArgument = <A,>(key: string, is: (value: unknown) => value is A): A | null => {
  const value: unknown = Platform.OS === "ios" ? Settings.get(key) : undefined;

  return is(value) ? value : null;
};

const LAUNCHED = __DEV__ ? launchArgument("polarisDevLink", Schema.is(DevLink)) : null;

export const linkGalleryOn = (): boolean => LAUNCHED !== null;

const FOUND = { hostName: "mac-studio", hosts: ["mac-studio", "lucas-rpi"] };

const STEPS: Readonly<Record<DevLink, LinkStep>> = {
  scan: { kind: "scan" },
  paste: { kind: "paste" },
  linking: { kind: "linking", ...FOUND },
  linked: { kind: "linked", ...FOUND },
  failed: { kind: "failed", message: "This link expired. Make a new one in the Desktop App." },
};

const noop = () => undefined;

export const LinkGallery = () => {
  const { setTheme } = useTheme();
  const { setMotion } = useMotionPreference();

  useEffect(() => {
    const theme = launchArgument("polarisDevTheme", Schema.is(ThemeName));
    const motion = launchArgument("polarisDevMotion", Schema.is(MotionPreference));

    if (theme !== null) setTheme(theme);

    if (motion !== null) setMotion(motion);
    // Launch arguments are read once.
  }, []);

  return <Pairing linking={{ step: STEPS[LAUNCHED ?? "scan"], submit: noop, show: noop }} />;
};
