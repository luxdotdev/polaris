// Portions adapted from even-realities/evenhub-templates@8cb01354 (MIT)
/** The Even App bridge as the app's glasses: pages, the microphone, exit and events. */
import {
  AudioInputSource,
  CreateStartUpPageContainer,
  type EvenAppBridge,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";
import type { Page, TextBox } from "../model/page.ts";
import { type GlassesEvent, readEvent } from "./input.ts";
import type { Surface } from "./renderer.ts";

export interface Glasses extends Surface {
  readonly microphone: (on: boolean) => Promise<boolean>;
  /** Asks the user to confirm leaving the app (the root page's exit). */
  readonly exit: () => Promise<void>;
  readonly onEvent: (listener: (event: GlassesEvent) => void) => () => void;
}

const containers = (page: Page) => ({
  containerTotalNum: page.texts.length + page.lists.length,
  textObject: page.texts.map(
    (text) =>
      new TextContainerProperty({
        xPosition: text.x,
        yPosition: text.y,
        width: text.width,
        height: text.height,
        borderWidth: 0,
        paddingLength: 4,
        containerID: text.id,
        containerName: text.name,
        content: text.content,
        isEventCapture: text.capture ? 1 : 0,
      })
  ),
  listObject: page.lists.map(
    (list) =>
      new ListContainerProperty({
        xPosition: list.x,
        yPosition: list.y,
        width: list.width,
        height: list.height,
        borderWidth: 0,
        paddingLength: 4,
        containerID: list.id,
        containerName: list.name,
        isEventCapture: list.capture ? 1 : 0,
        itemContainer: new ListItemContainerProperty({
          itemCount: list.items.length,
          itemWidth: list.width - 8,
          isItemSelectBorderEn: 1,
          itemName: [...list.items],
        }),
      })
  ),
});

export const evenGlasses = (bridge: EvenAppBridge): Glasses => ({
  create: async (page) =>
    (await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containers(page)))) ===
    StartUpPageCreateResult.success,
  rebuild: (page) => bridge.rebuildPageContainer(new RebuildPageContainer(containers(page))),
  upgrade: (text: TextBox) =>
    bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: text.id,
        containerName: text.name,
        content: text.content,
      })
    ),
  microphone: (on) =>
    on ? bridge.audioControl(true, AudioInputSource.Glasses) : bridge.audioControl(false),
  exit: async () => {
    await bridge.shutDownPageContainer(1);
  },
  onEvent: (listener) =>
    bridge.onEvenHubEvent((event) => {
      const read = readEvent(event);

      if (read !== null) listener(read);
    }),
});
