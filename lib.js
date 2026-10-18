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
 * A line for the n-th time this error was seen today, and the picture chosen for that line.
 * @param {{ from: number, text: string[], images?: string[] }[]} tiers a rule's lines, or a companion's for that rule
 * @param {number} count 1 for the first time
 * @param {() => number} [random]
 * @returns {{ text: string, img: string }} img = image id ('' = the error's own picture)
 */
export function pickEntry(tiers, count, random = Math.random) {
    const reached = tiers.filter(t => t.from <= Math.max(1, count));
    const tier = reached.length ? reached[reached.length - 1] : tiers[0];
    let i = Math.floor(random() * tier.text.length);
    if (!(i in tier.text)) i = 0;
    return { text: tier.text[i].replaceAll('{n}', String(count)), img: tier.images?.[i] ?? '' };
}

/** Just the line of pickEntry. */
export const pickLine = (tiers, count, random = Math.random) => pickEntry(tiers, count, random).text;

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
export const MAX_DATA_URL = 1_500_000; // a pasted data:image URL; it lives in SillyTavern's settings file

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

/** Names given to the six fixed image slots of version-1 companions when they are converted. */
export const MOOD_NAMES = { neutral: 'ปกติ', tired: 'ปลง', pious: 'สำรวม', exhausted: 'หมดแรง', shocked: 'ตกใจ', confused: 'งง' };
const MAX_IMAGES = 40;
const MAX_IMAGE_NAME = 30;

const badUrl = what => new Error(`${what}: ใช้ได้แค่ลิงก์ https:// หรือที่อยู่ไฟล์ในเซิร์ฟเวอร์ SillyTavern`);

/**
 * "[{from, text, images}]", a plain list of sentences, or editor text → tiers (capped,
 * one tier per `from`, sorted). `images` (the picture for each sentence, parallel to
 * `text`) goes through keepImage, which returns '' for an image that doesn't exist;
 * a tier only keeps `images` when one of its sentences has a picture of its own.
 */
function cleanTiers(value, keepImage = () => '') {
    const byFrom = new Map();
    const add = (from, text, img) => {
        text = typeof text === 'string' ? text.trim().slice(0, MAX_LINE) : '';
        if (!text) return;
        if (!byFrom.has(from)) byFrom.set(from, { from, text: [], images: [] });
        byFrom.get(from).text.push(text);
        byFrom.get(from).images.push(typeof img === 'string' && img ? keepImage(img) : '');
    };
    const addParsed = str => { for (const t of parseLines(str)) for (const x of t.text) add(t.from, x, ''); };
    if (typeof value === 'string') {
        addParsed(value);
    } else if (Array.isArray(value)) {
        for (const t of value) {
            if (typeof t === 'string') { addParsed(t); continue; }
            if (!t || !Array.isArray(t.text)) continue;
            const from = Number.isFinite(Number(t.from)) ? Math.min(9999, Math.max(1, Math.floor(Number(t.from)))) : 1;
            t.text.forEach((x, i) => add(from, x, Array.isArray(t.images) ? t.images[i] : ''));
        }
    } else {
        return [];
    }
    let left = MAX_LINES;
    return [...byFrom.values()].sort((a, b) => a.from - b.from).map(t => {
        const n = Math.min(t.text.length, Math.max(0, left));
        left -= n;
        const out = { from: t.from, text: t.text.slice(0, n) };
        const images = t.images.slice(0, n);
        if (images.some(Boolean)) out.images = images;
        return out;
    }).filter(t => t.text.length);
}

/**
 * Check and clean a companion (from the editor or an imported file).
 * Unknown keys and unknown error ids are dropped; bad values throw with a message for the user.
 *
 * Shape: any number of named images, and per error which image to show
 * (`errorImages`, missing = the first image) and its own lines (missing = Tawan's),
 * each line maybe with a picture of its own (`images` beside `text` in its tier).
 * Version-1 files had six fixed slots (`sprites: { neutral, tired, … }`); those
 * become images named after the slot, used by the errors that slot was for.
 *
 * @param {any} raw
 * @param {{ id: string, mood: string }[]} [rules] errors that may have images / lines
 * @returns {{ name: string, color: string, images: { id: string, name: string, url: string }[],
 *   errorImages: Record<string, string>, lines: Record<string, { from: number, text: string[], images?: string[] }[]>,
 *   crop: { x: number, y: number, size: number }, icon?: string }}
 */
export function sanitizeCompanion(raw, rules = [...RULES, UNKNOWN]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ไม่ใช่ไฟล์คอมพาเนียน');
    if (raw.type !== undefined && raw.type !== COMPANION_TYPE) throw new Error('ไม่ใช่ไฟล์คอมพาเนียนของ Error Companion');
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_NAME) : '';
    if (!name) throw new Error('ต้องมีชื่อ');
    const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color.trim()) ? raw.color.trim().toLowerCase() : DEFAULT_COLOR;

    const images = [];
    const errorImages = {};
    const ids = new Set();
    const renamed = new Map(); // id in the file → id kept
    const addImage = (id, imgName, url, extra = {}) => {
        if (images.length >= MAX_IMAGES) return null;
        url = typeof url === 'string' ? url.trim() : '';
        if (!url) return null;
        const label = (typeof imgName === 'string' && imgName.trim() ? imgName.trim() : `รูป ${images.length + 1}`).slice(0, MAX_IMAGE_NAME);
        if (!isSafeImageUrl(url)) throw badUrl(`รูป "${label}"`);
        let safeId = typeof id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(id) && !ids.has(id) ? id : '';
        for (let n = images.length + 1; !safeId; n++) if (!ids.has(`img${n}`)) safeId = `img${n}`;
        ids.add(safeId);
        const img = { id: safeId, name: label, url };
        if (extra.crop && typeof extra.crop === 'object') img.crop = sanitizeCrop(extra.crop);
        const place = sanitizePlace(extra.place);
        if (place) img.place = place;
        images.push(img);
        return safeId;
    };

    if (Array.isArray(raw.images)) {
        for (const img of raw.images) {
            if (!img || typeof img !== 'object') continue;
            const kept = addImage(img.id, img.name, img.url, img);
            // a repeated id in the file keeps pointing at the first image that had it
            if (kept && typeof img.id === 'string' && !renamed.has(img.id)) renamed.set(img.id, kept);
        }
        const rawPick = raw.errorImages && typeof raw.errorImages === 'object' ? raw.errorImages : {};
        for (const rule of rules) {
            const kept = renamed.get(rawPick[rule.id]);
            if (kept) errorImages[rule.id] = kept;
        }
    } else if (raw.sprites && typeof raw.sprites === 'object') {
        // version 1: six fixed slots
        for (const mood of MOODS) addImage(mood, MOOD_NAMES[mood], raw.sprites[mood]);
        for (const rule of rules) {
            if (ids.has(rule.mood)) errorImages[rule.id] = rule.mood;
        }
    }

    const lines = {};
    const rawLines = raw.lines && typeof raw.lines === 'object' ? raw.lines : {};
    for (const rule of rules) {
        const tiers = cleanTiers(rawLines[rule.id], id => renamed.get(id) ?? '');
        if (tiers.length) lines[rule.id] = tiers;
    }

    const out = { name, color, images, errorImages, lines, crop: sanitizeCrop(raw.crop) };
    if (typeof raw.icon === 'string' && raw.icon.trim()) {
        out.icon = raw.icon.trim();
        if (!isSafeImageUrl(out.icon)) throw badUrl('รูปไอคอน');
    }
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
 * Where an image stands in the full pop-up, set by the user per screen shape:
 * tall (portrait, phones) and wide (landscape, computers). Each is x = the
 * picture's centre and y = its bottom edge, as shares of the screen width and
 * height, and h = its height as a share of the screen height.
 * @returns {{ tall?: {x:number,y:number,h:number}, wide?: {x:number,y:number,h:number} } | undefined}
 */
export function sanitizePlace(raw) {
    if (!raw || typeof raw !== 'object') return undefined;
    const num = (v, lo, hi) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : null;
    };
    const out = {};
    for (const key of LAYOUTS) {
        const p = raw[key];
        if (!p || typeof p !== 'object') continue;
        const x = num(p.x, 0, 1), y = num(p.y, 0, 1.5), h = num(p.h, 0.05, 1.5);
        if (x !== null && y !== null && h !== null) out[key] = { x, y, h };
    }
    return Object.keys(out).length ? out : undefined;
}

/** Screen shapes a placement is saved for. */
export const LAYOUTS = ['tall', 'wide'];

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
        version: 2,
        name: companion.name,
        color: companion.color,
        images: (companion.images ?? []).map(({ id, name, url, crop, place }) => ({
            id, name, url,
            ...(crop ? { crop: sanitizeCrop(crop) } : {}),
            ...(sanitizePlace(place) ? { place: sanitizePlace(place) } : {}),
        })),
        errorImages: { ...companion.errorImages },
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
