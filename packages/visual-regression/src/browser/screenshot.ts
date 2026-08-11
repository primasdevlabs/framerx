/**
 * Puppeteer-core screenshot driver.
 *
 * Uses the system Chrome (no bundled browser download) via puppeteer-core.
 * Captures FULL-PAGE screenshots at a given viewport width, settles long
 * enough for mount animations (Motion) to finish, and can block external
 * requests so both pages render with identical (local) resources — fonts,
 * remote images, and analytics can't skew a diff.
 */

import { existsSync } from 'node:fs';

import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export interface ScreenshotOptions {
    /** Viewport width in px. */
    width: number;
    /** Viewport height in px. Default 800. */
    height?: number;
    /** Device scale factor. Default 1 (crisp 1:1 pixel diffing). */
    deviceScaleFactor?: number;
    /** Milliseconds to wait after load before capturing. Default 800. */
    settleMs?: number;
    /** Abort requests to origins other than the page origin. Default true. */
    blockExternal?: boolean;
    /** Path to the Chrome executable. Defaults to an OS-appropriate location. */
    executablePath?: string;
    /** Milliseconds to wait for the page to load. Default 30s. */
    navigationTimeoutMs?: number;
}

const DEFAULT_EXECUTABLE_CANDIDATES: string[] = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
];

export function findChromeExecutable(explicit?: string): string | undefined {
    if (explicit) return explicit;
    return DEFAULT_EXECUTABLE_CANDIDATES.find((path) => existsSync(path));
}

export interface ScreenshotResult {
    /** Full-page PNG bytes. */
    png: Uint8Array;
    /** Viewport used. */
    width: number;
    /** The rendered page's total height in px. */
    pageHeight: number;
}

/** Open a page, settle, and capture a full-page screenshot. */
export async function captureScreenshot(url: string, options: ScreenshotOptions): Promise<ScreenshotResult> {
    const executablePath = findChromeExecutable(options.executablePath);
    if (!executablePath) {
        throw new Error('No Chrome/Chromium executable found. Set VR_CHROME_PATH or pass executablePath.');
    }

    const browser: Browser = await puppeteer.launch({
        executablePath,
        // puppeteer ≥22 runs the new headless mode by default; `true` is the
        // typed value (the old `'new'` string was removed in v23+).
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1'],
    });

    try {
        const page: Page = await browser.newPage();
        await page.setViewport({
            width: options.width,
            height: options.height ?? 800,
            deviceScaleFactor: options.deviceScaleFactor ?? 1,
        });

        if (options.blockExternal !== false) {
            await page.setRequestInterception(true);
            // Allow the page itself and its same-host resources (127.0.0.1
            // static server, data: URIs); block everything external so both
            // pages render with identical local resources. Matching by host
            // (not page.url()) keeps the very first navigation safe — the
            // page URL is still about:blank when the document request fires.
            const allowedHost = new URL(url).host;
            page.on('request', (request) => {
                try {
                    const requestUrl = new URL(request.url());
                    const allowed =
                        requestUrl.protocol === 'data:' || requestUrl.host === allowedHost;
                    if (allowed) {
                        request.continue();
                    } else {
                        request.abort();
                    }
                } catch {
                    request.continue();
                }
            });
        }

        await page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: options.navigationTimeoutMs ?? 30_000,
        });

        // Trigger viewport (whileInView) animations by sweeping through the
        // page, then settle so mount/entrance animations reach rest state.
        await page.evaluate(async () => {
            const doc = document.documentElement;
            const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
            for (let y = 0; y <= doc.scrollHeight; y += step) {
                window.scrollTo(0, y);
                await new Promise((resolve) => setTimeout(resolve, 60));
            }
            window.scrollTo(0, 0);
        });
        await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 800));

        const png = await page.screenshot({ fullPage: true });
        const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

        return { png, width: options.width, pageHeight };
    } finally {
        await browser.close();
    }
}
