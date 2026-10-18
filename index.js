/*
 * Error Companion — SillyTavern UI extension
 *
 *   • watches SillyTavern's error toasts; when one is an error the companion
 *     knows (503 overloaded, blocked content, quota, bad key, …) it pops up
 *     visual-novel style with a joke, then explains what it really means and
 *     what to try
 *   • full box or a small bubble in the corner (setting: always full, full the
 *     first time each day then small, or always small)
 *   • the more often an error shows up today, the more it has to say about it
 *   • built-in companions: Tawan, mINT and HengHeng; Seraphina and "the
 *     character in this chat" use SillyTavern's own Character Expressions
 *     sprites; users can make their own (name, colour, image URLs, lines per
 *     error) and share them as JSON files
 *
 * The original toast still shows (optionally hidden). Matching and companion
 * files live in lib.js, what the errors mean in errors.js.
 */

import { BUILTIN_COMPANIONS, CHARACTER_LINES, EXPRESSION_FOR, SERAPHINA } from './companions.js';
import { RULES, UNKNOWN } from './errors.js';
import {
    COMPANION_TYPE, DEFAULT_COLOR, DEFAULT_CROP, LAYOUTS, MAX_DATA_URL, MOODS,
    cropBox, dayKey, exportCompanion, graphemes, inkFor, isSafeImageUrl, matchRule, pickEntry, plainText,
    sanitizeCompanion, sanitizeCrop, sanitizePlace,
} from './lib.js';

const MODULE = 'error_companion';
const LOG = '[ErrorCompanion]';
const VERSION = '0.7.1'; // keep in sync with manifest.json
const BASE_URL = new URL('.', import.meta.url);

/** The first companion. His sprites ship with the extension and his lines are the rules' own. */
const TAWAN = Object.freeze({ id: 'tawan', name: 'ตะวัน', color: DEFAULT_COLOR, images: [], errorImages: {}, lines: {} });
/** Sprite URLs carry the version, so a browser drops its cached copy when a picture is redrawn. */
const builtinSprite = mood => new URL(`sprites/tawan/${mood}.webp?v=${VERSION}`, BASE_URL).href;
/** Tawan's head in each of his 586×520 sprites (centre and width), for the round icon in the small bubble. */
const TAWAN_CROP = Object.fromEntries(Object.entries({
    neutral: [278, 122], tired: [282, 115], pious: [278, 121],
    exhausted: [262, 123], shocked: [280, 119], confused: [240, 137],
}).map(([mood, [x, y]]) => [mood, { x: x / 586, y: y / 520, size: 280 / 586 }]));

/** Every companion that ships with the extension: read-only, like user-made ones plus a crop per image. */
const BUILTINS = Object.freeze([TAWAN, ...BUILTIN_COMPANIONS.map(c => Object.freeze({
    id: c.id, name: c.name, color: c.color, crop: c.crop, errorImages: c.errorImages, lines: c.lines,
    images: c.images.map(img => ({
        id: img.id, name: img.name,
        url: new URL(`sprites/${c.folder}/${img.id}.webp?v=${VERSION}`, BASE_URL).href,
        crop: { x: img.crop[0], y: img.crop[1], size: img.crop[2] },
    })),
}))]);

/**
 * Companions made from a character's Character Expressions sprites, read from
 * SillyTavern when needed: Seraphina (ST's default character, when her sprites
 * are there) and whoever this chat is with. null = not available right now.
 */
const live = { seraphina: null, char: null };
const CHAR_ID = 'char';
const CHAR_COLOR = '#7b6aa8';
const isBuiltin = comp => BUILTINS.includes(comp) || comp === live.seraphina || comp === live.char;

/** @returns {Promise<{ label: string, path: string }[]>} */
async function spritesOf(folder) {
    try {
        const res = await fetch(`/api/sprites/get?name=${encodeURIComponent(folder)}`, { cache: 'no-store' });
        const list = res.ok ? await res.json() : [];
        return Array.isArray(list) ? list.filter(x => x && typeof x.label === 'string' && typeof x.path === 'string') : [];
    } catch {
        return [];
    }
}

/** A companion whose pictures are these sprites: one image per expression, each error on its best fit. */
function fromSprites(base, sprites) {
    const images = [];
    for (const { label, path } of sprites) {
        if (!images.some(i => i.id === label)) images.push({ id: label, name: label, url: path });
    }
    images.sort((a, b) => (a.id === 'neutral' ? -1 : b.id === 'neutral' ? 1 : 0));
    const errorImages = {};
    for (const rule of ALL_RULES) {
        const pick = (EXPRESSION_FOR[rule.id] ?? []).find(label => images.some(i => i.id === label));
        if (pick) errorImages[rule.id] = pick;
    }
    return Object.freeze({ ...base, images, errorImages });
}

async function loadSeraphina() {
    const sprites = await spritesOf(SERAPHINA.folder);
    live.seraphina = sprites.length ? fromSprites({
        id: SERAPHINA.id, name: SERAPHINA.name, color: SERAPHINA.color, crop: SERAPHINA.crop, lines: SERAPHINA.lines,
    }, sprites) : null;
}

/** The sprite folder ST's Character Expressions uses for a character: an override, else the name. */
function spriteFolderOf(char) {
    const key = String(char.avatar ?? '').replace(/\.[^/.]+$/, '');
    const override = ctx().extensionSettings?.expressionOverrides?.find?.(e => e.name === key)?.path;
    return override || char.name;
}

/** Whoever this chat is with (not in group chats); without sprites, their avatar stands in. */
async function loadChatCharacter() {
    const c = ctx();
    const char = c.groupId ? null : c.characters?.[c.characterId];
    if (!char?.name) {
        live.char = null;
        return;
    }
    const thumb = typeof c.getThumbnailUrl === 'function' ? c.getThumbnailUrl('avatar', char.avatar) : '';
    const base = { id: CHAR_ID, name: char.name, color: CHAR_COLOR, lines: CHARACTER_LINES, icon: thumb || undefined };
    const sprites = await spritesOf(spriteFolderOf(char));
    if (c.characters?.[c.characterId] !== char) return; // the chat changed meanwhile
    live.char = sprites.length ? fromSprites(base, sprites)
        : Object.freeze({ ...base, errorImages: {}, images: [{ id: 'avatar', name: 'avatar', url: `/characters/${encodeURIComponent(char.avatar)}` }] });
}

const DEFAULTS = Object.freeze({
    enabled: true,
    display: 'first',   // 'full' | 'first' (full the first time each day, then small) | 'mini'
    hideToast: false,   // remove SillyTavern's own toast when the companion explains it
    typewriter: true,
    muted: {},          // rule id → true: don't show this one
    active: 'tawan',    // companion id
    companions: [],     // user-made: { id, name, color, images: [{id, name, url}], errorImages: {ruleId: imageId}, lines: {ruleId: tiers}, crop, icon? }
});

const MINI_MS = 9000;      // the small bubble hides itself after this long
const SNOOZE_MS = 10 * 60_000;
const TYPE_MS = 28;        // per character

// ---------------------------------------------------------------- helpers

const ctx = () => SillyTavern.getContext();
const $id = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ALL_RULES = [...RULES, UNKNOWN];
const RULE_IDS = ALL_RULES.map(r => r.id);
const ruleById = id => ALL_RULES.find(r => r.id === id);

function settings() {
    const all = ctx().extensionSettings;
    if (!all[MODULE]) all[MODULE] = {};
    const s = all[MODULE];
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (s[k] === undefined) s[k] = structuredClone(v);
    }
    return s;
}

const save = () => ctx().saveSettingsDebounced();

/** Toasts of our own must not wake the companion. */
let ownToast = false;
function notify(type, message) {
    ownToast = true;
    try {
        globalThis.toastr?.[type]?.(message, 'Error Companion', { timeOut: 3000 });
    } finally {
        ownToast = false;
    }
}

// ---------------------------------------------------------------- companions

function activeCompanion() {
    const s = settings();
    if (s.active === SERAPHINA.id) return live.seraphina ?? TAWAN;
    if (s.active === CHAR_ID) return live.char ?? TAWAN;
    return BUILTINS.find(c => c.id === s.active) ?? s.companions.find(c => c.id === s.active) ?? TAWAN;
}

/**
 * The picture for this error: the one picked for the line being said (lineImg), else the
 * one picked for the error, else the first image; a companion without images uses
 * Tawan's sprite for the error's mood.
 */
function imageFor(comp, rule, lineImg = '') {
    const images = comp.images ?? [];
    if (!images.length) return { url: builtinSprite(rule.mood), builtin: true };
    const img = (lineImg && images.find(i => i.id === lineImg)) || images.find(i => i.id === comp.errorImages?.[rule.id]) || images[0];
    return { url: img.url, builtin: false, crop: img.crop, place: img.place };
}

/**
 * The round icon for this error: the companion's own icon image if it has one (fills the circle),
 * else its picture with the companion's crop (built-in sprites: their own crop each).
 * @returns {{ url: string, crop: { x: number, y: number, size: number } | null }} crop null = fill
 */
function iconFor(comp, rule, lineImg = '') {
    if (comp.icon) return { url: comp.icon, crop: null };
    const img = imageFor(comp, rule, lineImg);
    return { url: img.url, crop: img.builtin ? TAWAN_CROP[rule.mood] : img.crop ?? sanitizeCrop(comp.crop) };
}

/** Show `icon` inside `circle` (a d×d box, overflow hidden, holding one <img>). */
function placeIcon(circle, icon, d) {
    const img = circle.querySelector('img');
    circle.classList.toggle('ec_icon_fill', !icon.crop);
    const place = () => {
        if (!icon.crop || !img.naturalWidth) {
            img.style.width = img.style.left = img.style.top = '';
            return;
        }
        const box = cropBox(icon.crop, img.naturalWidth, img.naturalHeight, d);
        img.style.width = `${box.width}px`;
        img.style.left = `${box.left}px`;
        img.style.top = `${box.top}px`;
    };
    img.onload = place;
    setSprite(img, icon.url);
    if (img.complete) place();
}

