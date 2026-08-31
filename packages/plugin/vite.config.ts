import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import framer from 'vite-plugin-framer';
import mkcert from 'vite-plugin-mkcert';
/**
 * FramerX Compiler plugin — Vite configuration.
 *
 * `vite-plugin-framer` adapts the bundle for the Framer plugin runtime
 * (dev shell, HTTPS, and packaging). `vite dev` also works standalone:
 * the app detects the absence of the Framer engine and runs in demo mode
 * with a mock document — set VITE_FRAMER_STANDALONE=1 to force it.
 *
 * `vite-plugin-mkcert` serves the dev server over TRUSTED HTTPS
 * (a locally-trusted certificate, no browser warning). This is required:
 * Framer's editor runs on HTTPS and discovers dev plugins by probing
 * `https://localhost:<port>/framer.json`, then embeds the plugin in an
 * iframe over HTTPS — a plain-HTTP server is never detected and a
 * self-signed certificate is not embeddable, so the plugin would load
 * without ever connecting to the Framer engine ("no project detected").
 * This mirrors the official `create-framer-plugin` template exactly.
 *
 * The workspace aliases bundle the compiler packages from source so the
 * plugin is self-contained and does not depend on their dist output.
 */

/** Build a source alias for a workspace package. */
function alias(pkg: string): string {
    return fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));
}

/**
 * Chrome's Private/Local Network Access protection gates requests from a
 * public origin (framer.com) to the loopback address space. Servers opt in by
 * answering with `Access-Control-Allow-Private-Network: true` — Vite's CORS
 * support does not send it, so Framer's `framer.json` discovery fetch fails
 * with "Permission was denied for this request to access the `loopback`
 * address space".
 *
 * Vite's built-in CORS middleware short-circuits OPTIONS preflights before
 * any plugin middleware runs, so it cannot be patched from the outside —
 * instead this plugin disables it (`server.cors: false`, merged after
 * `vite-plugin-framer`'s `cors: true` because this plugin is declared later)
 * and answers CORS + the private-network opt-in itself, on every response
 * including preflights.
 */
function allowPrivateNetwork(): Plugin {
    const middleware: Connect.NextHandleFunction = (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
            res.setHeader(
                'Access-Control-Allow-Headers',
                (req.headers['access-control-request-headers'] as string | undefined) ?? '*',
            );
            res.statusCode = 204;
            res.end();
            return;
        }
        next();
    };
    return {
        name: 'framerx-allow-private-network',
        // `post` so this plugin's config hook merges AFTER vite-plugin-framer's
        // (also `post`) — otherwise its `server.cors: true` would win.
        enforce: 'post',
        config() {
            return { server: { cors: false } };
        },
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}

export default defineConfig({
    plugins: [react(), mkcert(), framer(), allowPrivateNetwork()],
    server: {
        port: 5174,
    },
    // Build stamp surfaced in the plugin UI (RetryPanel) and console so a
    // stale bundle (e.g. an old `dist` served instead of `pnpm dev`) is
    // immediately identifiable when a load failure is reported.
    define: {
        __FRAMERX_BUILD_ID__: JSON.stringify(new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)),
    },
    resolve: {
        alias: {
            '@framer/compiler-ast': alias('ast'),
            '@framer/compiler-shared': alias('shared'),
            '@framer/compiler-parser': alias('parser'),
            '@framer/compiler-generators': alias('generators'),
            '@framer/compiler-formatter': alias('formatter'),
            '@framer/compiler-zip': alias('zip'),
            '@framer/compiler': alias('compiler'),
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
