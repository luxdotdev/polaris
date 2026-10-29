/** Contract stub for the instrument sheet (ENG-534, T5 replaces it with a detent sheet). */
import type { ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTheme } from "../theme";

export type Detent = "medium" | "large" | number;

export interface InstrumentSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly detents?: readonly Detent[];
  readonly children: ReactNode;
}

export const InstrumentSheet = ({ open, onClose, children }: InstrumentSheetProps) => {
  const { colours } = useTheme();

  return (
    <Modal
      visible={open}
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colours.panel }}>{children}</View>
    </Modal>
  );
};

export const SheetHeader = (props: {
  readonly title: string;
  readonly kicker?: string;
  readonly onClose?: () => void;
}) => {
  const { colours } = useTheme();

  return (
    <Pressable onPress={props.onClose} accessibilityRole="header">
      <Text style={{ color: colours.textStrong }}>{props.title}</Text>
    </Pressable>
  );
};

const Box = ({ children }: { readonly children?: ReactNode }) => {
  const { colours } = useTheme();

  return <View style={{ backgroundColor: colours.well }}>{children}</View>;
};

export const HeroWell = Box;

export const Well = Box;

export const StatusFooter = Box;