const linesFor = (comp, rule) => (comp.lines?.[rule.id]?.length ? comp.lines[rule.id] : rule.lines);

function applyColors(el, comp) {
    el.style.setProperty('--ec-sun', comp.color || DEFAULT_COLOR);
    el.style.setProperty('--ec-sun-ink', inkFor(comp.color || DEFAULT_COLOR));
}

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function uniqueName(name, exceptId) {
    const taken = new Set([...BUILTINS.map(c => c.name), SERAPHINA.name, ...settings().companions.filter(c => c.id !== exceptId).map(c => c.name)]);
    if (!taken.has(name)) return name;
    for (let i = 2; ; i++) {
        const candidate = `${name} (${i})`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** Companions saved by v0.2 had six fixed image slots; give them the image list + per-error choice. */
function migrateCompanions() {
    const s = settings();
    if (s.companions.every(c => Array.isArray(c.images))) return;
    s.companions = s.companions.flatMap(c => {
        if (Array.isArray(c.images)) return [c];
        try {
            return [{ id: c.id, ...sanitizeCompanion(c) }];
        } catch (e) {
            console.warn(LOG, 'dropped a companion that could not be converted', c, e);
            return [];
        }
    });
    save();
}

// ---------------------------------------------------------------- today's counts
// Kept in this browser only (a convenience, not worth syncing).

const STATS_KEY = 'error_companion_stats';

function readStats() {
    try {
        const s = JSON.parse(localStorage.getItem(STATS_KEY) ?? 'null');
        if (s?.day === dayKey() && s.counts) return s;
    } catch { /* storage blocked or junk */ }
    return { day: dayKey(), counts: {} };
}

function writeStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
}

const seenToday = id => readStats().counts[id] ?? 0;

function bump(id) {
    const s = readStats();
    s.counts[id] = (s.counts[id] ?? 0) + 1;
    writeStats(s);
    return s.counts[id];
}

// ---------------------------------------------------------------- toast hook

let snoozeUntil = 0;

function hookToastr() {
    const t = globalThis.toastr;
    if (!t || t.__errorCompanion) return;
    for (const type of ['error', 'warning', 'info']) {
        const original = t[type];
        if (typeof original !== 'function') continue;
        t[type] = function (message, title, ...rest) {
            const toast = original.call(this, message, title, ...rest);
            try {
                if (!ownToast) onToast(type, message, title, toast);
            } catch (e) {
                console.warn(LOG, e);
            }
            return toast;
        };
    }
    t.__errorCompanion = true;
}

function onToast(type, message, title, toast) {
    const s = settings();
    if (!s.enabled) return;
    const msg = plainText(message);
    const ttl = plainText(title);
    // info toasts: only OpenRouter's moderation notice ("Reasons: …")
    if (type === 'info' && !/^Reasons:/.test(ttl)) return;
    const rule = matchRule(msg, ttl, { unknown: type === 'error' });
    if (!rule || s.muted[rule.id]) return;
    const count = bump(rule.id);
    renderSettingsCounts();
    if (Date.now() < snoozeUntil) return;
    if (s.hideToast && toast) globalThis.toastr.clear(toast, { force: true });
    show(rule, { message: msg, title: ttl }, count);
}

// ---------------------------------------------------------------- showing

/** What is on screen now: { rule, raw, count, line, img, hits, comp } (img = the line's own picture) */
let current = null;

/**
 * @param {import('./errors.js').ErrorRule} rule
 * @param {{ message: string, title?: string }} raw the toast text
 * @param {number} count times seen today (1 = first)
 * @param {'full'|'mini'} [force]
 * @param {object} [comp] companion to use (default: the active one) — the editor previews unsaved ones
 * @param {{ text: string, img: string }} [entry] say this line (default: one picked at random)
 */
function show(rule, raw, count, force, comp = activeCompanion(), entry = pickEntry(linesFor(comp, rule), count)) {
    const mode = settings().display;
    const fullOpen = !!root && !root.hidden;
    if (current?.rule === rule && current.comp === comp && (fullOpen || miniOpen())) {
        // the same error again while it is still talking about it: just count it
        current.hits++;
        current.count = count;
        updateBadges();
        if (miniOpen()) armMiniTimer();
        return;
    }
    // a vague follow-up ("could not get a reply") never covers the specific error it came with
    if (rule.followup && current && current.rule !== rule && (fullOpen || miniOpen())) return;
    const line = entry.text.replaceAll('{name}', comp.name);
    current = { rule, raw, count, comp, line, img: entry.img, hits: 1 };
    const full = force ? force === 'full' : fullOpen || mode === 'full' || (mode === 'first' && count <= 1);
    if (full) openFull(); else openMini();
}

function updateBadges() {
    const text = current?.hits > 1 ? `×${current.hits}` : '';
    for (const el of document.querySelectorAll('.ec_badge')) el.textContent = text;
}

/** Point an <img> at a sprite; a custom URL that fails to load just hides the image. */
function setSprite(img, url) {
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
    img.src = url;
}

// ---------------------------------------------------------------- full box

let root = null;
let typing = null;

function buildRoot() {
    root = document.createElement('div');
    root.id = 'ec_root';
    root.hidden = true;
    root.innerHTML = `
        <div class="ec_backdrop"></div>
        <div class="ec_stage" role="dialog" aria-modal="false" aria-labelledby="ec_name">
            <img class="ec_sprite" alt="" draggable="false">
            <div class="ec_box">
                <div class="ec_nameplate"><span id="ec_name"></span><span class="ec_badge"></span></div>
                <div class="ec_close fa-solid fa-xmark" title="ปิด" role="button" tabindex="0"></div>
                <div class="ec_say" title="แตะเพื่อข้าม"><span class="ec_line"></span><span class="ec_next">▼</span></div>
                <div class="ec_detail">
                    <div class="ec_title"></div>
                    <p class="ec_what"></p>
                    <div class="ec_fix_head">ลองทำแบบนี้</div>
                    <ul class="ec_fixes"></ul>
                    <details class="ec_raw">
                        <summary>ข้อความ error ต้นฉบับ</summary>
                        <pre class="ec_raw_text"></pre>
                        <div class="menu_button ec_copy"><i class="fa-solid fa-copy"></i> คัดลอก</div>
                    </details>
                </div>
                <div class="ec_actions">
                    <div class="menu_button ec_ok"><i class="fa-solid fa-check"></i> เข้าใจแล้ว</div>
                    <div class="menu_button ec_snooze" title="ไม่เด้งเลย 10 นาที (toast เดิมยังขึ้นตามปกติ)"><i class="fa-solid fa-bell-slash"></i> พัก 10 นาที</div>
                    <div class="menu_button ec_mute" title="เปิดกลับได้ในหน้าตั้งค่า Extensions → Error Companion"><i class="fa-solid fa-eye-slash"></i> <span class="ec_long">ไม่ต้องบอก error นี้อีก</span><span class="ec_short">ไม่ต้องบอกอีก</span></div>
                </div>
            </div>
        </div>`;
    document.body.append(root);
    buildPlaceBar();
    // SillyTavern closes its open panels on a press outside them; while placing,
    // the editor panel must stay open behind the pop-up
    for (const type of ['mousedown', 'touchstart']) {
        root.addEventListener(type, e => { if (placing) e.stopPropagation(); });
    }

    root.querySelector('.ec_backdrop').addEventListener('click', () => { if (!placing) closeFull(); });
    root.querySelector('.ec_close').addEventListener('click', closeFull);
    root.querySelector('.ec_say').addEventListener('click', finishTyping);
    root.querySelector('.ec_ok').addEventListener('click', closeFull);
    root.querySelector('.ec_snooze').addEventListener('click', () => {
        const name = current?.comp?.name ?? TAWAN.name;
        snoozeUntil = Date.now() + SNOOZE_MS;
        closeFull();
        notify('info', `${name} จะเงียบไป 10 นาที`);
    });
    root.querySelector('.ec_mute').addEventListener('click', () => {
        if (!current) return;
        settings().muted[current.rule.id] = true;
        save();
        renderSettingsList();
        closeFull();
    });
    root.querySelector('.ec_copy').addEventListener('click', () => {
        const text = root.querySelector('.ec_raw_text').textContent;
        navigator.clipboard?.writeText(text).then(() => notify('success', 'คัดลอกแล้ว'), () => {});
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && root && !root.hidden) {
            e.stopPropagation();
            closeFull();
        }
    }, true);
}

function openFull() {
    if (!root) buildRoot();
    closeMini();
    const { rule, raw, line, comp } = current;
    const pic = imageFor(comp, rule, current.img);
    current.place = pic.place;
    setSprite(root.querySelector('.ec_sprite'), pic.url);
    applyColors(root, comp);
    root.dataset.mood = rule.mood;
    root.querySelector('#ec_name').textContent = comp.name;
    root.querySelector('.ec_title').textContent = rule.title;
    root.querySelector('.ec_what').textContent = rule.what;
    root.querySelector('.ec_fixes').innerHTML = rule.fixes.map(f => `<li>${esc(f)}</li>`).join('');
    root.querySelector('.ec_raw_text').textContent = [raw.title, raw.message].filter(Boolean).join('\n');
    root.querySelector('.ec_raw').open = rule === UNKNOWN;
    updateBadges();
    root.hidden = false;
    root.classList.remove('ec_in');
    void root.offsetWidth; // restart the entrance animation
    root.classList.add('ec_in');
    root.querySelector('.ec_detail').scrollTop = 0;
    placeSprite(current.place?.[layoutKey()]);
    typeLine(line);
}

/** The screen shape a placement is saved for: tall (portrait, phones) or wide. */
const layoutKey = () => (innerWidth >= innerHeight ? 'wide' : 'tall');
const LAYOUT_NAMES = { tall: 'จอแนวตั้ง (มือถือ)', wide: 'จอแนวนอน (คอม / แท็บเล็ต)' };

