import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES, UNKNOWN } from '../errors.js';
import { DEFAULT_COLOR, DEFAULT_CROP, cropBox, dayKey, exportCompanion, formatLines, graphemes, inkFor, isSafeImageUrl, matchRule, parseLines, pickEntry, pickLine, plainText, sanitizeCompanion, sanitizeCrop, sanitizePlace } from '../lib.js';

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
        ['Requests ending with a model turn are not supported.', 'prefill'],
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
        ['This model does not support assistant message prefill. The conversation must end with a user message.', 'prefill'],
        ['Provider returned error', 'server'],
        // SillyTavern itself
        ['Could not get a reply from API. Check your connection settings / API key and try again.', 'noreply'],
        ['Failed to fetch', 'network'],
        ['Bad Gateway', 'server'],
    ];
    for (const [message, want] of cases) assert.equal(id(message), want, message);
    assert.equal(id('Mandatory prompts exceed the context size.', ''), 'context');
    assert.equal(id('Verify that the server is running and accessible.', 'ST Server cannot be reached'), 'stserver');
    // collected from users
    assert.equal(id('Check the server connection and reload the page to prevent data loss.', 'Settings could not be saved'), 'stserver');
    assert.equal(id('Check the server connection and reload the page to prevent data loss.', 'Chat could not be saved'), 'stserver');
    assert.equal(id("Couldn't get CSRF token. Please refresh the page.", 'Error'), 'stserver');
    assert.equal(id('Service Unavailable', 'API returned an error'), 'overloaded');
    assert.equal(id('Unauthorized', 'API returned an error'), 'key');
    assert.equal(id('upstream error: do request failed (request id: 2026090807262519360889682 68d9d69kJSt34g)'), 'server');
    assert.equal(id('Multiturn chat is not enabled for models/antigravity-preview-05-2026'), 'model');
    assert.equal(id('Your project has been denied access. Please contact support.'), 'denied');
    assert.equal(id('Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.'), 'param');
    assert.equal(id('The file is likely invalid or corrupted.', 'Could not import character'), 'import');
    // other wordings of the same problems
    assert.equal(id("Unsupported parameter: 'temperature' is not supported with this model."), 'param');
    assert.equal(id('reasoning_effort is not supported by this model'), 'param');
    assert.equal(id('Your account has been suspended.'), 'denied');
    assert.equal(id('PERMISSION_DENIED'), 'key');
    assert.equal(id('Forbidden', 'API returned an error'), 'forbidden');
    assert.equal(id('Request failed with status code 403'), 'forbidden');
    assert.equal(id('<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center></body></html>'), 'forbidden');
    // the more specific 403s keep their own explanation
    assert.equal(id('Your project has been denied access. Please contact support.'), 'denied');
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
    for (const message of ['Failed to save preset', 'Invalid file', 'Name is required', 'Character not found in the list']) {
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
        assert.equal(rule.mood !== undefined && rule.match.every(re => re instanceof RegExp), true, rule.id);
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
        images: [
            { id: 'smile', name: ' ยิ้ม ', url: ' https://x.test/smile.png ' },
            { id: 'cry', name: '', url: '/img/cry.png' },
            { id: 'empty', name: 'ไม่มีลิงก์', url: '' },
            { id: 'smile', name: 'ซ้ำ id', url: 'https://x.test/dup.png' },
            'junk',
        ],
        errorImages: { overloaded: 'cry', quota: 'empty', blocked: 'nope', nonsense: 'smile', network: 'smile' },
        lines: {
            overloaded: [{ from: 1, text: ['เต็มอีกแล้ว'] }, { from: 3, text: ['ไปนอนเถอะ', 42] }],
            blocked: 'สารภาพมา\n[2] อีกแล้วเหรอ',
            quota: ['หมดแล้ว', 'หมดจริง'],
            nonsense: ['x'],
            empty: [],
        },
        extra: 'dropped',
    });
    assert.deepEqual(c, {
        name: 'พี่หมอก',
        color: '#abcdef',
        images: [
            { id: 'smile', name: 'ยิ้ม', url: 'https://x.test/smile.png' },
            { id: 'cry', name: 'รูป 2', url: '/img/cry.png' },
            { id: 'img3', name: 'ซ้ำ id', url: 'https://x.test/dup.png' },
        ],
        errorImages: { overloaded: 'cry', network: 'smile' },
        lines: {
            overloaded: [{ from: 1, text: ['เต็มอีกแล้ว'] }, { from: 3, text: ['ไปนอนเถอะ'] }],
            blocked: [{ from: 1, text: ['สารภาพมา'] }, { from: 2, text: ['อีกแล้วเหรอ'] }],
            quota: [{ from: 1, text: ['หมดแล้ว', 'หมดจริง'] }],
        },
        crop: { ...DEFAULT_CROP },
    });
    assert.equal(sanitizeCompanion({ name: 'a', color: 'red' }).color, DEFAULT_COLOR);
    assert.deepEqual(sanitizeCompanion({ name: 'a' }).images, []);
    assert.throws(() => sanitizeCompanion({ name: '' }), /ชื่อ/);
    assert.throws(() => sanitizeCompanion({ type: 'chara_card_v2', name: 'x' }), /ไม่ใช่ไฟล์/);
    assert.throws(() => sanitizeCompanion([]), /ไม่ใช่ไฟล์/);
    assert.throws(() => sanitizeCompanion({ name: 'x', images: [{ name: 'ตกใจ', url: 'javascript:alert(1)' }] }), /ตกใจ/);
    assert.throws(() => sanitizeCompanion({ name: 'x', icon: 'javascript:alert(1)' }), /ไอคอน/);
    assert.equal(sanitizeCompanion({ name: 'x', icon: ' /img/face.png ' }).icon, '/img/face.png');
    assert.equal('icon' in sanitizeCompanion({ name: 'x', icon: '' }), false);
    // at most 50 lines per error, 40 images
    const many = sanitizeCompanion({
        name: 'x',
        images: Array.from({ length: 60 }, (_, i) => ({ url: `/i/${i}.png` })),
        lines: { network: Array.from({ length: 80 }, (_, i) => `l${i}`) },
    });
    assert.equal(many.lines.network[0].text.length, 50);
    assert.equal(many.images.length, 40);
});

