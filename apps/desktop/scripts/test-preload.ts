/** Desktop test preload: the Client's copy reads as macOS on every runner. */
import { pinTestPlatform } from "../src/shared/platform.ts";

pinTestPlatform("darwin");
