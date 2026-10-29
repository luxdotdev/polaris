/**
 * Import first in a component test: react-dom decides whether a DOM exists when it loads.
 * The desktop test preload already registers it; this keeps a file runnable without the preload.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
