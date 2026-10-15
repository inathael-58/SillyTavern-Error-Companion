/*
 * Error Companion — matching and line picking (no DOM)
 *
 * Plain functions over strings so they can be tested without a browser.
 */

import { API_TITLE, RULES, UNKNOWN } from './errors.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Toast content → plain text (toasts may carry HTML, or text that was escaped for it). */
export function plainText(value) {
    if (value === null || value === undefined) return '';
    let s = typeof value === 'string' ? value : (value instanceof Error ? value.message : String(value?.message ?? value));
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    s = s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e]);
    return s.trim();
}

/**
 * Which rule explains this toast, or null.
 * @param {string} message plain text
 * @param {string} title plain text
 * @param {{ unknown?: boolean, rules?: import('./errors.js').ErrorRule[] }} [opts]
 *   unknown: fall back to the "don't know this one" rule for API-looking toasts
 */
export function matchRule(message, title, { unknown = true, rules = RULES } = {}) {
    const text = title ? `${title}\n${message}` : message;
    if (!text.trim()) return null;
    for (const rule of rules) {
        if (rule.match.some(re => re.test(text))) return rule;
    }
    if (unknown && title && API_TITLE.test(title)) return UNKNOWN;
    return null;
}

/**
 * A line for the n-th time this error was seen today.
 * @param {import('./errors.js').ErrorRule} rule
 * @param {number} count 1 for the first time
 * @param {() => number} [random]
 */
export function pickLine(rule, count, random = Math.random) {
    const tiers = rule.lines.filter(t => t.from <= Math.max(1, count));
    const tier = tiers.length ? tiers[tiers.length - 1] : rule.lines[0];
    const text = tier.text[Math.floor(random() * tier.text.length)] ?? tier.text[0];
    return text.replaceAll('{n}', String(count));
}

/** Local calendar day, for "seen today" counts. */
export function dayKey(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Text split into what a reader sees as single characters, so a typewriter
 * effect never shows a Thai vowel or tone mark on its own.
 */
export function graphemes(text) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text)].map(s => s.segment);
    }
    // fallback: attach combining marks (Thai above/below vowels and tones, generic marks) to the previous char
    const out = [];
    for (const ch of text) {
        if (out.length && /[ัิ-ฺ็-๎̀-ͯ]/.test(ch)) out[out.length - 1] += ch;
        else out.push(ch);
    }
    return out;
}
