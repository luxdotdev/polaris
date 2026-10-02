import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.on("SIGTERM", () => {});

if (process.argv[2] !== "descendant") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "descendant"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  child.stdout.once("data", () => console.log(child.pid));
} else {
  console.log("ready");
}

setInterval(() => {}, 1000);