test('version-1 companions (six fixed slots) are converted', () => {
    const c = sanitizeCompanion({
        type: 'error-companion',
        version: 1,
        name: 'เก่า',
        sprites: { neutral: '/n.png', tired: '/t.png', shocked: 'https://x.test/s.png', pious: '' },
        lines: {},
    });
    assert.deepEqual(c.images, [
        { id: 'neutral', name: 'ปกติ', url: '/n.png' },
        { id: 'tired', name: 'ปลง', url: '/t.png' },
        { id: 'shocked', name: 'ตกใจ', url: 'https://x.test/s.png' },
    ]);
    const byMood = mood => RULES.filter(r => r.mood === mood).map(r => r.id);
    for (const id of byMood('tired')) assert.equal(c.errorImages[id], 'tired');
    for (const id of byMood('shocked')) assert.equal(c.errorImages[id], 'shocked');
    assert.equal(c.errorImages.unknown, 'neutral');
    // slots that had no image: no entry, so the first image is used
    for (const id of byMood('pious')) assert.equal(c.errorImages[id], undefined);
    // converting again changes nothing
    assert.deepEqual(sanitizeCompanion(c), c);
});

test('export → import round trip', () => {
    const c = sanitizeCompanion({
        name: 'ฟ้า', color: '#336699',
        images: [{ id: 'a', name: 'ยิ้ม', url: '/img/a.png' }, { id: 'b', name: 'ร้องไห้', url: '/img/b.png' }],
        errorImages: { server: 'b' },
        icon: 'https://x.test/i.png', crop: { x: 0.4, y: 0.3, size: 0.6 },
        lines: { server: 'พังอีกแล้ว\n[4] พังจริง' },
    });
    const file = JSON.parse(JSON.stringify(exportCompanion({ ...c, id: 'local-only' })));
    assert.equal(file.type, 'error-companion');
    assert.equal(file.version, 2);
    assert.equal(file.id, undefined);
    assert.deepEqual(sanitizeCompanion(file), c);
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

test('sanitizePlace keeps what it can per screen shape', () => {
    assert.equal(sanitizePlace(null), undefined);
    assert.equal(sanitizePlace({ tall: { x: 'a', y: 1, h: 1 } }), undefined);
    assert.deepEqual(sanitizePlace({ tall: { x: 0.5, y: 0.9, h: 0.6 }, wide: { x: 2, y: -1, h: 9 }, side: { x: 0, y: 0, h: 1 } }),
        { tall: { x: 0.5, y: 0.9, h: 0.6 }, wide: { x: 1, y: 0, h: 1.5 } });
});

test('each image keeps its own icon crop and screen placement through export and import', () => {
    const comp = sanitizeCompanion({
        name: 'แม่มด',
        crop: { x: 0.5, y: 0.2, size: 0.5 },
        images: [
            { id: 'stand', name: 'ยืน', url: 'https://example.com/stand.png' },
            { id: 'fly', name: 'บิน', url: 'https://example.com/fly.png', crop: { x: 0.7, y: 0.1, size: 0.3 }, place: { tall: { x: 0.5, y: 0.6, h: 0.4 } } },
        ],
    });
    assert.equal(comp.images[0].crop, undefined); // falls back to the companion's crop
    assert.deepEqual(comp.images[1].crop, { x: 0.7, y: 0.1, size: 0.3 });
    assert.deepEqual(comp.images[1].place, { tall: { x: 0.5, y: 0.6, h: 0.4 } });
    const again = sanitizeCompanion(exportCompanion(comp));
    assert.deepEqual(again.images, comp.images);
});

test('a line can have a picture of its own', () => {
    const c = sanitizeCompanion({
        name: 'x',
        images: [{ id: 'a', url: '/a.png' }, { id: 'b', url: '/b.png' }, { id: 'gone', url: '' }],
        lines: {
            overloaded: [
                { from: 1, text: ['หนึ่ง', '  ', 'สอง'], images: ['', 'a', 'nope'] },
                { from: 3, text: ['สาม', 'สี่'], images: ['b', 'gone'] },
                { from: 3, text: ['ห้า'], images: ['a'] },
            ],
            quota: [{ from: 1, text: ['ไม่มีรูป'], images: ['', ''] }],
        },
    });
    assert.deepEqual(c.lines.overloaded, [
        { from: 1, text: ['หนึ่ง', 'สอง'] },
        { from: 3, text: ['สาม', 'สี่', 'ห้า'], images: ['b', '', 'a'] },
    ]);
    assert.deepEqual(c.lines.quota, [{ from: 1, text: ['ไม่มีรูป'] }]);
    assert.deepEqual(pickEntry(c.lines.overloaded, 4, () => 0), { text: 'สาม', img: 'b' });
    assert.deepEqual(pickEntry(c.lines.overloaded, 1, () => 0.9), { text: 'สอง', img: '' });
    // survives export → import, and a renamed image id is followed
    assert.deepEqual(sanitizeCompanion(JSON.parse(JSON.stringify(exportCompanion(c)))).lines, c.lines);
    const renamed = sanitizeCompanion({
        name: 'y', images: [{ id: 'p', url: '/1.png' }, { id: 'p', url: '/2.png' }, { id: 'bad id!', url: '/3.png' }],
        lines: { network: [{ from: 1, text: ['a', 'b'], images: ['p', 'bad id!'] }] },
    });
    assert.deepEqual(renamed.lines.network[0].images, ['p', 'img3']);
});
