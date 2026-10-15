import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES, UNKNOWN } from '../errors.js';
import { DEFAULT_COLOR, DEFAULT_CROP, cropBox, dayKey, exportCompanion, formatLines, graphemes, inkFor, isSafeImageUrl, matchRule, parseLines, pickLine, plainText, sanitizeCompanion, sanitizeCrop } from '../lib.js';

const id = (message, title = 'Chat Completion API', opts) => matchRule(message, title, opts)?.id ?? null;

test('real error texts land on the right rule', () => {
    const cases = [
        // Google AI Studio / Vertex
        ['The model is overloaded. Please try again later.', 'overloaded'],
        ['This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', 'overloaded'],
        ['The service is currently unavailable.', 'overloaded'],
        ['Google AI Studio API returned no candidate\nPrompt was blocked due to : PROHIBITED_CONTENT', 'blocked'],
        ['Google AI Studio API returned no candidate\nPrompt was blocked due to : OTHER', 'blocked'],
        ['Google AI Studio Candidate text empty', 'empty'],
        ['Google AI Studio API returned no candidate', 'empty'],
        ['You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.', 'quota'],
        ['Resource has been exhausted (e.g. check quota).', 'quota'],
        ['API key not valid. Please pass a valid API key.', 'key'],
        ['API key expired. Please renew the API key.', 'key'],
        ['User location is not supported for the API use.', 'location'],
        ['The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).', 'context'],
        ['models/gemini-1.0-pro is not found for API version v1beta, or is not supported for generateContent.', 'model'],
        ['Internal error encountered.', 'server'],
        ['Deadline expired before operation could complete.', 'server'],
        // OpenRouter / OpenAI / Anthropic
        ['Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day', 'quota'],
        ['This request requires more credits, or fewer max_tokens. You requested up to 8192 tokens, but can only afford 1200.', 'credits'],
        ['Insufficient credits. Add more using https://openrouter.ai/credits', 'credits'],
        ['Your credit balance is too low to access the Anthropic API.', 'credits'],
        ['No auth credentials found', 'key'],
        ['Incorrect API key provided: sk-abc. You can find your API key at https://platform.openai.com/account/api-keys.', 'key'],
        ['invalid x-api-key', 'key'],
        ['No endpoints found for meta-llama/llama-3-8b:free.', 'model'],
        ["This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.", 'context'],
        ['prompt is too long: 210000 tokens > 200000 maximum', 'context'],
        ['Overloaded', 'overloaded'],
        ['Provider returned error', 'server'],
        // SillyTavern itself
        ['Could not get a reply from API. Check your connection settings / API key and try again.', 'network'],
        ['Failed to fetch', 'network'],
        ['Bad Gateway', 'server'],
    ];
    for (const [message, want] of cases) assert.equal(id(message), want, message);
    assert.equal(id('Mandatory prompts exceed the context size.', ''), 'context');
    assert.equal(id('Verify that the server is running and accessible.', 'ST Server cannot be reached'), 'network');
    assert.equal(id('flagged text', 'Reasons: sexual'), 'blocked');
});

test('unknown fallback only for API-looking toasts', () => {
    assert.equal(id('[object Object]', 'API returned an error'), 'unknown');
    assert.equal(id('weird', 'Text generation error'), 'unknown');
    assert.equal(id('weird', 'Chat Completion API', { unknown: false }), null);
    assert.equal(id('Preset name should be unique.', ''), null);
    assert.equal(id('Failed to save preset', ''), null);
    assert.equal(id('', ''), null);
});

test('ordinary words do not trigger rules', () => {
    for (const message of ['Chat could not be saved', 'Invalid file', 'Name is required', 'Character not found in the list']) {
        assert.equal(id(message, ''), null, message);
    }
    // lower-case "safety" alone is not Google's block reason
    assert.equal(id('check the safety settings', ''), null);
});

