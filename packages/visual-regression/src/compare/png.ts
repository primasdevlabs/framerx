/**
 * Pure-JS PNG codec — no native dependencies.
 *
 * Decodes 8-bit PNGs (color types 0 gray, 2 RGB, 4 gray+alpha, 6 RGBA;
 * non-interlaced) into RGBA pixels, and encodes RGBA pixels back into PNG
 * for diff images. Chrome's `page.screenshot()` emits exactly this shape, so
 * the visual-regression suite never needs a native image library.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decoded RGBA pixels. */
export interface RgbaImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel, row-major. */
    data: Uint8Array;
}

/** Decode a PNG buffer into RGBA pixels. */
export function decodePng(buffer: Buffer | Uint8Array): RgbaImage {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    if (bytes.length < 33 || !PNG_SIGNATURE.equals(bytes.subarray(0, 8))) {
        throw new Error('Not a PNG file (signature mismatch)');
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idatChunks: Buffer[] = [];

    while (offset + 8 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const data = bytes.subarray(offset + 8, offset + 8 + length);

        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'IDAT') {
            idatChunks.push(Buffer.from(data));
        } else if (type === 'IEND') {
            break;
        }

        offset += 12 + length;
    }

    if (width === 0 || height === 0) throw new Error('PNG has no IHDR dimensions');
    if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth: ${bitDepth} (only 8-bit is supported)`);
    if (interlace !== 0) throw new Error('Interlaced PNGs are not supported');

    const channelsPerPixel = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
    if (channelsPerPixel === 0) throw new Error(`Unsupported PNG color type: ${colorType}`);

    const raw = inflateSync(Buffer.concat(idatChunks));
    const stride = width * channelsPerPixel;
    const out = new Uint8Array(width * height * 4);
    const scanline = new Uint8Array(stride);
    const prev = new Uint8Array(stride);

    let rawOffset = 0;
    for (let y = 0; y < height; y += 1) {
        if (rawOffset >= raw.length) throw new Error('PNG data truncated');
        const filter = raw[rawOffset];
        rawOffset += 1;
        scanline.set(raw.subarray(rawOffset, rawOffset + stride));
        rawOffset += stride;

        unfilter(filter, scanline, prev, channelsPerPixel);
        prev.set(scanline);

        for (let x = 0; x < width; x += 1) {
            const src = x * channelsPerPixel;
            const dst = (y * width + x) * 4;
            switch (colorType) {
                case 0: // gray
                    out[dst] = scanline[src];
                    out[dst + 1] = scanline[src];
                    out[dst + 2] = scanline[src];
                    out[dst + 3] = 255;
                    break;
                case 2: // RGB
                    out[dst] = scanline[src];
                    out[dst + 1] = scanline[src + 1];
                    out[dst + 2] = scanline[src + 2];
                    out[dst + 3] = 255;
                    break;
                case 4: // gray + alpha
                    out[dst] = scanline[src];
                    out[dst + 1] = scanline[src];
                    out[dst + 2] = scanline[src];
                    out[dst + 3] = scanline[src + 1];
                    break;
                case 6: // RGBA
                    out[dst] = scanline[src];
                    out[dst + 1] = scanline[src + 1];
                    out[dst + 2] = scanline[src + 2];
                    out[dst + 3] = scanline[src + 3];
                    break;
                default:
                    break;
            }
        }
    }

    return { width, height, data: out };
}

/** Apply one of the five PNG filter types to a scanline, in place. */
function unfilter(
    filter: number,
    scanline: Uint8Array,
    prev: Uint8Array,
    channels: number,
): void {
    switch (filter) {
        case 0: // None
            return;
        case 1: // Sub
            for (let i = channels; i < scanline.length; i += 1) {
                scanline[i] = (scanline[i] + scanline[i - channels]) & 0xff;
            }
            return;
        case 2: // Up
            for (let i = 0; i < scanline.length; i += 1) {
                scanline[i] = (scanline[i] + prev[i]) & 0xff;
            }
            return;
        case 3: // Average
            for (let i = 0; i < scanline.length; i += 1) {
                const left = i >= channels ? scanline[i - channels] : 0;
                scanline[i] = (scanline[i] + ((left + prev[i]) >> 1)) & 0xff;
            }
            return;
        case 4: // Paeth
            for (let i = 0; i < scanline.length; i += 1) {
                const left = i >= channels ? scanline[i - channels] : 0;
                const up = prev[i];
                const upLeft = i >= channels ? prev[i - channels] : 0;
                scanline[i] = (scanline[i] + paeth(left, up, upLeft)) & 0xff;
            }
            return;
        default:
            throw new Error(`Unknown PNG filter type: ${filter}`);
    }
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

/** Encode RGBA pixels into a PNG buffer (8-bit, color type 6, filter None). */
export function encodePng(image: RgbaImage): Buffer {
    const { width, height, data } = image;
    if (data.length !== width * height * 4) {
        throw new Error('RGBA data length does not match width * height * 4');
    }

    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        raw[y * (stride + 1)] = 0; // filter None
        Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    const idat = deflateSync(raw, { level: 9 });

    const chunks = [
        chunk('IHDR', ihdr),
        chunk('IDAT', idat),
        chunk('IEND', Buffer.alloc(0)),
    ];
    return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function chunk(type: string, data: Buffer): Buffer {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

/** CRC-32 (PNG variant: reflected, polynomial 0xEDB88320). */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Resize an RGBA image to a target size using nearest-neighbor sampling.
 * Used to align screenshots whose total heights differ (a height drift is
 * itself reported as a diff, but the overlapping region still compares).
 */
export function resizeNearest(image: RgbaImage, width: number, height: number): RgbaImage {
    if (image.width === width && image.height === height) return image;
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
        for (let x = 0; x < width; x += 1) {
            const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
            const s = (sy * image.width + sx) * 4;
            const d = (y * width + x) * 4;
            out[d] = image.data[s];
            out[d + 1] = image.data[s + 1];
            out[d + 2] = image.data[s + 2];
            out[d + 3] = image.data[s + 3];
        }
    }
    return { width, height, data: out };
}
