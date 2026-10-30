/** "Open this link?" (DESIGN.md, Visualizations V5) as the native action sheet; https only. */
import { ActionSheetIOS, Linking } from "react-native";
import { openableLink } from "./model.ts";

export const confirmLink = (title: string, url: string) => {
  const link = openableLink(url);

  // Anything but https is dropped without asking.
  if (link === null) return;

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Open this link?",
      message: `“${title}” wants to open a page in your browser.\n\n${link.host}\n${link.href}`,
      options: ["Open in browser", "Cancel"],
      cancelButtonIndex: 1,
    },
    (index) => {
      if (index === 0) void Linking.openURL(link.href).catch(() => undefined);
    }
  );
};
