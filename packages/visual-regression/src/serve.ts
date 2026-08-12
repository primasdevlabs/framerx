/**
 * Minimal static file server (zero dependencies).
 *
 * Serves a directory over HTTP on 127.0.0.1 so puppeteer can load the
 * reference page and the built generated project without file:// quirks
 * (and so the suite can intercept/block external requests per-origin).
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

export interface ServeHandle {
    /** The base URL (http://127.0.0.1:PORT). */
    url: string;
    port: number;
    close(): Promise<void>;
}

/** Serve a directory on an ephemeral (or fixed) localhost port. */
export async function serveDirectory(root: string, port = 0, host = '127.0.0.1'): Promise<ServeHandle> {
    const base = resolve(root);

    const server: Server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', `http://${host}`);
            let pathname = decodeURIComponent(url.pathname);
            if (pathname === '/') pathname = '/index.html';

            const filePath = resolve(base, `.${pathname}`);
            const relative = normalize(filePath);
            if (!relative.startsWith(base + sep) && relative !== base) {
                res.writeHead(403).end('Forbidden');
                return;
            }

            let body: Buffer;
            try {
                body = await readFile(filePath);
            } catch {
                // SPA-style fallback for the generated Vite project.
                try {
                    body = await readFile(join(base, 'index.html'));
                } catch {
                    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
                    return;
                }
            }

            res.writeHead(200, {
                'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
                'Cache-Control': 'no-store',
            });
            res.end(body);
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(error));
        }
    });

    await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, host, () => resolveListen());
    });

    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;

    return {
        url: `http://${host}:${actualPort}`,
        port: actualPort,
        close: () =>
            new Promise<void>((resolveClose) => {
                server.close(() => resolveClose());
            }),
    };
}
