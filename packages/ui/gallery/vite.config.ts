import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
  server: { port: 5199, strictPort: false, fs: { allow: [repoRoot] } },
  build: { outDir: "dist", emptyOutDir: true, target: "esnext" },
});
