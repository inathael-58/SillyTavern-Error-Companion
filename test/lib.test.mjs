import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RULES, UNKNOWN } from '../errors.js';
import { dayKey, graphemes, matchRule, pickLine, plainText } from '../lib.js';

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
    assert.equal(pickLine(rule, 1, () => 0), rule.lines[0].text[0]);
    assert.equal(pickLine(rule, 3, () => 0), 'ออกไปแตะหญ้าเถอะครับ');
    assert.match(pickLine(rule, 9, () => 0.99), /9 ครั้ง/);
    assert.equal(pickLine(UNKNOWN, 50, () => 0), UNKNOWN.lines[0].text[0]);
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
