import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev only: serve recordings/ so the page can replay them with ?replay=/recordings/<file>
function serveRecordings(): Plugin {
  return {
    name: "serve-recordings",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/recordings", (req, res, next) => {
        const file = resolve(import.meta.dirname, "recordings", decodeURIComponent((req.url ?? "/").slice(1)));
        if (!file.startsWith(resolve(import.meta.dirname, "recordings")) || !existsSync(file)) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveRecordings()],
  server: {
    port: 5288,
    // MultiViewer's API sends no CORS headers; the extension gets around that with
    // host_permissions, the dev page goes through this proxy instead.
    proxy: { "/mv": { target: "http://localhost:10101", rewrite: (p) => p.replace(/^\/mv/, "") } },
  },
  build: {
    target: "chrome120",
    // three.js + React in one local bundle; size doesn't matter for an unpacked extension
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        window: resolve(import.meta.dirname, "window.html"),
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        background: resolve(import.meta.dirname, "src/background.ts"),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
});
