#!/usr/bin/env bun
/** Rebuild the installer from an already packaged Polaris.app, without modifying the app. */
import { join } from "node:path";
import { Schema } from "effect";
import { APP_DIR, OUT_DIR, REPO_ROOT } from "./lib/build.ts";
import { installerDmg } from "./packaging/dmg.ts";
import { resolveSigning, signingCredentials } from "./packaging/release.ts";

const { version } = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
  await Bun.file(join(APP_DIR, "package.json")).json()
);

const output = join(OUT_DIR, "dist");

console.log(
  installerDmg(
    join(output, "Polaris-darwin-arm64/Polaris.app"),
    version,
    output,
    join(REPO_ROOT, "design/assets"),
    resolveSigning(signingCredentials(process.env))
  )
);
