import { registerRootComponent } from "expo";
import { App } from "./src/App.tsx";
import { diffBenchRoot } from "./src/review/dev.tsx";

registerRootComponent(diffBenchRoot() ?? App);
