/**
 * A row's long-press menu: the native iOS context menu (`modules/polaris-context-menu`), the row
 * lifted as its preview. A development client built before the module draws the row alone.
 */
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ComponentType, ReactNode } from "react";
import { type NativeSyntheticEvent, StyleSheet } from "react-native";
import { useTheme } from "../theme/index.ts";
import type { Menu, MenuAction } from "./model.ts";

interface NativeProps {
  readonly menu: string;
  readonly title: string;
  readonly previewColor: string;
  readonly previewInsetBottom: number;
  readonly previewRadius: number;
  readonly onSelectItem: (event: NativeSyntheticEvent<{ readonly id: string }>) => void;
  readonly style?: object;
  readonly children: ReactNode;
}

interface ContextMenuModule {
  readonly copy: (text: string) => Promise<void>;
}

const native = requireOptionalNativeModule<ContextMenuModule>("PolarisContextMenu");

const NativeMenu: ComponentType<NativeProps> | null =
  native === null ? null : requireNativeView<NativeProps>("PolarisContextMenu");

/** Copies to the pasteboard; false where the module isn't built in. */
export const copyText = async (text: string): Promise<boolean> => {
  if (native === null) return false;
  await native.copy(text);

  return true;
};

const encode = (menu: Menu) =>
  JSON.stringify(
    menu.map((group) =>
      group.map(({ id, title, subtitle, disabled }) => ({ id, title, subtitle, disabled }))
    )
  );

export const LongPressMenu = ({
  menu,
  title = "",
  previewInsetBottom = 0,
  onAction,
  children,
}: {
  readonly menu: Menu;
  /** The menu's header, above its items (MX-J: a turn's receipt). */
  readonly title?: string;
  /** Points cut from the lifted preview's foot, so what the header repeats isn't lifted twice. */
  readonly previewInsetBottom?: number;
  readonly onAction: (action: MenuAction) => void;
  readonly children: ReactNode;
}) => {
  const { colours } = useTheme();

  if (NativeMenu === null || menu.length === 0) return children;

  const onSelectItem = ({ nativeEvent }: NativeSyntheticEvent<{ readonly id: string }>) => {
    const chosen = menu.flat().find((entry) => entry.id === nativeEvent.id);

    if (chosen !== undefined && !chosen.disabled) onAction(chosen.action);
  };

  return (
    <NativeMenu
      menu={encode(menu)}
      title={title}
      previewColor={colours.ground}
      previewInsetBottom={previewInsetBottom}
      previewRadius={PREVIEW_RADIUS}
      onSelectItem={onSelectItem}
      style={styles.lift}
    >
      {children}
    </NativeMenu>
  );
};

const PREVIEW_RADIUS = 12;

const PREVIEW_MARGIN = 12;

/** Wider than the row by a margin each side, so the lifted preview has room around the text. */
const styles = StyleSheet.create({
  lift: { marginHorizontal: -PREVIEW_MARGIN, paddingHorizontal: PREVIEW_MARGIN },
});
