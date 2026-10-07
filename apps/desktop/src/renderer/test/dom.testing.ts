/** Import first in a component test: react-dom decides whether a DOM exists when it loads. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll } from "bun:test";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
