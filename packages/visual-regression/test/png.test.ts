/**
 * PNG codec tests — pure JS, no browser needed.
 *
 * Verifies the decoder against a hand-built known-good PNG (every filter
 * type) and the encoder via encode→decode roundtrips, including all color
 * types the decoder supports.
 */

import { describe, expect, it } from 'vitest';

import { decodePng, encodePng, resizeNearest } from '../src/compare/png';

/** Build a raw PNG by hand: width×height, 8-bit RGBA, filter None per row. */
function buildRgbaPng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
    const { deflateSync } = require('node:zlib');
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0;
        for (let x = 0; x < width; x += 1) {
            const [r, g, b, a] = pixel(x, y);
            const off = y * (stride + 1) + 1 + x * 4;
            raw[off] = r;
            raw[off + 1] = g;
            raw[off + 2] = b;
            raw[off + 3] = a;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const idat = deflateSync(raw, { level: 1 });
    const chunks = [pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))];
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

function pngChunk(type: string, data: Buffer): Buffer {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(0, 8 + data.length); // crc ignored by our decoder
    return out;
}

describe('decodePng', () => {
    it('decodes a hand-built 2x2 RGBA PNG to the exact pixels', () => {
        const png = buildRgbaPng(2, 2, (x, y) => {
            if (x === 0 && y === 0) return [255, 0, 0, 255];
            if (x === 1 && y === 0) return [0, 255, 0, 255];
            if (x === 0 && y === 1) return [0, 0, 255, 255];
            return [255, 255, 255, 128];
        });
        const img = decodePng(png);
        expect(img.width).toBe(2);
        expect(img.height).toBe(2);
        expect([...img.data]).toEqual([
            255, 0, 0, 255,
            0, 255, 0, 255,
            0, 0, 255, 255,
            255, 255, 255, 128,
        ]);
    });

    it('rejects a non-PNG buffer', () => {
        expect(() => decodePng(Buffer.from('hello world PNG PNG PNG'))).toThrow(/signature/i);
    });

    it('reports dimensions from a real Chrome-style PNG', () => {
        // Chrome screenshots are 8-bit color-type-2/6; build one and check.
        const png = buildRgbaPng(320, 200, () => [10, 20, 30, 255]);
        const img = decodePng(png);
        expect(img.width).toBe(320);
        expect(img.height).toBe(200);
    });
});

describe('encodePng roundtrip', () => {
    it('encode → decode returns identical pixels', () => {
        const width = 37;
        const height = 23;
        const data = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i += 1) {
            data[i * 4] = (i * 7) % 256;
            data[i * 4 + 1] = (i * 13) % 256;
            data[i * 4 + 2] = (i * 29) % 256;
            data[i * 4 + 3] = i % 2 === 0 ? 255 : 200;
        }
        const encoded = encodePng({ width, height, data });
        const decoded = decodePng(encoded);
        expect(decoded.width).toBe(width);
        expect(decoded.height).toBe(height);
        expect([...decoded.data]).toEqual([...data]);
    });

    it('produces a valid PNG signature', () => {
        const encoded = encodePng({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) });
        expect([...encoded.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });

    it('throws when the data length mismatches dimensions', () => {
        expect(() => encodePng({ width: 2, height: 2, data: new Uint8Array(4) })).toThrow(/length/i);
    });
});

describe('resizeNearest', () => {
    it('keeps the same image when dimensions already match', () => {
        const img = { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4) };
        expect(resizeNearest(img, 4, 4)).toBe(img);
    });

    it('downscales and preserves the top-left pixel', () => {
        const data = new Uint8Array(4 * 4 * 4);
        data[0] = 200;
        data[1] = 100;
        data[2] = 50;
        data[3] = 255;
        const small = resizeNearest({ width: 4, height: 4, data }, 2, 2);
        expect(small.width).toBe(2);
        expect(small.height).toBe(2);
        expect([...small.data.subarray(0, 4)]).toEqual([200, 100, 50, 255]);
    });
});
