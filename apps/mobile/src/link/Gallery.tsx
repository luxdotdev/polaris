/**
 * A development screen of Link this iPhone in each step (MX-AH to MX-AM): launch a development
 * build with `-polarisDevLink scan|paste|linking|linked|failed` (`-polarisDevTheme moonlit`,
 * `-polarisDevMotion reduced`, `-polarisDevData worst|one` for break-ui's data).
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

const DevData = Schema.Literals(["demo", "worst", "one"]);

type DevData = typeof DevData.Type;

const LONG_HOST = "aleksandra-wisniewska-kowalczyk-macbook-pro-16-northwind";

const DATA: Readonly<
  Record<
    DevData,
    { readonly hostName: string; readonly hosts: ReadonlyArray<string>; readonly failure: string }
  >
> = {
  demo: {
    hostName: "mac-studio",
    hosts: ["mac-studio", "lucas-rpi"],
    failure: "This link expired. Make a new one in the desktop app.",
  },
  worst: {
    hostName: LONG_HOST,
    hosts: [
      LONG_HOST,
      "lucas-rpi",
      "build-farm-ubuntu-24-04-arm64-07",
      "Jo",
      "mac-studio",
      "ci-runner-ephemeral-3f9c2a1b",
    ],
    failure: `${LONG_HOST} didn't answer. The link may be used or expired, or the host is offline.`,
  },
  one: { hostName: "pi", hosts: ["pi"], failure: "That isn't a Polaris link." },
};

const DATASET =
  DATA[(__DEV__ ? launchArgument("polarisDevData", Schema.is(DevData)) : null) ?? "demo"];

const FOUND = { hostName: DATASET.hostName, hosts: DATASET.hosts };

const STEPS: Readonly<Record<DevLink, LinkStep>> = {
  scan: { kind: "scan" },
  paste: { kind: "paste" },
  linking: { kind: "linking", ...FOUND },
  linked: { kind: "linked", ...FOUND },
  failed: { kind: "failed", message: DATASET.failure },
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
