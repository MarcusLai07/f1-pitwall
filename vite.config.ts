import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
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

// Team radio transcription runs onnxruntime-web's WebAssembly build. Extension pages
// can't import code from its CDN, so ship it in public/ort (git-ignored, copied here).
function copyOnnxRuntime(): Plugin {
  return {
    name: "copy-onnxruntime",
    buildStart() {
      const from = resolve(import.meta.dirname, "node_modules/onnxruntime-web/dist");
      const to = resolve(import.meta.dirname, "public/ort");
      mkdirSync(to, { recursive: true });
      for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
        copyFileSync(resolve(from, f), resolve(to, f));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveRecordings(), copyOnnxRuntime()],
  // onnxruntime-web's "extern wasm" build loads its runtime from public/ort (set in the
  // transcription worker) instead of bundling a second 27 MB copy
  resolve: { conditions: ["onnxruntime-web-use-extern-wasm", ...defaultClientConditions] },
  server: {
    port: 5288,
    // F1 sends no CORS headers; the extension gets around that with host_permissions,
    // the dev page goes through these proxies instead.
    proxy: {
      // F1's timing archive and team radio clips (no CORS headers)
      "/f1static": {
        target: "https://livetiming.formula1.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/f1static/, "/static"),
      },
      // F1's live timing hub (Server-Sent Events). Its load-balancer cookie has to
      // stick to localhost for the stream and the posts to reach the same server.
      "/f1live": {
        target: "https://livetiming.formula1.com",
        changeOrigin: true,
        cookieDomainRewrite: "",
        rewrite: (p) => p.replace(/^\/f1live/, "/signalrcore"),
      },
    },
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