/**
 * Put the sprite where the user placed it for this screen shape: p.x = centre
 * and p.y = bottom edge as shares of the screen, p.h = height as a share of
 * the screen height. No placement = the default spot, standing on the box.
 */
function placeSprite(p) {
    const sprite = /** @type {HTMLElement} */ (root.querySelector('.ec_sprite'));
    root.classList.toggle('ec_placed', !!p);
    if (!p) {
        sprite.style.left = sprite.style.bottom = sprite.style.height = '';
        return;
    }
    // the sprite lives in the stage (centred, maybe narrower than the screen)
    const stage = root.querySelector('.ec_stage').getBoundingClientRect();
    sprite.style.left = `${p.x * innerWidth - stage.left}px`;
    sprite.style.bottom = `${stage.bottom - p.y * innerHeight}px`;
    sprite.style.height = `${p.h * innerHeight}px`;
}

addEventListener('resize', () => {
    if (!root || root.hidden || !current) return;
    placeSprite(placing ? placing.p : current.place?.[layoutKey()]);
});

function typeLine(text) {
    clearInterval(typing);
    const lineEl = root.querySelector('.ec_line');
    const parts = graphemes(text);
    if (!settings().typewriter || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        lineEl.textContent = text;
        root.classList.add('ec_done');
        return;
    }
    root.classList.remove('ec_done');
    lineEl.textContent = '';
    let i = 0;
    typing = setInterval(() => {
        lineEl.textContent += parts[i++] ?? '';
        if (i >= parts.length) finishTyping();
    }, TYPE_MS);
}

function finishTyping() {
    if (!root || !current) return;
    clearInterval(typing);
    typing = null;
    root.querySelector('.ec_line').textContent = current.line;
    root.classList.add('ec_done');
}

function closeFull() {
    if (!root || root.hidden) return;
    if (placing) {
        placing = null;
        root.classList.remove('ec_placing');
    }
    clearInterval(typing);
    root.hidden = true;
    current = null;
}

// ---------------------------------------------------------------- small bubble

let mini = null;
let miniTimer = null;
const miniOpen = () => !!mini && !mini.hidden;

function buildMini() {
    mini = document.createElement('div');
    mini.id = 'ec_mini';
    mini.hidden = true;
    mini.setAttribute('role', 'status');
    // #ec_mini is a see-through layer the size of the screen; the card sits in its corner (see style.css)
    mini.innerHTML = `
        <div class="ec_mini_card">
            <div class="ec_face"><img alt="" draggable="false"></div>
            <div class="ec_bubble" title="แตะเพื่อดูคำอธิบาย">
                <div class="ec_mini_name"><span class="ec_mini_who"></span> <span class="ec_badge"></span></div>
                <div class="ec_mini_line"></div>
                <div class="ec_mini_hint">แตะเพื่อดูว่าหมายถึงอะไร</div>
            </div>
            <div class="ec_mini_close fa-solid fa-xmark" title="ปิด" role="button" tabindex="0"></div>
        </div>`;
    document.body.append(mini);
    const expand = () => { if (current) { clearTimeout(miniTimer); openFull(); } };
    mini.querySelector('.ec_bubble').addEventListener('click', expand);
    mini.querySelector('.ec_face').addEventListener('click', expand);
    mini.querySelector('.ec_mini_close').addEventListener('click', () => { closeMini(); current = null; });
    const card = mini.querySelector('.ec_mini_card');
    card.addEventListener('mouseenter', () => clearTimeout(miniTimer));
    card.addEventListener('mouseleave', armMiniTimer);
}

function openMini() {
    if (!mini) buildMini();
    const { rule, line, comp } = current;
    mini.querySelector('.ec_face img').alt = comp.name;
    placeIcon(mini.querySelector('.ec_face'), iconFor(comp, rule, current.img), 64);
    applyColors(mini, comp);
    mini.querySelector('.ec_mini_who').textContent = comp.name;
    mini.querySelector('.ec_mini_line').textContent = line;
    updateBadges();
    mini.hidden = false;
    mini.classList.remove('ec_in');
    void mini.offsetWidth;
    mini.classList.add('ec_in');
    armMiniTimer();
}

function armMiniTimer() {
    clearTimeout(miniTimer);
    miniTimer = setTimeout(() => { closeMini(); if (!root || root.hidden) current = null; }, MINI_MS);
}

function closeMini() {
    clearTimeout(miniTimer);
    if (mini) mini.hidden = true;
}

// ---------------------------------------------------------------- settings panel

function renderSettings() {
    const host = $id('extensions_settings2') ?? $id('extensions_settings');
    if (!host || $id('ec_settings')) return;
    const s = settings();
    host.insertAdjacentHTML('beforeend', `
    <div id="ec_settings" class="ec_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Error Companion <small class="ec_version">v${VERSION}</small></b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="ec_enabled"> เปิดใช้งาน</label>

                <div class="ec_set_title">คอมพาเนียน</div>
                <div class="ec_comp_row">
                    <select id="ec_comp" class="text_pole"></select>
                    <div id="ec_comp_new" class="menu_button" title="สร้างคอมพาเนียนใหม่"><i class="fa-solid fa-plus"></i></div>
                    <div id="ec_comp_edit" class="menu_button" title="แก้ไข"><i class="fa-solid fa-pen"></i></div>
                    <div id="ec_comp_del" class="menu_button" title="ลบ"><i class="fa-solid fa-trash"></i></div>
                </div>
                <div class="ec_btns">
                    <div id="ec_comp_import" class="menu_button" title="นำเข้าจากไฟล์ .json"><i class="fa-solid fa-file-import"></i> นำเข้า</div>
                    <div id="ec_comp_export" class="menu_button" title="บันทึกเป็นไฟล์ .json ไว้แบ่งให้คนอื่น"><i class="fa-solid fa-file-export"></i> ส่งออก</div>
                    <div id="ec_comp_copy" class="menu_button" title="คัดลอกเป็นข้อความ JSON ไว้วางในแชท"><i class="fa-solid fa-copy"></i> คัดลอก</div>
                </div>
                <details class="ec_paste">
                    <summary>นำเข้าจากข้อความที่คัดลอกมา</summary>
                    <textarea id="ec_paste_text" class="text_pole" rows="4" placeholder='{"type": "error-companion", ...}'></textarea>
                    <div class="ec_btns"><div id="ec_paste_go" class="menu_button"><i class="fa-solid fa-file-import"></i> นำเข้า</div></div>
                </details>
                <input type="file" id="ec_comp_file" accept=".json,application/json" hidden>
                <div id="ec_editor" hidden></div>

                <div class="ec_set_title">ตอนเจอ error</div>
                <select id="ec_display" class="text_pole">
                    <option value="first">เด้งเต็มครั้งแรกของวัน ครั้งต่อไปเป็นแบบมินิ</option>
                    <option value="full">เด้งเต็มทุกครั้ง</option>
                    <option value="mini">แบบมินิทุกครั้ง</option>
                </select>
                <small class="ec_note">แบบมินิ = โผล่มุมจอพร้อมประโยคสั้น ๆ แตะเพื่อดูคำอธิบายเต็ม · นับครั้งแยกตาม error แต่ละแบบ</small>
                <label class="checkbox_label"><input type="checkbox" id="ec_hidetoast"> ซ่อนกล่อง error เดิมของ SillyTavern เมื่อคอมพาเนียนรู้จัก error นั้น</label>
                <label class="checkbox_label"><input type="checkbox" id="ec_typewriter"> ตัวอักษรขึ้นทีละตัว</label>

                <div class="ec_set_title">error ที่รู้จัก <small class="ec_note ec_inline">(ติ๊กออก = ไม่ต้องบอก · ตัวเลข = เจอวันนี้กี่ครั้ง)</small></div>
                <div id="ec_rules" class="ec_rules"></div>
                <div class="ec_btns">
                    <div id="ec_try_mini" class="menu_button"><i class="fa-solid fa-comment"></i> ลองดูแบบมินิ</div>
                    <div id="ec_reset_counts" class="menu_button"><i class="fa-solid fa-rotate-left"></i> ล้างตัวนับวันนี้</div>
                </div>
                <small class="ec_note">ลองกับ error จริงได้ด้วยคำสั่ง <code>/ec-test overloaded</code> (ชื่อ error ตามรายการ)</small>
            </div>
        </div>
    </div>`);

    const bind = (id, key) => {
        const el = /** @type {HTMLInputElement} */ ($id(id));
        el.checked = !!s[key];
        el.addEventListener('change', () => { s[key] = el.checked; save(); });
    };
    bind('ec_enabled', 'enabled');
    bind('ec_hidetoast', 'hideToast');
    bind('ec_typewriter', 'typewriter');
    const display = /** @type {HTMLSelectElement} */ ($id('ec_display'));
    display.value = s.display;
    display.addEventListener('change', () => { s.display = display.value; save(); });

    $id('ec_rules').addEventListener('change', e => {
        const box = /** @type {HTMLInputElement} */ (e.target);
        const id = box.closest('[data-rule]')?.dataset.rule;
        if (!id) return;
        if (box.checked) delete s.muted[id]; else s.muted[id] = true;
        save();
    });
    $id('ec_rules').addEventListener('click', e => {
        const id = /** @type {HTMLElement} */ (e.target).closest('.ec_try')?.closest('[data-rule]')?.dataset.rule;
        const rule = id && ruleById(id);
        if (rule) show(rule, rule.sample, Math.max(1, seenToday(rule.id)), 'full');
    });
    $id('ec_try_mini').addEventListener('click', () => {
        const rule = RULES[Math.floor(Math.random() * RULES.length)];
        closeFull();
        show(rule, rule.sample, Math.max(1, seenToday(rule.id)), 'mini');
    });
    $id('ec_reset_counts').addEventListener('click', () => {
        writeStats({ day: dayKey(), counts: {} });
        renderSettingsCounts();
    });

    bindCompanionControls();
    renderCompanionSelect();
    renderSettingsList();
}

