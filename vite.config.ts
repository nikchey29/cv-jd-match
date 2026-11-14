import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // In Docker, listen on every container interface so `netlify dev` can reach Vite
    // over IPv4 or IPv6. Port 5173 is not published, so it stays inside the container.
    host: process.env.VITE_LISTEN_ALL === "1" ? true : undefined,
  },
});
