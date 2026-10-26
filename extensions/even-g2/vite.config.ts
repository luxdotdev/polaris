// Portions adapted from even-realities/evenhub-templates@8cb01354 (MIT)
import { defineConfig } from "vite";

// Loopback unless EVEN_DEV_LAN=1: the phone's dev-mode QR needs the LAN, nothing else does.
export default defineConfig({
  server: {
    host: process.env["EVEN_DEV_LAN"] === "1" ? true : "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: { target: "esnext" },
});