function renderSettingsList() {
    const list = $id('ec_rules');
    if (!list) return;
    const s = settings();
    const comp = activeCompanion();
    list.innerHTML = ALL_RULES.map(r => `
        <div class="ec_rule" data-rule="${r.id}">
            <label class="checkbox_label"><input type="checkbox" ${s.muted[r.id] ? '' : 'checked'}>
                <span class="ec_rule_face"><img alt=""></span>
                <span>${esc(r.name)}</span></label>
            <span class="ec_count" title="เจอวันนี้"></span>
            <div class="menu_button ec_try" title="ลองดู"><i class="fa-solid fa-play"></i></div>
        </div>`).join('');
    for (const row of list.querySelectorAll('[data-rule]')) {
        const rule = ruleById(/** @type {HTMLElement} */ (row).dataset.rule);
        placeIcon(row.querySelector('.ec_rule_face'), iconFor(comp, rule), 26);
    }
    renderSettingsCounts();
}

function renderSettingsCounts() {
    const counts = readStats().counts;
    for (const row of document.querySelectorAll('#ec_rules [data-rule]')) {
        const n = counts[/** @type {HTMLElement} */ (row).dataset.rule] ?? 0;
        row.querySelector('.ec_count').textContent = n ? String(n) : '';
    }
}

// ---------------------------------------------------------------- companion list, import / export

function renderCompanionSelect() {
    const select = /** @type {HTMLSelectElement} */ ($id('ec_comp'));
    if (!select) return;
    const s = settings();
    const options = BUILTINS.map(c => [c.id, `${c.name} (มากับ extension)`]);
    if (live.seraphina || s.active === SERAPHINA.id) {
        options.push([SERAPHINA.id, live.seraphina ? `${SERAPHINA.name} (expression ของ ST)` : `${SERAPHINA.name} (ไม่พบ expression · ใช้ตะวันแทน)`]);
    }
    options.push([CHAR_ID, live.char ? `ตัวละครที่คุยอยู่ (ตอนนี้: ${live.char.name})` : 'ตัวละครที่คุยอยู่ (ยังไม่ได้เปิดแชต · ใช้ตะวันแทน)']);
    options.push(...s.companions.map(c => [c.id, c.name]));
    select.innerHTML = options.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
    const comp = activeCompanion();
    select.value = options.some(([id]) => id === s.active) ? s.active : comp.id;
    const builtin = isBuiltin(comp);
    $id('ec_comp_del').classList.toggle('disabled', builtin);
    $id('ec_comp_export').classList.toggle('disabled', builtin);
    $id('ec_comp_copy').classList.toggle('disabled', builtin);
    $id('ec_comp_edit').title = builtin ? `สร้างคอมพาเนียนใหม่โดยเริ่มจาก${comp.name}` : 'แก้ไข';
}

function setActive(id) {
    settings().active = id;
    save();
    renderCompanionSelect();
    renderSettingsList();
}

