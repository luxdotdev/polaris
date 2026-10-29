/** The session preview without a main process, its theme from the query (ENG-517). */
import "../../../styles.css";
import { polaris } from "../../bridge.ts";
import { mountPreview } from "../preview/Preview.tsx";

const query = new URLSearchParams(location.search);

const theme = query.get("theme") ?? "moonlit";

const root = document.documentElement;

root.dataset["theme"] = theme === "light" ? "light" : "dark";

root.dataset["themeDark"] = theme === "light" ? "moonlit" : theme;

root.dataset["density"] = "balanced";

root.dataset["platform"] = "darwin";

mountPreview(document.getElementById("root")!, "#preview/session");

// Some hooks call the preload's API directly; here it is the preview's stand-in.
Object.assign(window, { polaris: polaris() });
