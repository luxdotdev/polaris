// Portions adapted from even-realities/evenhub-templates@8cb0135 (MIT)
import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: "esnext" },
});