test('pickLine uses the highest tier reached and fills {n}', () => {
    const rule = RULES.find(r => r.id === 'overloaded');
    assert.equal(pickLine(rule.lines, 1, () => 0), rule.lines[0].text[0]);
    assert.equal(pickLine(rule.lines, 3, () => 0), 'ออกไปแตะหญ้าเถอะครับ');
    assert.match(pickLine(rule.lines, 9, () => 0.99), /9 ครั้ง/);
    assert.equal(pickLine(UNKNOWN.lines, 50, () => 0), UNKNOWN.lines[0].text[0]);
    // only later tiers: the first one is used until it is reached
    assert.equal(pickLine([{ from: 3, text: ['x'] }], 1, () => 0), 'x');
});

test('every rule is complete', () => {
    const moods = new Set(['neutral', 'tired', 'pious', 'exhausted', 'shocked', 'confused']);
    for (const rule of [...RULES, UNKNOWN]) {
        assert.ok(moods.has(rule.mood), rule.id);
        assert.ok(rule.lines.length && rule.lines[0].from === 1, rule.id);
        assert.ok(rule.title && rule.what && rule.fixes.length, rule.id);
        assert.equal(matchRule(rule.sample.message, rule.sample.title ?? '')?.id, rule.id, `sample of ${rule.id}`);
    }
    assert.equal(new Set(RULES.map(r => r.id)).size, RULES.length);
});

test('plainText strips tags and entities', () => {
    assert.equal(plainText('a<br>b &amp; <b>c</b>'), 'a\nb & c');
    assert.equal(plainText(new Error('boom')), 'boom');
    assert.equal(plainText(undefined), '');
});

test('graphemes keep Thai marks with their consonant', () => {
    assert.deepEqual(graphemes('ที่นี่'), ['ที่', 'นี่']);
    assert.equal(graphemes('ออกไปแตะหญ้า').join(''), 'ออกไปแตะหญ้า');
});

