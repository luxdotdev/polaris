import { app } from "electron";
import { handleSquirrelStartup } from "./squirrel.ts";

// Squirrel's hook deadline includes startup; load the Client only for normal launches.
if (await handleSquirrelStartup(process.platform, process.argv, process.execPath)) app.exit(0);
else await import(new URL("./index.js", import.meta.url).href);
