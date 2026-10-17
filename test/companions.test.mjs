import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { BUILTIN_COMPANIONS, CHARACTER_LINES, EXPRESSION_FOR, SERAPHINA } from '../companions.js';
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

/** The labels SillyTavern's expression classifier uses (and Seraphina's sprites are named after). */
const LABELS = ['admiration', 'amusement', 'anger', 'annoyance', 'approval', 'caring', 'confusion', 'curiosity', 'desire',
    'disappointment', 'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear', 'gratitude', 'grief', 'joy', 'love',
    'nervousness', 'neutral', 'optimism', 'pride', 'realization', 'relief', 'remorse', 'sadness', 'surprise'];

test('every error has expressions to look for, all real labels', () => {
    assert.deepEqual(Object.keys(EXPRESSION_FOR).sort(), [...RULE_IDS].sort());
    for (const [id, labels] of Object.entries(EXPRESSION_FOR)) {
        assert.ok(labels.length, id);
        for (const l of labels) assert.ok(LABELS.includes(l), `${id}: ${l}`);
    }
});

for (const [who, lines] of [['Seraphina', SERAPHINA.lines], ['the chat character', CHARACTER_LINES]]) {
    test(`${who}: own lines for every error`, () => {
        assert.deepEqual(Object.keys(lines).sort(), [...RULE_IDS].sort());
        for (const id of RULE_IDS) {
            assert.equal(lines[id][0].from, 1, id);
            for (const t of lines[id]) assert.ok(t.text.length && t.text.every(s => s.trim()), id);
        }
    });
}

test('lines about the chat character name them', () => {
    for (const [id, tiers] of Object.entries(CHARACTER_LINES)) {
        for (const t of tiers) for (const s of t.text) assert.ok(s.includes('{name}'), `${id}: ${s}`);
    }
});

test('the example in examples/ imports and speaks for every error', async () => {
    const { readFileSync } = await import('node:fs');
    const data = JSON.parse(readFileSync(new URL('../examples/mochi/mochi.companion.json', import.meta.url), 'utf8'));
    const comp = sanitizeCompanion(data);
    assert.equal(comp.images.length, 5);
    assert.ok(comp.images.every(i => i.url.startsWith('data:image/webp;base64,')));
    assert.deepEqual(Object.keys(comp.lines).sort(), [...RULE_IDS].sort());
    assert.deepEqual(Object.keys(comp.errorImages).sort(), [...RULE_IDS].sort());
});