function bindCompanionControls() {
    $id('ec_comp').addEventListener('change', e => {
        closeEditor();
        setActive(/** @type {HTMLSelectElement} */ (e.target).value);
    });
    $id('ec_comp_new').addEventListener('click', () => openEditor(null));
    $id('ec_comp_edit').addEventListener('click', () => {
        const comp = activeCompanion();
        if (!isBuiltin(comp)) return openEditor(comp);
        // built-in companions can't be edited: start a new one from a copy
        const lines = Object.fromEntries(ALL_RULES.map(r => [r.id, structuredClone(linesFor(comp, r))]));
        const images = comp.images.map(({ id, name, url, crop }) => ({ id, name, url, crop }));
        openEditor(null, { name: `${comp.name} (สำเนา)`, color: comp.color, images, errorImages: { ...comp.errorImages }, crop: comp.crop, lines });
    });
    $id('ec_comp_del').addEventListener('click', async () => {
        const comp = activeCompanion();
        if (isBuiltin(comp)) return;
        if (!(await confirmBox(`ลบคอมพาเนียน "${comp.name}"?`))) return;
        const s = settings();
        s.companions = s.companions.filter(c => c.id !== comp.id);
        closeEditor();
        setActive(TAWAN.id);
    });

    const file = /** @type {HTMLInputElement} */ ($id('ec_comp_file'));
    $id('ec_comp_import').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        if (f.size > 4_000_000) return notify('warning', 'ไฟล์ใหญ่เกินไป');
        importCompanion(await f.text());
    });
    $id('ec_paste_go').addEventListener('click', () => {
        const box = /** @type {HTMLTextAreaElement} */ ($id('ec_paste_text'));
        if (importCompanion(box.value)) box.value = '';
    });

    $id('ec_comp_export').addEventListener('click', () => {
        const comp = activeCompanion();
        if (isBuiltin(comp)) return;
        const blob = new Blob([JSON.stringify(exportCompanion(comp), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${comp.name.replace(/[\\/:*?"<>|]+/g, '_')}.companion.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    });
    $id('ec_comp_copy').addEventListener('click', () => {
        const comp = activeCompanion();
        if (isBuiltin(comp)) return;
        navigator.clipboard?.writeText(JSON.stringify(exportCompanion(comp))).then(
            () => notify('success', `คัดลอก "${comp.name}" แล้ว · วางให้เพื่อนได้เลย`),
            () => notify('warning', 'คัดลอกไม่ได้ ลองใช้ปุ่มส่งออกแทน'));
    });
}

/** @returns {boolean} imported */
function importCompanion(text) {
    let comp;
    try {
        const data = JSON.parse(String(text ?? '').trim());
        if (data?.type !== COMPANION_TYPE) throw new Error('ไม่ใช่ไฟล์คอมพาเนียนของ Error Companion');
        comp = sanitizeCompanion(data);
    } catch (e) {
        notify('warning', `นำเข้าไม่ได้: ${e instanceof SyntaxError ? 'ข้อความ JSON ไม่ถูกต้อง' : e.message}`);
        return false;
    }
    const s = settings();
    const added = { id: newId(), ...comp, name: uniqueName(comp.name) };
    s.companions.push(added);
    closeEditor();
    setActive(added.id);
    notify('success', `นำเข้า "${added.name}" แล้ว`);
    return true;
}

async function confirmBox(text) {
    const popup = ctx().Popup;
    if (popup?.show?.confirm) return !!(await popup.show.confirm('Error Companion', esc(text)));
    return window.confirm(text);
}

// ---------------------------------------------------------------- companion editor
// Three steps, one at a time:
//   1 pictures — the companion's name and colour, then every picture with its
//     name, where it stands on screen and its round icon
//   2 lines — per error, what it says the first times and from the n-th time today on
//   3 pictures for lines — per error which picture it shows, and per line if wanted
// The form edits `draft`. Typing changes it in place; adding or removing a part redraws.

/**
 * @type {null | { id: string|null, name: string, color: string, icon: string, step: number,
 *   images: { id: string, name: string, url: string, crop: object|null, place: object|null }[],
 *   errorImages: Record<string, string>,
 *   lines: Record<string, { from: number, text: string[], images: string[] }[]>,
 *   open: Set<string>, iconOpen: string|null }}
 */
let draft = null;

const STEPS = ['รูป', 'บทพูด', 'จับคู่รูปกับบท'];

/**
 * @param {object|null} comp existing companion to edit, or null for a new one
 * @param {object} [start] starting values for a new one
 */
function openEditor(comp, start) {
    const c = comp ?? start ?? { name: '', color: DEFAULT_COLOR, images: [], errorImages: {}, lines: {} };
    const startCrop = c.crop ? sanitizeCrop(c.crop) : null; // older files: one crop for every image
    draft = {
        id: comp?.id ?? null,
        name: c.name ?? '',
        color: c.color || DEFAULT_COLOR,
        icon: c.icon ?? '',
        step: 0,
        images: (c.images ?? []).map(img => ({
            id: img.id, name: img.name ?? '', url: img.url ?? '',
            crop: img.crop ? sanitizeCrop(img.crop) : startCrop, place: sanitizePlace(img.place) ?? null,
        })),
        errorImages: { ...c.errorImages },
        lines: Object.fromEntries(RULE_IDS.map(id => [id, draftTiers(c.lines?.[id])])),
        open: new Set(),
        iconOpen: null,
    };
    const box = $id('ec_editor');
    box.onclick = onEditorClick;
    box.oninput = onEditorInput;
    box.onchange = onEditorChange;
    box.hidden = false;
    renderEditor();
    box.querySelector('#ec_ed_name')?.focus();
}

/** Saved tiers → tiers the form can edit: always a first one from 1, a picture slot per line. */
function draftTiers(tiers) {
    const out = (tiers ?? []).map(t => ({ from: t.from, text: [...t.text], images: t.text.map((_, i) => t.images?.[i] ?? '') }));
    if (out[0]?.from !== 1) out.unshift({ from: 1, text: [], images: [] });
    return out;
}

function closeEditor() {
    const box = $id('ec_editor');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    draft = null;
}

/** Lines the user wrote for an error (blank ones don't count). */
const ownLines = id => draft.lines[id].reduce((n, t) => n + t.text.filter(x => x.trim()).length, 0);
const imageName = (img, i) => img.name.trim() || `รูป ${i + 1}`;
const usableImages = () => draft.images.filter(i => i.url.trim() && isSafeImageUrl(i.url.trim()));

function renderEditor() {
    const box = $id('ec_editor');
    if (!box || !draft) return;
    const step = draft.step;
    box.innerHTML = `
        <div class="ec_editor">
            <div class="ec_set_title">${draft.id ? `แก้ไข "${esc(draft.name)}"` : 'คอมพาเนียนใหม่'}</div>
            <div class="ec_steps">${STEPS.map((title, i) => `
                <div class="ec_step${i === step ? ' ec_cur' : ''}" data-step="${i}" role="button" tabindex="0">
                    <span class="ec_step_n">${i + 1}</span><span class="ec_step_t">${title}</span>
                </div>`).join('')}
            </div>
            <div class="ec_ed_body">${[stepImagesHtml, stepLinesHtml, stepPicksHtml][step]()}</div>
            <div class="ec_ed_nav">
                ${step > 0 ? `<div class="menu_button ec_ed_go" data-step="${step - 1}"><i class="fa-solid fa-arrow-left"></i> ${STEPS[step - 1]}</div>` : '<span></span>'}
                ${step < STEPS.length - 1 ? `<div class="menu_button ec_ed_go ec_ed_next" data-step="${step + 1}">ถัดไป: ${STEPS[step + 1]} <i class="fa-solid fa-arrow-right"></i></div>` : ''}
            </div>
            <div class="ec_btns ec_ed_end">
                <div id="ec_ed_save" class="menu_button"><i class="fa-solid fa-floppy-disk"></i> บันทึก</div>
                <div id="ec_ed_try" class="menu_button"><i class="fa-solid fa-play"></i> ลองดู</div>
                <div id="ec_ed_cancel" class="menu_button"><i class="fa-solid fa-xmark"></i> ยกเลิก</div>
            </div>
        </div>`;
    if (step === 0) {
        /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_name')).value = draft.name;
        /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_color')).value = draft.color;
        /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_icon')).value = draft.icon;
        for (const card of box.querySelectorAll('.ec_ed_img')) fillImageCard(/** @type {HTMLElement} */ (card));
    }
    if (step === 1) {
        for (const det of box.querySelectorAll('.ec_ed_rule')) fillLines(/** @type {HTMLElement} */ (det));
    }
    if (step === 2) {
        for (const det of box.querySelectorAll('.ec_ed_rule')) fillPicks(/** @type {HTMLElement} */ (det));
    }
    box.style.setProperty('--ec-sun', draft.color);
}

// ---- step 1: pictures

function stepImagesHtml() {
    return `
        <div class="ec_ed_head">
            <label class="ec_field">ชื่อคอมพาเนียน <input type="text" id="ec_ed_name" class="text_pole" maxlength="40" placeholder="เช่น พี่หมอก"></label>
            <label class="ec_field ec_ed_colorfield">สีป้ายชื่อ <input type="color" id="ec_ed_color"></label>
        </div>
        <div class="ec_set_title">คลังรูป</div>
        <small class="ec_note">ใส่รูปทุกท่าที่จะใช้ แล้วตั้งชื่อให้จำง่าย (ยิ้ม, ตกใจ, ง่วง) · จะเลือกว่ารูปไหนใช้กับบทไหนในขั้นที่ 3
            · แนะนำ PNG หรือ WebP พื้นหลังโปร่งใส สูงอย่างน้อย 600 px ไม่เกิน 1.5 MB · ยังไม่มีรูป = ใช้รูปของตะวัน</small>
        <div class="ec_ed_images">${draft.images.map((img, i) => imageCardHtml(img, i)).join('')}</div>
        <div class="ec_btns">
            <label class="menu_button" title="เลือกได้หลายรูปพร้อมกัน · รูปจะติดไปกับไฟล์ที่ส่งออกด้วย"><i class="fa-solid fa-folder-open"></i> เพิ่มรูปจากเครื่อง
                <input type="file" id="ec_ed_addfiles" accept="image/*" multiple hidden></label>
            <div id="ec_ed_addurl" class="menu_button" title="รูปที่ฝากไว้บนเว็บ เปิดได้จากทุกเครื่อง"><i class="fa-solid fa-link"></i> เพิ่มจากลิงก์</div>
        </div>
        <details class="ec_ed_more">
            <summary>รูปไอคอนแยก (ไม่บังคับ)</summary>
            <small class="ec_note">ปกติไอคอนวงกลมตอนเด้งแบบมินิจะครอปจากรูปในคลัง ถ้ามีรูปหน้าตรง ๆ แยกไว้ ใส่ลิงก์ที่นี่ได้ (ใช้รูปนี้กับทุก error)</small>
            <input type="url" id="ec_ed_icon" class="text_pole" placeholder="https://…" autocomplete="off" spellcheck="false">
        </details>`;
}

function imageCardHtml(img, i) {
    const local = img.url.startsWith('data:');
    const placed = LAYOUTS.filter(k => img.place?.[k]).map(k => LAYOUT_SHORT[k]);
    const iconOpen = draft.iconOpen === img.id;
    return `
        <div class="ec_ed_img" data-img="${esc(img.id)}">
            <img class="ec_ed_thumb" alt="">
            <div class="ec_ed_img_fields">
                <div class="ec_ed_imgtop">
                    <input type="text" class="text_pole ec_ed_imgname" maxlength="30" placeholder="ชื่อรูป เช่น ยิ้ม, ตกใจ">
                    ${i > 0 ? '<div class="menu_button ec_ed_up" title="เลื่อนขึ้น (รูปแรกคือรูปเริ่มต้นของทุก error)"><i class="fa-solid fa-arrow-up"></i></div>' : ''}
                    <div class="menu_button ec_ed_delimg" title="ลบรูปนี้"><i class="fa-solid fa-trash"></i></div>
                </div>
                ${i === 0 ? '<small class="ec_ed_tag">รูปเริ่มต้น · error ที่ยังไม่ได้เลือกรูปจะใช้รูปนี้</small>' : ''}
                <div class="ec_ed_urlrow">
                    ${local ? `<span class="ec_ed_local"><i class="fa-solid fa-image"></i> รูปจากเครื่อง · ${Math.round(img.url.length * 0.75 / 1024)} KB</span>`
                        : '<input type="url" class="text_pole ec_ed_url" placeholder="https://… หรือกด 📁" autocomplete="off" spellcheck="false">'}
                    <label class="menu_button ec_ed_pickfile" title="${local ? 'เปลี่ยนรูป' : 'เลือกรูปจากเครื่อง'}"><i class="fa-solid fa-folder-open"></i><input type="file" accept="image/*" hidden></label>
                </div>
                <div class="ec_ed_row">
                    <div class="menu_button ec_ed_place" title="ลากรูปไปวางและปรับขนาดบนจอจริง"><i class="fa-solid fa-up-down-left-right"></i> ตำแหน่งบนจอ</div>
                    <small class="ec_ed_status">${placed.length ? `✓ ${placed.join(' · ')}` : 'ยืนบนกล่องข้อความ (ค่าเดิม)'}</small>
                </div>
                <div class="ec_ed_row">
                    <span class="ec_ed_face ec_ed_face_sm"><img alt=""></span>
                    <div class="menu_button ec_ed_iconbtn${iconOpen ? ' ec_on' : ''}" title="ส่วนของรูปที่โชว์ในวงกลมตอนเด้งแบบมินิ"><i class="fa-solid fa-crop-simple"></i> ไอคอนมินิ</div>
                </div>
                ${iconOpen ? `
                <div class="ec_ed_sliders">
                    <label><span>ซ้าย/ขวา</span><input type="range" data-crop="x" min="0" max="100" step="1"></label>
                    <label><span>ขึ้น/ลง</span><input type="range" data-crop="y" min="0" max="100" step="1"></label>
                    <label><span>ซูม</span><input type="range" data-crop="z" min="0" max="90" step="1"></label>
                    <div class="menu_button ec_ed_crop_reset" title="ตำแหน่งเริ่มต้น"><i class="fa-solid fa-rotate-left"></i></div>
                    <div class="menu_button ec_ed_crop_all" title="ใช้ตำแหน่งนี้กับทุกรูป"><i class="fa-solid fa-clone"></i> ใช้กับทุกรูป</div>
                </div>` : ''}
            </div>
        </div>`;
}

/** Values, thumbnail and round icon of one picture's card (kept out of the HTML so nothing needs escaping twice). */
function fillImageCard(card) {
    const img = draft.images.find(i => i.id === card.dataset.img);
    if (!img) return;
    /** @type {HTMLInputElement} */ (card.querySelector('.ec_ed_imgname')).value = img.name;
    const urlInput = /** @type {HTMLInputElement} */ (card.querySelector('.ec_ed_url'));
    if (urlInput && document.activeElement !== urlInput) urlInput.value = img.url;
    const url = img.url.trim();
    const ok = !url || isSafeImageUrl(url);
    urlInput?.classList.toggle('ec_bad', !ok);
    const thumb = /** @type {HTMLImageElement} */ (card.querySelector('.ec_ed_thumb'));
    setSprite(thumb, url && ok ? url : builtinSprite('neutral'));
    thumb.classList.toggle('ec_placeholder', !(url && ok));
    const crop = img.crop ?? DEFAULT_CROP;
    placeIcon(card.querySelector('.ec_ed_face'), url && ok ? { url, crop } : iconFor(TAWAN, UNKNOWN), 28);
    const set = (k, v) => {
        const el = /** @type {HTMLInputElement} */ (card.querySelector(`[data-crop="${k}"]`));
        if (el) el.value = String(Math.round(v * 100));
    };
    set('x', crop.x);
    set('y', crop.y);
    set('z', 1 - crop.size);
}

const newImageId = () => {
    const taken = new Set(draft.images.map(i => i.id));
    for (let n = draft.images.length + 1; ; n++) if (!taken.has(`img${n}`)) return `img${n}`;
};

async function addImageFiles(files) {
    let bad = 0;
    for (const file of files) {
        const url = await imageFileToDataUrl(file);
        if (!draft) return;
        if (!url) { bad++; continue; }
        const last = draft.images[draft.images.length - 1];
        draft.images.push({ id: newImageId(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 30), url, crop: last?.crop ?? null, place: null });
    }
    if (bad) notify('warning', 'เปิดบางรูปไม่ได้ ลองไฟล์ PNG, JPG หรือ WebP');
    renderEditor();
}

function removeImage(id) {
    draft.images = draft.images.filter(i => i.id !== id);
    for (const [rule, pick] of Object.entries(draft.errorImages)) if (pick === id) delete draft.errorImages[rule];
    for (const tiers of Object.values(draft.lines)) {
        for (const t of tiers) t.images = t.images.map(x => (x === id ? '' : x));
    }
    if (draft.iconOpen === id) draft.iconOpen = null;
}

// ---- step 2: lines

function stepLinesHtml() {
    return `
        <small class="ec_note">เขียนบทให้ error ที่อยากให้พูดเอง · <b>ช่องละ 1 ประโยค</b> ตอนเจอ error ระบบจะสุ่มมา 1 ประโยค
            · ชุด "ตั้งแต่ครั้งที่…" ใช้แทนชุดแรกเมื่อเจอ error เดิมซ้ำในวันเดียวกัน
            · <code>{n}</code> = เจอกี่ครั้งแล้ว · <code>{name}</code> = ชื่อคอมพาเนียน
            · error ที่ไม่ได้เขียน ใช้บทของตะวัน · คำอธิบายใต้บทพูดใช้ของกลางเหมือนกันทุกตัว</small>
        ${ALL_RULES.map(r => `
        <details class="ec_ed_rule" data-rule="${r.id}"${draft.open.has(r.id) ? ' open' : ''}>
            <summary><span class="ec_ed_rulename">${esc(r.name)} <small class="ec_ed_mark"></small></span></summary>
            <div class="ec_ed_rulebody"></div>
        </details>`).join('')}`;
}

function fillLines(det) {
    const id = det.dataset.rule;
    const rule = ruleById(id);
    const tiers = draft.lines[id];
    const n = ownLines(id);
    det.querySelector('.ec_ed_mark').textContent = n ? `· ${n} ประโยค` : '· ใช้บทของตะวัน';
    det.querySelector('.ec_ed_rulebody').innerHTML = tiers.map((t, ti) => `
        <div class="ec_ed_tier" data-tier="${ti}">
            <div class="ec_ed_tierhead">${ti === 0
                ? '<b>ครั้งแรก ๆ ของวัน</b>'
                : `<b>ตั้งแต่ครั้งที่</b> <input type="number" class="text_pole ec_ed_from" min="2" max="999"> <b>ของวัน</b>
                   <div class="menu_button ec_ed_deltier" title="ลบชุดนี้"><i class="fa-solid fa-trash"></i></div>`}
                <small>สุ่ม 1 ประโยค</small>
            </div>
            ${t.text.map((_, li) => `
            <div class="ec_ed_line" data-line="${li}">
                <input type="text" class="text_pole ec_ed_linetext" maxlength="300">
                <div class="menu_button ec_ed_delline" title="ลบประโยคนี้"><i class="fa-solid fa-xmark"></i></div>
            </div>`).join('')}
            <div class="menu_button ec_ed_addline"><i class="fa-solid fa-plus"></i> ประโยค</div>
        </div>`).join('') + `
        <div class="ec_btns">
            <div class="menu_button ec_ed_addtier" title="บทที่ใช้เมื่อเจอ error นี้ซ้ำหลายครั้งในวันเดียวกัน"><i class="fa-solid fa-layer-group"></i> เพิ่มชุดตอนเจอซ้ำ</div>
            ${n ? '' : '<div class="menu_button ec_ed_copytawan" title="เอาบทของตะวันมาแก้ต่อ"><i class="fa-solid fa-copy"></i> เริ่มจากบทของตะวัน</div>'}
        </div>`;
    for (const tierEl of det.querySelectorAll('.ec_ed_tier')) {
        const t = tiers[Number(/** @type {HTMLElement} */ (tierEl).dataset.tier)];
        const from = /** @type {HTMLInputElement} */ (tierEl.querySelector('.ec_ed_from'));
        if (from) from.value = String(t.from);
        tierEl.querySelectorAll('.ec_ed_linetext').forEach((input, li) => {
            /** @type {HTMLInputElement} */ (input).value = t.text[li];
            /** @type {HTMLInputElement} */ (input).placeholder = li === 0 && t.from === 1 ? `เช่น ${rule.lines[0].text[0]}` : 'พิมพ์ประโยค…';
        });
    }
}

/** Sort an error's tiers by when they start; two with the same start become one. */
function tidyTiers(id) {
    const tiers = draft.lines[id];
    const merged = [];
    for (const t of [...tiers].sort((a, b) => a.from - b.from)) {
        const same = merged.find(m => m.from === t.from);
        if (same) { same.text.push(...t.text); same.images.push(...t.images); } else merged.push(t);
    }
    draft.lines[id] = merged;
}

// ---- step 3: which picture for which error and line

function stepPicksHtml() {
    const images = usableImages();
    return `
        <small class="ec_note">${images.length
            ? 'เลือก <b>รูปหลัก</b> ของแต่ละ error · ถ้าอยากให้บางประโยคใช้รูปอื่น เลือกทีละประโยคได้ · กด ▶ เพื่อดูของจริง'
            : 'ยังไม่มีรูปในคลัง ทุก error ใช้รูปของตะวันไปก่อน · กลับไปเพิ่มรูปที่ขั้นที่ 1'}</small>
        ${ALL_RULES.map(r => `
        <details class="ec_ed_rule" data-rule="${r.id}"${draft.open.has(r.id) ? ' open' : ''}>
            <summary><span class="ec_ed_face ec_ed_face_sm"><img alt=""></span><span class="ec_ed_rulename">${esc(r.name)} <small class="ec_ed_mark"></small></span></summary>
            <div class="ec_ed_rulebody"></div>
        </details>`).join('')}`;
}

function fillPicks(det) {
    const id = det.dataset.rule;
    const rule = ruleById(id);
    const images = usableImages();
    const preview = draftPreview();
    const main = images.find(i => i.id === draft.errorImages[id]) ?? images[0];
    const face = /** @type {HTMLElement} */ (det.querySelector('summary .ec_ed_face'));
    face.style.borderColor = draft.color;
    placeIcon(face, iconFor(preview, rule), 28);
    const lines = [];
    draft.lines[id].forEach((t, ti) => t.text.forEach((text, li) => { if (text.trim()) lines.push({ t, ti, li, text }); }));
    const own = lines.filter(l => l.t.images[l.li] && images.some(i => i.id === l.t.images[l.li])).length;
    det.querySelector('.ec_ed_mark').textContent = images.length
        ? `· ${imageName(main, draft.images.indexOf(main))}${own ? ` · อีก ${own} ประโยคใช้รูปของตัวเอง` : ''}` : '';
    const body = det.querySelector('.ec_ed_rulebody');
    if (!images.length) {
        body.innerHTML = `<div class="ec_btns"><div class="menu_button ec_ed_tryrule"><i class="fa-solid fa-play"></i> ลองดู error นี้</div></div>`;
        return;
    }
    const tierName = t => (t.from === 1 ? 'ครั้งแรก ๆ' : `ครั้งที่ ${t.from}+`);
    body.innerHTML = `
        <div class="ec_ed_subhead">รูปหลักของ error นี้</div>
        <div class="ec_ed_strip">${images.map(img => `
            <div class="ec_ed_pick${img === main ? ' ec_sel' : ''}" data-pick="${esc(img.id)}" role="button" tabindex="0" title="${esc(imageName(img, draft.images.indexOf(img)))}">
                <img alt=""><span>${esc(imageName(img, draft.images.indexOf(img)))}</span>
            </div>`).join('')}
        </div>
        <div class="ec_ed_subhead">รูปของแต่ละประโยค <small class="ec_note ec_inline">(ไม่บังคับ)</small></div>
        ${lines.length ? lines.map(({ t, ti, li }) => `
        <div class="ec_ed_lp" data-tier="${ti}" data-line="${li}">
            <img class="ec_ed_lp_thumb" alt="">
            <div class="ec_ed_lp_main">
                <div class="ec_ed_lp_text"><small class="ec_ed_lp_tier">${tierName(t)}</small> <span></span></div>
                <select class="text_pole ec_ed_lp_pick">
                    <option value="">ใช้รูปหลัก</option>
                    ${images.map(img => `<option value="${esc(img.id)}">${esc(imageName(img, draft.images.indexOf(img)))}</option>`).join('')}
                </select>
            </div>
            <div class="menu_button ec_ed_tryline" title="ดูประโยคนี้กับรูปนี้"><i class="fa-solid fa-play"></i></div>
        </div>`).join('')
        : '<small class="ec_note">error นี้ยังใช้บทของตะวัน · เขียนบทเองในขั้นที่ 2 ก่อน แล้วค่อยเลือกรูปทีละประโยค</small>'}
        <div class="ec_btns"><div class="menu_button ec_ed_tryrule"><i class="fa-solid fa-play"></i> ลองดู error นี้ (สุ่มประโยค)</div></div>`;
    body.querySelectorAll('.ec_ed_pick').forEach(el => {
        setSprite(el.querySelector('img'), images.find(i => i.id === /** @type {HTMLElement} */ (el).dataset.pick).url);
    });
    for (const row of body.querySelectorAll('.ec_ed_lp')) {
        const t = draft.lines[id][Number(/** @type {HTMLElement} */ (row).dataset.tier)];
        const li = Number(/** @type {HTMLElement} */ (row).dataset.line);
        row.querySelector('.ec_ed_lp_text span').textContent = t.text[li];
        const pick = images.some(i => i.id === t.images[li]) ? t.images[li] : '';
        /** @type {HTMLSelectElement} */ (row.querySelector('select')).value = pick;
        setSprite(row.querySelector('.ec_ed_lp_thumb'), (images.find(i => i.id === pick) ?? main).url);
    }
}

// ---- events

function onEditorClick(e) {
    const t = /** @type {HTMLElement} */ (e.target);
    if (!draft) return;
    const box = $id('ec_editor');
    const go = t.closest('.ec_step, .ec_ed_go');
    if (go) {
        draft.step = Number(/** @type {HTMLElement} */ (go).dataset.step);
        renderEditor();
        box.querySelector('.ec_steps').scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
    }
    if (t.closest('#ec_ed_save')) return saveEditor();
    if (t.closest('#ec_ed_cancel')) return closeEditor();
    if (t.closest('#ec_ed_try')) {
        const comp = readEditor();
        if (!comp) return;
        const touched = ALL_RULES.filter(r => comp.lines[r.id] || comp.errorImages[r.id]);
        const pool = touched.length ? touched : RULES;
        return tryDraft(pool[Math.floor(Math.random() * pool.length)]);
    }
    if (t.closest('#ec_ed_addurl')) {
        const last = draft.images[draft.images.length - 1];
        draft.images.push({ id: newImageId(), name: '', url: '', crop: last?.crop ?? null, place: null });
        renderEditor();
        /** @type {HTMLInputElement} */ ([...box.querySelectorAll('.ec_ed_url')].pop())?.focus();
        return;
    }

    // a picture's card
    const card = /** @type {HTMLElement} */ (t.closest('.ec_ed_img'));
    const img = card && draft.images.find(i => i.id === card.dataset.img);
    if (img) {
        const i = draft.images.indexOf(img);
        if (t.closest('.ec_ed_delimg')) { removeImage(img.id); return renderEditor(); }
        if (t.closest('.ec_ed_up')) {
            [draft.images[i - 1], draft.images[i]] = [draft.images[i], draft.images[i - 1]];
            return renderEditor();
        }
        if (t.closest('.ec_ed_place')) return startPlacing(img);
        if (t.closest('.ec_ed_iconbtn')) {
            draft.iconOpen = draft.iconOpen === img.id ? null : img.id;
            return renderEditor();
        }
        if (t.closest('.ec_ed_crop_reset')) { img.crop = { ...DEFAULT_CROP }; return fillImageCard(card); }
        if (t.closest('.ec_ed_crop_all')) {
            for (const other of draft.images) other.crop = { ...(img.crop ?? DEFAULT_CROP) };
            for (const c of box.querySelectorAll('.ec_ed_img')) fillImageCard(/** @type {HTMLElement} */ (c));
            return;
        }
        return;
    }

    // an error, in step 2 or 3
    const det = /** @type {HTMLElement} */ (t.closest('.ec_ed_rule'));
    if (!det || t.closest('summary')) return;
    const id = det.dataset.rule;
    const rule = ruleById(id);
    const tiers = draft.lines[id];
    const tierEl = /** @type {HTMLElement} */ (t.closest('.ec_ed_tier, .ec_ed_lp'));
    const tier = tierEl ? tiers[Number(tierEl.dataset.tier)] : null;
    const lineIdx = Number((/** @type {HTMLElement} */ (t.closest('[data-line]')))?.dataset.line);
    const refill = focus => {
        fillLines(det);
        if (focus) /** @type {HTMLInputElement} */ (det.querySelector(focus))?.focus();
    };
    if (t.closest('.ec_ed_addline')) {
        tier.text.push('');
        tier.images.push('');
        return refill(`.ec_ed_tier[data-tier="${tierEl.dataset.tier}"] [data-line="${tier.text.length - 1}"] .ec_ed_linetext`);
    }
    if (t.closest('.ec_ed_delline')) {
        tier.text.splice(lineIdx, 1);
        tier.images.splice(lineIdx, 1);
        return refill();
    }
    if (t.closest('.ec_ed_deltier')) {
        tiers.splice(Number(tierEl.dataset.tier), 1);
        return refill();
    }
    if (t.closest('.ec_ed_addtier')) {
        const from = Math.max(2, tiers[tiers.length - 1].from + 2);
        tiers.push({ from, text: [''], images: [''] });
        return refill(`.ec_ed_tier[data-tier="${tiers.length - 1}"] .ec_ed_linetext`);
    }
    if (t.closest('.ec_ed_copytawan')) {
        draft.lines[id] = draftTiers(rule.lines);
        return refill();
    }
    const pick = /** @type {HTMLElement} */ (t.closest('.ec_ed_pick'));
    if (pick) {
        draft.errorImages[id] = pick.dataset.pick;
        return fillPicks(det);
    }
    if (t.closest('.ec_ed_tryline')) {
        const text = tier.text[lineIdx].replaceAll('{n}', String(tier.from));
        return tryDraft(rule, tier.from, { text, img: tier.images[lineIdx] });
    }
    if (t.closest('.ec_ed_tryrule')) return tryDraft(rule);
}

function onEditorInput(e) {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (!draft) return;
    if (t.id === 'ec_ed_name') draft.name = t.value;
    if (t.id === 'ec_ed_color') {
        draft.color = t.value;
        $id('ec_editor').style.setProperty('--ec-sun', t.value);
    }
    if (t.id === 'ec_ed_icon') {
        draft.icon = t.value;
        t.classList.toggle('ec_bad', !!t.value.trim() && !isSafeImageUrl(t.value.trim()));
    }
    const card = /** @type {HTMLElement} */ (t.closest('.ec_ed_img'));
    const img = card && draft.images.find(i => i.id === card.dataset.img);
    if (img) {
        if (t.classList.contains('ec_ed_imgname')) img.name = t.value;
        if (t.classList.contains('ec_ed_url')) img.url = t.value.trim();
        if (t.dataset.crop) {
            const val = k => Number(/** @type {HTMLInputElement} */ (card.querySelector(`[data-crop="${k}"]`)).value) / 100;
            img.crop = sanitizeCrop({ x: val('x'), y: val('y'), size: 1 - val('z') });
        }
        if (t.type !== 'file' && !t.classList.contains('ec_ed_imgname')) fillImageCard(card);
        return;
    }
    const det = /** @type {HTMLElement} */ (t.closest('.ec_ed_rule'));
    if (!det) return;
    const id = det.dataset.rule;
    const tierEl = /** @type {HTMLElement} */ (t.closest('.ec_ed_tier, .ec_ed_lp'));
    const tier = tierEl ? draft.lines[id][Number(tierEl.dataset.tier)] : null;
    const li = Number((/** @type {HTMLElement} */ (t.closest('[data-line]')))?.dataset.line);
    if (t.classList.contains('ec_ed_linetext')) {
        tier.text[li] = t.value;
        const n = ownLines(id);
        det.querySelector('.ec_ed_mark').textContent = n ? `· ${n} ประโยค` : '· ใช้บทของตะวัน';
    }
    if (t.classList.contains('ec_ed_lp_pick')) {
        tier.images[li] = t.value;
        fillPicks(det);
    }
}

function onEditorChange(e) {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (!draft) return;
    if (t.type === 'file') {
        const files = [...(t.files ?? [])];
        t.value = ''; // so picking the same file again still fires
        if (!files.length) return;
        if (t.id === 'ec_ed_addfiles') return addImageFiles(files);
        const card = /** @type {HTMLElement} */ (t.closest('.ec_ed_img'));
        const img = card && draft.images.find(i => i.id === card.dataset.img);
        if (!img) return;
        imageFileToDataUrl(files[0]).then(url => {
            if (!url) return notify('warning', 'เปิดรูปนี้ไม่ได้ ลองไฟล์ PNG, JPG หรือ WebP');
            img.url = url;
            if (!img.name.trim()) img.name = files[0].name.replace(/\.[^.]+$/, '').slice(0, 30);
            renderEditor();
        });
        return;
    }
    if (t.classList.contains('ec_ed_from')) {
        const det = /** @type {HTMLElement} */ (t.closest('.ec_ed_rule'));
        const id = det.dataset.rule;
        const tier = draft.lines[id][Number(/** @type {HTMLElement} */ (t.closest('.ec_ed_tier')).dataset.tier)];
        tier.from = Math.min(999, Math.max(2, Math.floor(Number(t.value)) || 2));
        tidyTiers(id);
        fillLines(det);
    }
}

/** Remember which errors are open, so redrawing a step keeps them open. */
document.addEventListener('toggle', e => {
    const det = /** @type {HTMLElement} */ (e.target);
    if (!draft || !det.classList?.contains('ec_ed_rule')) return;
    if (/** @type {HTMLDetailsElement} */ (det).open) draft.open.add(det.dataset.rule); else draft.open.delete(det.dataset.rule);
}, true);

/** The draft as a companion to preview, leniently: pictures without a usable link are left out. */
function draftPreview() {
    const images = usableImages().map(i => ({ id: i.id, name: i.name, url: i.url.trim(), crop: i.crop ?? undefined, place: i.place ?? undefined }));
    const icon = draft.icon.trim() && isSafeImageUrl(draft.icon.trim()) ? draft.icon.trim() : '';
    return { id: 'preview', name: draft.name.trim() || 'ตัวอย่าง', color: draft.color, images, errorImages: { ...draft.errorImages }, icon, crop: images[0]?.crop ?? DEFAULT_CROP, lines: {} };
}

/** Pop up an error with the companion as it is in the form; `entry` = this line and picture. */
function tryDraft(rule, count = 1, entry) {
    const comp = readEditor();
    if (!comp) return;
    closeFull();
    show(rule, rule.sample, count, 'full', { id: 'preview', ...comp }, entry);
}

// ---------------------------------------------------------------- placing an image on the screen

const LAYOUT_SHORT = { tall: 'จอแนวตั้ง', wide: 'จอแนวนอน' };

/** While the user drags a picture around the real pop-up: { img, layout, p, drag } */
let placing = null;

/** @param {{ id: string, url: string, place: object|null }} img a picture in the editor's draft */
async function startPlacing(img) {
    const shown = draftPreview().images.find(i => i.id === img.id);
    if (!shown) return notify('warning', 'ใส่รูปก่อน แล้วค่อยจัดตำแหน่ง');
    const layout = layoutKey();
    const comp = { ...draftPreview(), images: [{ ...shown, place: undefined }], errorImages: {} };
    const rule = ruleById('overloaded');
    closeFull();
    closeMini();
    current = { rule, raw: rule.sample, count: 1, comp, hits: 1, img: '', line: 'ลากรูปไปวางตรงไหนก็ได้ แล้วปรับขนาดด้วยแถบด้านบน' };
    openFull();
    placing = { img, layout, p: img.place?.[layout] ? { ...img.place[layout] } : null, drag: null };
    root.classList.add('ec_placing');
    root.querySelector('.ec_placebar_layout').textContent = LAYOUT_NAMES[layout];
    const sprite = /** @type {HTMLImageElement} */ (root.querySelector('.ec_sprite'));
    try { await sprite.decode(); } catch { /* shown broken; still placeable */ }
    await new Promise(r => setTimeout(r, 450)); // let the entrance hop finish before measuring
    if (!placing) return;
    if (!placing.p) {
        // start from where it stands now
        const r = sprite.getBoundingClientRect();
        placing.p = { x: (r.left + r.width / 2) / innerWidth, y: r.bottom / innerHeight, h: r.height / innerHeight };
    }
    placeSprite(placing.p);
    syncPlaceBar();
}

function syncPlaceBar() {
    if (!placing?.p) return;
    /** @type {HTMLInputElement} */ (root.querySelector('.ec_place_size')).value = String(Math.round(placing.p.h * 100));
}

/** Keep the result on the picture; false = back to the default spot for this screen shape. */
function endPlacing(keep) {
    if (!placing) return;
    const { img, layout, p } = placing;
    if (keep !== undefined) {
        const saved = { ...img.place };
        if (keep && p) saved[layout] = sanitizePlace({ [layout]: p })?.[layout];
        else delete saved[layout];
        img.place = sanitizePlace(saved) ?? null;
    }
    closeFull();
    if (draft?.images.includes(img)) renderEditor();
}

function buildPlaceBar() {
    const bar = document.createElement('div');
    bar.className = 'ec_placebar';
    bar.innerHTML = `
        <div class="ec_placebar_title">จัดตำแหน่ง · <span class="ec_placebar_layout"></span></div>
        <small>ลากรูปเพื่อย้าย · บันทึกแยกสำหรับจอแนวนี้ (จอแนวตั้งกับแนวนอนตั้งไม่เหมือนกันได้)</small>
        <label class="ec_place_sizerow">ขนาด <input type="range" class="ec_place_size" min="5" max="150" step="1"></label>
        <div class="ec_btns">
            <div class="menu_button ec_place_save"><i class="fa-solid fa-check"></i> บันทึก</div>
            <div class="menu_button ec_place_clear" title="กลับไปยืนบนกล่องข้อความ"><i class="fa-solid fa-rotate-left"></i> ค่าเดิม</div>
            <div class="menu_button ec_place_cancel"><i class="fa-solid fa-xmark"></i> ยกเลิก</div>
        </div>`;
    root.append(bar);
    bar.querySelector('.ec_place_size').addEventListener('input', e => {
        if (!placing?.p) return;
        placing.p.h = Number(/** @type {HTMLInputElement} */ (e.target).value) / 100;
        placeSprite(placing.p);
    });
    bar.querySelector('.ec_place_save').addEventListener('click', () => endPlacing(true));
    bar.querySelector('.ec_place_clear').addEventListener('click', () => endPlacing(false));
    bar.querySelector('.ec_place_cancel').addEventListener('click', () => endPlacing());

    const sprite = /** @type {HTMLElement} */ (root.querySelector('.ec_sprite'));
    sprite.addEventListener('pointerdown', e => {
        if (!placing?.p) return;
        e.preventDefault();
        sprite.setPointerCapture(e.pointerId);
        placing.drag = { x: e.clientX, y: e.clientY, from: { ...placing.p } };
    });
    sprite.addEventListener('pointermove', e => {
        const d = placing?.drag;
        if (!d) return;
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        placing.p.x = clamp(d.from.x + (e.clientX - d.x) / innerWidth, 0, 1);
        placing.p.y = clamp(d.from.y + (e.clientY - d.y) / innerHeight, 0, 1.5);
        placeSprite(placing.p);
    });
    const drop = () => { if (placing) placing.drag = null; };
    sprite.addEventListener('pointerup', drop);
    sprite.addEventListener('pointercancel', drop);
    sprite.addEventListener('wheel', e => {
        if (!placing?.p) return;
        e.preventDefault();
        placing.p.h = Math.min(1.5, Math.max(0.05, placing.p.h * (e.deltaY < 0 ? 1.05 : 1 / 1.05)));
        placeSprite(placing.p);
        syncPlaceBar();
    }, { passive: false });
}

/**
 * A picture from the user's device as a data:image URL that travels inside the
 * companion (settings and exported file): at most 1000 px each way, WebP when the
 * browser can make it, made smaller until it fits the size limit.
 * @returns {Promise<string>} '' if it can't be read
 */
async function imageFileToDataUrl(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return '';
    }
    let scale = Math.min(1, 1000 / bitmap.height, 1000 / bitmap.width);
    for (let tries = 0; tries < 6; tries++, scale *= 0.8) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL('image/webp', 0.9); // browsers without WebP give PNG
        if (url.length <= MAX_DATA_URL && isSafeImageUrl(url)) return url;
    }
    return '';
}

/** Form → checked companion (without id), or null after telling the user what's wrong. */
function readEditor() {
    if (!draft) return null;
    const raw = {
        name: draft.name,
        color: draft.color,
        icon: draft.icon,
        images: draft.images.map(({ id, name, url, crop, place }) => ({ id, name, url, crop, place })),
        errorImages: draft.errorImages,
        crop: draft.images[0]?.crop ?? DEFAULT_CROP, // what older versions use for every image
        lines: draft.lines,
    };
    try {
        return sanitizeCompanion(raw);
    } catch (e) {
        notify('warning', e.message);
        if (!draft.name.trim() && draft.step !== 0) {
            draft.step = 0;
            renderEditor();
        }
        return null;
    }
}

function saveEditor() {
    const comp = readEditor();
    if (!comp) return;
    const s = settings();
    const id = draft.id ?? newId();
    const saved = { id, ...comp, name: uniqueName(comp.name, id) };
    const i = s.companions.findIndex(c => c.id === id);
    if (i >= 0) s.companions[i] = saved; else s.companions.push(saved);
    closeEditor();
    setActive(id);
    notify('success', `บันทึก "${saved.name}" แล้ว`);
}

// ---------------------------------------------------------------- slash command

function registerCommand() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'ec-test',
        callback: (_args, value) => {
            const id = String(value ?? '').trim();
            const rule = id ? ruleById(id) : RULES[Math.floor(Math.random() * RULES.length)];
            if (!rule) {
                notify('warning', `ไม่รู้จัก "${id}" · มี: ${RULE_IDS.join(', ')}`);
                return '';
            }
            // a real error toast, so it goes through the same path as the real thing
            globalThis.toastr.error(rule.sample.message, rule.sample.title ?? '');
            return '';
        },
        unnamedArgumentList: SlashCommandArgument?.fromProps ? [SlashCommandArgument.fromProps({
            description: 'error id (ว่าง = สุ่ม)',
            typeList: ARGUMENT_TYPE ? [ARGUMENT_TYPE.STRING] : undefined,
            enumList: RULE_IDS,
            isRequired: false,
        })] : [],
        helpString: 'Error Companion: แสดง error ตัวอย่าง (เช่น <code>/ec-test overloaded</code>) เพื่อดูว่าคอมพาเนียนจะพูดว่าอะไร',
    }));
}

// ---------------------------------------------------------------- new version

let versionCheckedAt = 0;
let versionToastShown = false;

async function checkForNewVersion() {
    if (versionToastShown || Date.now() - versionCheckedAt < 10 * 60_000) return;
    versionCheckedAt = Date.now();
    let remote;
    try {
        const res = await fetch(new URL('manifest.json', BASE_URL), { cache: 'no-store' });
        if (!res.ok) return;
        remote = String((await res.json())?.version ?? '');
    } catch { return; }
    if (!remote || remote === VERSION) return;
    versionToastShown = true;
    ownToast = true;
    try {
        globalThis.toastr?.info(`ติดตั้ง v${esc(remote)} ไว้แล้ว แต่หน้านี้ยังรัน v${VERSION} อยู่<br>แตะที่นี่เพื่อโหลดเวอร์ชันใหม่`, 'Error Companion', {
            timeOut: 0, extendedTimeOut: 0, closeButton: true, escapeHtml: false,
            onclick: () => reloadWithFreshFiles(),
        });
    } finally {
        ownToast = false;
    }
}

async function reloadWithFreshFiles() {
    try {
        await Promise.all(['index.js', 'lib.js', 'errors.js', 'companions.js', 'style.css', 'manifest.json'].map(f =>
            fetch(new URL(f, BASE_URL), { cache: 'reload' }).catch(() => null)));
    } finally {
        location.reload();
    }
}

// ---------------------------------------------------------------- init

function init() {
    if (globalThis.ErrorCompanion) return; // loaded twice
    settings();
    migrateCompanions();
    hookToastr();
    renderSettings();
    registerCommand();
    const refresh = () => { renderCompanionSelect(); renderSettingsList(); };
    loadSeraphina().then(refresh);
    loadChatCharacter().then(refresh);
    const { eventSource, event_types } = ctx();
    eventSource?.on?.(event_types?.CHAT_CHANGED, () => loadChatCharacter().then(refresh));
    // warm the cache so the first pop-up doesn't show an empty frame
    setTimeout(() => {
        const comp = activeCompanion();
        const urls = comp.images?.length ? comp.images.map(i => i.url) : MOODS.map(builtinSprite);
        for (const url of urls) new Image().src = url;
    }, 4000);

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForNewVersion(); });
    setTimeout(checkForNewVersion, 3000);
    globalThis.ErrorCompanion = { VERSION, settings, show: (id, count = 1, mode) => { const r = ruleById(id); if (r) show(r, r.sample, count, mode); } };
    console.log(LOG, 'loaded', `v${VERSION}`);
}

if (typeof jQuery === 'function') jQuery(init); else init();
