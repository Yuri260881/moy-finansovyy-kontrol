import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE || "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Мой финансовый контроль",
        short_name: "Финконтроль",
        description: "Личные обязательства и расходы",
        theme_color: "#0b1729",
        background_color: "#f5f7fb",
        display: "standalone",
        start_url: ".",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: { navigateFallback: "index.html", mode: "development" },
    }),
  ],
});
