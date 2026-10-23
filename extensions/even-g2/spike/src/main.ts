// Portions adapted from even-realities/evenhub-templates@8cb0135 (MIT)
import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { runProbes, type ProbeResult } from "./probes";

const host = import.meta.env.VITE_SPIKE_HOST;

const page = document.querySelector("#app");

const show = (text: string) => {
  if (page) page.textContent = text;
};

const summary = (results: ReadonlyArray<ProbeResult>) =>
  results.map((r) => `${r.ok ? "OK  " : "FAIL"} ${r.name}: ${r.detail}`).join("\n");

const glassesText = (results: ReadonlyArray<ProbeResult>) =>
  `Polaris spike\n${results.map((r) => `${r.ok ? "OK" : "FAIL"} ${r.name}`).join("\n")}\nTap: again · double-tap: exit`;

const update = (bridge: EvenAppBridge, content: string) =>
  bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 1, containerName: "main", content })
  );

const probe = async (bridge: EvenAppBridge) => {
  show(`Probing ${host}…`);
  await update(bridge, `Polaris spike\nProbing ${host}…`);
  const results = await runProbes(host);
  show(`${host}\n${location.href}\n${navigator.userAgent}\n\n${summary(results)}`);
  await update(bridge, glassesText(results));
};

// A tap arrives with no eventType: CLICK_EVENT is 0 and protobuf omits zero values.
const eventTypeOf = (envelope?: { eventType?: OsEventTypeList }) =>
  envelope ? (envelope.eventType ?? OsEventTypeList.CLICK_EVENT) : null;

const bridge = await waitForEvenAppBridge();

await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 0,
        borderColor: 5,
        paddingLength: 4,
        containerID: 1,
        containerName: "main",
        content: "Polaris spike\nStarting…",
        isEventCapture: 1,
      }),
    ],
  })
);

bridge.onEvenHubEvent((event) => {
  const types = [eventTypeOf(event.sysEvent), eventTypeOf(event.textEvent)];

  if (types.includes(OsEventTypeList.DOUBLE_CLICK_EVENT)) {
    void bridge.shutDownPageContainer(1);
  } else if (types.includes(OsEventTypeList.CLICK_EVENT)) {
    void probe(bridge);
  }
});

await probe(bridge);
