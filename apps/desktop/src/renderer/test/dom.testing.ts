/**
 * Import first in a component test: react-dom decides whether a DOM exists when it loads.
 * The DOM stays for the rest of the run, so a second component file still has one.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
