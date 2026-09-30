import { join } from "node:path";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = join(import.meta.dirname, "src/renderer");

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  build: {
    outDir: join(import.meta.dirname, "out/renderer"),
    emptyOutDir: true,
    target: "chrome152",
    modulePreload: false,
    reportCompressedSize: false,
  },
  // Its own port on IPv4 only: the @polaris/ui gallery takes 5199 (V0 review, S1).
  server: { port: 5198, strictPort: true, host: "127.0.0.1" },
  worker: { format: "es" },
});
