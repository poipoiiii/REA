import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base './' so the built app loads assets correctly from file:// inside Electron.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