test('dayKey is the local date', () => {
    assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

const IDS = [...RULES, UNKNOWN].map(r => r.id);

test('parseLines / formatLines', () => {
    const tiers = parseLines('  ร้านเต็มครับ \n\n[3] แตะหญ้า\n[3+] ดื่มน้ำ\n[10]   \n[8]ครั้งที่ {n}\nอีกประโยค');
    assert.deepEqual(tiers, [
        { from: 1, text: ['ร้านเต็มครับ', 'อีกประโยค'] },
        { from: 3, text: ['แตะหญ้า', 'ดื่มน้ำ'] },
        { from: 8, text: ['ครั้งที่ {n}'] },
    ]);
    assert.deepEqual(parseLines(formatLines(tiers)), tiers);
    assert.deepEqual(parseLines(''), []);
    assert.equal(formatLines(RULES[1].lines).split('\n')[0], RULES[1].lines[0].text[0]);
});

test('isSafeImageUrl', () => {
    for (const ok of ['https://i.imgur.com/a.png', 'http://localhost:8000/x.webp', '/characters/Seraphina/joy.png', 'user/images/a b.png', 'data:image/png;base64,iVBORw0KGgo=']) {
        assert.ok(isSafeImageUrl(ok), ok);
    }
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///etc/passwd', '//evil.example/a.png', 'vbscript:x', '', null]) {
        assert.ok(!isSafeImageUrl(bad), String(bad));
    }
});

test('sanitizeCompanion cleans and validates', () => {
    const c = sanitizeCompanion({
        type: 'error-companion',
        name: '  พี่หมอก  ',
        color: '#ABCDEF',
        sprites: { neutral: ' https://x.test/n.png ', tired: '', weird: 'https://x.test/w.png' },
        lines: {
            overloaded: [{ from: 1, text: ['เต็มอีกแล้ว'] }, { from: 3, text: ['ไปนอนเถอะ', 42] }],
            blocked: 'สารภาพมา\n[2] อีกแล้วเหรอ',
            quota: ['หมดแล้ว', 'หมดจริง'],
            nonsense: ['x'],
            empty: [],
        },
        extra: 'dropped',
    }, IDS);
    assert.deepEqual(c, {
        name: 'พี่หมอก',
        color: '#abcdef',
        sprites: { neutral: 'https://x.test/n.png' },
        lines: {
            overloaded: [{ from: 1, text: ['เต็มอีกแล้ว'] }, { from: 3, text: ['ไปนอนเถอะ'] }],
            blocked: [{ from: 1, text: ['สารภาพมา'] }, { from: 2, text: ['อีกแล้วเหรอ'] }],
            quota: [{ from: 1, text: ['หมดแล้ว', 'หมดจริง'] }],
        },
        crop: { ...DEFAULT_CROP },
    });
    assert.equal(sanitizeCompanion({ name: 'a', color: 'red' }, IDS).color, DEFAULT_COLOR);
    assert.throws(() => sanitizeCompanion({ name: '' }, IDS), /ชื่อ/);
    assert.throws(() => sanitizeCompanion({ type: 'chara_card_v2', name: 'x' }, IDS), /ไม่ใช่ไฟล์/);
    assert.throws(() => sanitizeCompanion([], IDS), /ไม่ใช่ไฟล์/);
    assert.throws(() => sanitizeCompanion({ name: 'x', sprites: { shocked: 'javascript:alert(1)' } }, IDS), /shocked/);
    assert.throws(() => sanitizeCompanion({ name: 'x', icon: 'javascript:alert(1)' }, IDS), /ไอคอน/);
    assert.equal(sanitizeCompanion({ name: 'x', icon: ' /img/face.png ' }, IDS).icon, '/img/face.png');
    assert.equal('icon' in sanitizeCompanion({ name: 'x', icon: '' }, IDS), false);
    // at most 50 lines per error
    const many = sanitizeCompanion({ name: 'x', lines: { network: Array.from({ length: 80 }, (_, i) => `l${i}`) } }, IDS);
    assert.equal(many.lines.network[0].text.length, 50);
});

test('export → import round trip', () => {
    const c = sanitizeCompanion({ name: 'ฟ้า', color: '#336699', sprites: { pious: '/img/p.png' }, icon: 'https://x.test/i.png', crop: { x: 0.4, y: 0.3, size: 0.6 }, lines: { server: 'พังอีกแล้ว\n[4] พังจริง' } }, IDS);
    const file = JSON.parse(JSON.stringify(exportCompanion({ ...c, id: 'local-only' })));
    assert.equal(file.type, 'error-companion');
    assert.equal(file.version, 1);
    assert.equal(file.id, undefined);
    assert.deepEqual(sanitizeCompanion(file, IDS), c);
});

test('inkFor picks readable text', () => {
    assert.equal(inkFor('#f2a03d'), '#1e1e1e');
    assert.equal(inkFor('#1b2a4a'), '#ffffff');
    assert.equal(inkFor('nope'), '#1e1e1e');
});

test('sanitizeCrop clamps and fills in', () => {
    assert.deepEqual(sanitizeCrop(undefined), DEFAULT_CROP);
    assert.deepEqual(sanitizeCrop({ x: -1, y: 2, size: 0 }), { x: 0, y: 1, size: 0.1 });
    assert.deepEqual(sanitizeCrop({ x: '0.25', size: 'big' }), { x: 0.25, y: DEFAULT_CROP.y, size: DEFAULT_CROP.size });
});

test('cropBox puts the chosen point at the centre', () => {
    // 600×400 image, show half its width in a 60px circle, centred on (0.5, 0.25)
    const b = cropBox({ x: 0.5, y: 0.25, size: 0.5 }, 600, 400, 60);
    assert.equal(b.width, 120);             // image drawn 120px wide (80px tall)
    assert.equal(b.left + 0.5 * 120, 30);   // x point at the centre
    assert.equal(b.top + 0.25 * 80, 30);    // y point at the centre
    // whole image width across the circle
    assert.equal(cropBox({ x: 0.5, y: 0.5, size: 1 }, 100, 100, 64).left, 0);
});
