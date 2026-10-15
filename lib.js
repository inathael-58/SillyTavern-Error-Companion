/*
 * Error Companion — matching, line picking and companion files (no DOM)
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
 * @param {{ from: number, text: string[] }[]} tiers a rule's lines, or a companion's for that rule
 * @param {number} count 1 for the first time
 * @param {() => number} [random]
 */
export function pickLine(tiers, count, random = Math.random) {
    const reached = tiers.filter(t => t.from <= Math.max(1, count));
    const tier = reached.length ? reached[reached.length - 1] : tiers[0];
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

// ---------------------------------------------------------------- companions

export const MOODS = ['neutral', 'tired', 'pious', 'exhausted', 'shocked', 'confused'];
export const COMPANION_TYPE = 'error-companion';
export const DEFAULT_COLOR = '#f2a03d';
/**
 * Round icon in the small bubble: which part of the image to show.
 * x, y = the point (fraction of image width / height) put at the circle's centre;
 * size = how much of the image width the circle spans (smaller = closer).
 * The default fits the head of a typical half-body sprite.
 */
export const DEFAULT_CROP = Object.freeze({ x: 0.5, y: 0.22, size: 0.5 });

const MAX_NAME = 40;
const MAX_LINES = 50;
const MAX_LINE = 300;
const MAX_URL = 2048;
const MAX_DATA_URL = 1_500_000; // a pasted data:image URL; it lives in SillyTavern's settings file

/**
 * One line per sentence; "[3] text" = only from the 3rd time today on.
 * @param {string} text
 * @returns {{ from: number, text: string[] }[]} tiers sorted by `from`, [] when empty
 */
export function parseLines(text) {
    const byFrom = new Map();
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        let line = raw.trim();
        if (!line) continue;
        let from = 1;
        const m = line.match(/^\[\s*(\d{1,4})\s*\+?\s*\]\s*(.*)$/);
        if (m) {
            from = Math.max(1, Number(m[1]));
            line = m[2].trim();
            if (!line) continue;
        }
        if (!byFrom.has(from)) byFrom.set(from, []);
        byFrom.get(from).push(line.slice(0, MAX_LINE));
    }
    return [...byFrom.entries()].sort((a, b) => a[0] - b[0]).map(([from, lines]) => ({ from, text: lines }));
}

/** Inverse of parseLines. */
export function formatLines(tiers) {
    return (tiers ?? []).flatMap(t => t.text.map(line => (t.from > 1 ? `[${t.from}] ${line}` : line))).join('\n');
}

/** http(s), a same-server path, or an inline image. Anything else (javascript:, file: …) is refused. */
export function isSafeImageUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (/^data:/i.test(url)) return /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(url) && url.length <= MAX_DATA_URL;
    if (url.length > MAX_URL) return false;
    if (/^https?:\/\//i.test(url)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//'); // relative path on this server
}

/**
 * Check and clean a companion (from the editor or an imported file).
 * Unknown keys and unknown error ids are dropped; bad values throw with a message for the user.
 * @param {any} raw
 * @param {string[]} ruleIds error ids that may have lines
 * @returns {{ name: string, color: string, sprites: Record<string, string>, icon?: string, crop: { x: number, y: number, size: number }, lines: Record<string, { from: number, text: string[] }[]> }}
 */
export function sanitizeCompanion(raw, ruleIds) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ไม่ใช่ไฟล์คอมพาเนียน');
    if (raw.type !== undefined && raw.type !== COMPANION_TYPE) throw new Error('ไม่ใช่ไฟล์คอมพาเนียนของ Error Companion');
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
    if (!name) throw new Error('ต้องมีชื่อ');
    const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color.trim()) ? raw.color.trim().toLowerCase() : DEFAULT_COLOR;

    const sprites = {};
    const rawSprites = raw.sprites && typeof raw.sprites === 'object' ? raw.sprites : {};
    for (const mood of MOODS) {
        const url = typeof rawSprites[mood] === 'string' ? rawSprites[mood].trim() : '';
        if (!url) continue;
        if (!isSafeImageUrl(url)) throw new Error(`รูป ${mood}: ใช้ได้แค่ลิงก์ https:// หรือที่อยู่ไฟล์ในเซิร์ฟเวอร์ SillyTavern`);
        sprites[mood] = url;
    }

    const lines = {};
    const rawLines = raw.lines && typeof raw.lines === 'object' ? raw.lines : {};
    for (const id of ruleIds) {
        const value = rawLines[id];
        let tiers;
        if (typeof value === 'string') {
            tiers = parseLines(value);
        } else if (Array.isArray(value)) {
            // [{ from, text: [] }] as exported, or a plain list of sentences
            const text = value.flatMap(t => {
                if (typeof t === 'string') return [t];
                if (!t || !Array.isArray(t.text)) return [];
                const from = Number.isFinite(Number(t.from)) ? Math.max(1, Math.floor(Number(t.from))) : 1;
                return t.text.filter(x => typeof x === 'string').map(x => (from > 1 ? `[${from}] ${x}` : x));
            });
            tiers = parseLines(text.join('\n'));
        } else {
            continue;
        }
        let left = MAX_LINES;
        tiers = tiers.map(t => {
            const text = t.text.slice(0, Math.max(0, left));
            left -= text.length;
            return { from: t.from, text };
        }).filter(t => t.text.length);
        if (tiers.length) lines[id] = tiers;
    }
    let icon;
    if (typeof raw.icon === 'string' && raw.icon.trim()) {
        icon = raw.icon.trim();
        if (!isSafeImageUrl(icon)) throw new Error('รูปไอคอน: ใช้ได้แค่ลิงก์ https:// หรือที่อยู่ไฟล์ในเซิร์ฟเวอร์ SillyTavern');
    }
    const out = { name, color, sprites, lines, crop: sanitizeCrop(raw.crop) };
    if (icon) out.icon = icon;
    return out;
}

/** Any crop-ish value → a crop within range (missing parts from DEFAULT_CROP). */
export function sanitizeCrop(raw) {
    const num = (v, lo, hi, dflt) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : dflt;
    };
    const c = raw && typeof raw === 'object' ? raw : {};
    return {
        x: num(c.x, 0, 1, DEFAULT_CROP.x),
        y: num(c.y, 0, 1, DEFAULT_CROP.y),
        size: num(c.size, 0.1, 1, DEFAULT_CROP.size),
    };
}

/**
 * Where to put an image of natW × natH inside a circle of diameter d so that
 * crop.x / crop.y sits at the centre and crop.size of the image width spans the circle.
 * @returns {{ width: number, left: number, top: number }} px, for an absolutely placed <img>
 */
export function cropBox(crop, natW, natH, d) {
    const width = d / crop.size;
    const height = natW ? width * (natH / natW) : width;
    return { width, left: d / 2 - crop.x * width, top: d / 2 - crop.y * height };
}

/** What goes into a shared file. */
export function exportCompanion(companion) {
    return {
        type: COMPANION_TYPE,
        version: 1,
        name: companion.name,
        color: companion.color,
        sprites: { ...companion.sprites },
        ...(companion.icon ? { icon: companion.icon } : {}),
        crop: sanitizeCrop(companion.crop),
        lines: structuredClone(companion.lines ?? {}),
    };
}

/** Dark or light text, whichever reads better on this background colour. */
export function inkFor(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
    if (!m) return '#1e1e1e';
    const [r, g, b] = m.slice(1).map(h => {
        const c = parseInt(h, 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.18 ? '#1e1e1e' : '#ffffff';
}
