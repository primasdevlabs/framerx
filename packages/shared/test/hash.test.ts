/**
 * Tests for the synchronous SHA-256 content hash.
 */

import { describe, expect, it } from 'vitest';

import { sha256Hex, sha256HexOfString } from '../src/hash';

describe('sha256', () => {
    it('matches the NIST empty-string vector', () => {
        expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('matches the NIST "abc" vector', () => {
        expect(sha256HexOfString('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('matches the NIST multi-block vector', () => {
        const value = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
        expect(sha256HexOfString(value)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });

    it('matches the NIST 1,000,000-character "a" vector', () => {
        expect(sha256HexOfString('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    });

    it('is deterministic for identical bytes', () => {
        const a = sha256Hex(new TextEncoder().encode('hero.png bytes'));
        const b = sha256Hex(new TextEncoder().encode('hero.png bytes'));
        expect(a).toBe(b);
        expect(a).not.toBe(sha256Hex(new TextEncoder().encode('hero.png bytes!')));
    });

    it('works on arbitrary byte values (including 0xFF)', () => {
        // Expected digest computed with `printf '\x00\x01\x02\xff\xfe\x80\x7f' | sha256sum`.
        const bytes = new Uint8Array([0, 1, 2, 0xff, 0xfe, 0x80, 0x7f]);
        expect(sha256Hex(bytes)).toBe('0f761afa5f02de14674ca4e67b2c7facff2dda81228c566754701d1dc9975c86');
        expect(sha256Hex(bytes)).toHaveLength(64);
        // Same bytes, different buffer → same digest.
        expect(sha256Hex(new Uint8Array(bytes))).toBe(sha256Hex(bytes));
    });
});
