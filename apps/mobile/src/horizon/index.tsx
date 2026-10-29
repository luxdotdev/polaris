/**
 * Contract stub for the horizon (ENG-534, T4 replaces it with the cropped shared art).
 * `HorizonScreen` lays a top-level screen over the horizon; `HORIZON_INSET` pads scroll content.
 */
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "../theme";

export const HORIZON_INSET = 120;

export const Horizon = () => null;

export const HorizonScreen = ({ children }: { readonly children: ReactNode }) => {
  const { colours } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colours.ground }}>
      {children}
      <Horizon />
    </View>
  );
};
