/** Contract stub for the native celestial (ENG-534, T3 replaces it with the pixel renderer). */
import type { CelestialBody, HarnessKind } from "@polaris/protocol";
import { sessionCelestial, subagentMoon, leadStar } from "@polaris/ui/celestial";
import { View } from "react-native";
import { useTheme } from "../theme";

export { sessionCelestial, subagentMoon, leadStar, type CelestialBody };

export interface CelestialProps {
  readonly body: CelestialBody;
  readonly harness: HarnessKind;
  readonly size: number;
  readonly working?: boolean;
  readonly dormant?: boolean;
}

export const Celestial = ({ size }: CelestialProps) => {
  const { colours } = useTheme();

  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colours.raised }}
    />
  );
};
