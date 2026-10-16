import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { BUILTIN_COMPANIONS } from '../companions.js';
import { RULES, UNKNOWN } from '../errors.js';
import { sanitizeCompanion } from '../lib.js';

const RULE_IDS = [...RULES, UNKNOWN].map(r => r.id);

for (const comp of BUILTIN_COMPANIONS) {
    test(`${comp.name}: a picture and own lines for every error`, () => {
        const images = new Set(comp.images.map(i => i.id));
        for (const id of RULE_IDS) {
            assert.ok(images.has(comp.errorImages[id]), `${id}: picture "${comp.errorImages[id]}"`);
            const tiers = comp.lines[id];
            assert.ok(tiers?.length && tiers[0].from === 1, `${id}: lines from the first time`);
            for (const t of tiers) assert.ok(t.text.length && t.text.every(s => s.trim()), `${id}: empty line`);
        }
        assert.deepEqual(Object.keys(comp.lines).sort(), [...RULE_IDS].sort());
    });

    test(`${comp.name}: sprites exist and crops are in range`, () => {
        for (const img of comp.images) {
            assert.ok(existsSync(new URL(`../sprites/${comp.folder}/${img.id}.webp`, import.meta.url)), img.id);
            const [x, y, size] = img.crop;
            for (const v of [x, y, size]) assert.ok(v > 0 && v < 1, `${img.id} crop`);
        }
    });

    test(`${comp.name}: a copy passes the same checks as a user-made companion`, () => {
        const copy = sanitizeCompanion({
            name: comp.name, color: comp.color, crop: comp.crop, errorImages: comp.errorImages, lines: comp.lines,
            images: comp.images.map(i => ({ id: i.id, name: i.name, url: `https://example.com/${i.id}.webp` })),
        });
        assert.equal(copy.images.length, comp.images.length);
        assert.deepEqual(copy.errorImages, comp.errorImages);
        assert.deepEqual(Object.keys(copy.lines).sort(), [...RULE_IDS].sort());
    });
}
