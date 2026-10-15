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
 *   • the built-in companion is Tawan; users can make their own (name, colour,
 *     image URLs, lines per error) and share them as JSON files
 *
 * The original toast still shows (optionally hidden). Matching and companion
 * files live in lib.js, what the errors mean in errors.js.
 */

import { RULES, UNKNOWN } from './errors.js';
import {
    COMPANION_TYPE, DEFAULT_COLOR, DEFAULT_CROP, MOODS,
    cropBox, dayKey, exportCompanion, formatLines, graphemes, inkFor, isSafeImageUrl, matchRule, pickLine, plainText,
    sanitizeCompanion, sanitizeCrop,
} from './lib.js';

const MODULE = 'error_companion';
const LOG = '[ErrorCompanion]';
const VERSION = '0.3.2'; // keep in sync with manifest.json
const BASE_URL = new URL('.', import.meta.url);

/** The built-in companion. Its sprites ship with the extension and its lines are the rules' own. */
const TAWAN = Object.freeze({ id: 'tawan', name: 'ตะวัน', color: DEFAULT_COLOR, images: [], errorImages: {}, lines: {} });
const builtinSprite = mood => new URL(`sprites/tawan/${mood}.webp`, BASE_URL).href;
/** Tawan's head in each of his 588×520 sprites (centre and width), for the round icon in the small bubble. */
const TAWAN_CROP = Object.fromEntries(Object.entries({
    neutral: [278, 122], tired: [282, 115], pious: [278, 121],
    exhausted: [262, 123], shocked: [280, 119], confused: [240, 137],
}).map(([mood, [x, y]]) => [mood, { x: x / 588, y: y / 520, size: 280 / 588 }]));

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
    return s.companions.find(c => c.id === s.active) ?? TAWAN;
}

/**
 * The picture for this error: the image the companion picked for it, else its first image;
 * a companion without images uses Tawan's sprite for the error's mood.
 */
function imageFor(comp, rule) {
    const images = comp.images ?? [];
    if (!images.length) return { url: builtinSprite(rule.mood), builtin: true };
    const img = images.find(i => i.id === comp.errorImages?.[rule.id]) ?? images[0];
    return { url: img.url, builtin: false };
}

/**
 * The round icon for this error: the companion's own icon image if it has one (fills the circle),
 * else its picture with the companion's crop (Tawan's sprites: his per-mood crop).
 * @returns {{ url: string, crop: { x: number, y: number, size: number } | null }} crop null = fill
 */
function iconFor(comp, rule) {
    if (comp.icon) return { url: comp.icon, crop: null };
    const img = imageFor(comp, rule);
    return { url: img.url, crop: img.builtin ? TAWAN_CROP[rule.mood] : sanitizeCrop(comp.crop) };
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
    const taken = new Set([TAWAN.name, ...settings().companions.filter(c => c.id !== exceptId).map(c => c.name)]);
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

/** What is on screen now: { rule, raw, count, line, hits, comp } */
let current = null;

/**
 * @param {import('./errors.js').ErrorRule} rule
 * @param {{ message: string, title?: string }} raw the toast text
 * @param {number} count times seen today (1 = first)
 * @param {'full'|'mini'} [force]
 * @param {object} [comp] companion to use (default: the active one) — the editor previews unsaved ones
 */
function show(rule, raw, count, force, comp = activeCompanion()) {
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
    current = { rule, raw, count, comp, line: pickLine(linesFor(comp, rule), count), hits: 1 };
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
                    <div class="menu_button ec_mute" title="เปิดกลับได้ในหน้าตั้งค่า Extensions → Error Companion"><i class="fa-solid fa-eye-slash"></i> ไม่ต้องบอก error นี้อีก</div>
                </div>
            </div>
        </div>`;
    document.body.append(root);

    root.querySelector('.ec_backdrop').addEventListener('click', closeFull);
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
    setSprite(root.querySelector('.ec_sprite'), imageFor(comp, rule).url);
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
    typeLine(line);
}

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
    placeIcon(mini.querySelector('.ec_face'), iconFor(comp, rule), 64);
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
    select.innerHTML = [TAWAN, ...s.companions]
        .map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c === TAWAN ? ' (มากับ extension)' : ''}</option>`).join('');
    select.value = activeCompanion().id;
    const builtin = activeCompanion() === TAWAN;
    $id('ec_comp_del').classList.toggle('disabled', builtin);
    $id('ec_comp_export').classList.toggle('disabled', builtin);
    $id('ec_comp_copy').classList.toggle('disabled', builtin);
    $id('ec_comp_edit').title = builtin ? 'สร้างคอมพาเนียนใหม่โดยเริ่มจากบทพูดของตะวัน' : 'แก้ไข';
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
        if (comp !== TAWAN) return openEditor(comp);
        // Tawan can't be edited: start a new one from his lines
        const lines = Object.fromEntries(ALL_RULES.map(r => [r.id, structuredClone(r.lines)]));
        openEditor(null, { name: `${TAWAN.name} (สำเนา)`, color: TAWAN.color, images: [], errorImages: {}, lines });
    });
    $id('ec_comp_del').addEventListener('click', async () => {
        const comp = activeCompanion();
        if (comp === TAWAN) return;
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
        if (comp === TAWAN) return;
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
        if (comp === TAWAN) return;
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

let editingId = null; // id being edited, null = new

/**
 * @param {object|null} comp existing companion to edit, or null for a new one
 * @param {object} [start] starting values for a new one
 */
function openEditor(comp, start) {
    const box = $id('ec_editor');
    const c = comp ?? start ?? { name: '', color: DEFAULT_COLOR, images: [], errorImages: {}, lines: {} };
    editingId = comp?.id ?? null;
    box.innerHTML = `
        <div class="ec_editor">
            <div class="ec_set_title">${comp ? 'แก้ไขคอมพาเนียน' : 'คอมพาเนียนใหม่'}</div>
            <div class="ec_ed_head">
                <label class="ec_field">ชื่อ <input type="text" id="ec_ed_name" class="text_pole" maxlength="40" placeholder="เช่น พี่หมอก"></label>
                <label class="ec_field ec_ed_colorfield">สีป้ายชื่อ <input type="color" id="ec_ed_color"></label>
            </div>

            <div class="ec_set_title">รูป</div>
            <small class="ec_note">เพิ่มได้หลายรูป ตั้งชื่อให้จำง่าย แล้วเลือกใน error แต่ละแบบด้านล่างว่าจะใช้รูปไหน · error ที่ไม่ได้เลือกใช้รูปแรก · ไม่มีรูปเลย = ใช้รูปของตะวัน · ภาพครึ่งตัว พื้นหลังโปร่งใส ขอบล่างตัดตรง จะดูดีที่สุด · ถ้าจะแชร์ ให้ใช้ลิงก์ที่เปิดได้จากทุกเครื่อง (เช่น catbox.moe, imgur)</small>
            <div id="ec_ed_images" class="ec_ed_images"></div>
            <div class="ec_btns"><div id="ec_ed_addimg" class="menu_button"><i class="fa-solid fa-plus"></i> เพิ่มรูป</div></div>

            <div class="ec_set_title">ไอคอนในแบบมินิ</div>
            <small class="ec_note">เลื่อนให้หน้าอยู่กลางวง · ใช้ตำแหน่งเดียวกันทุกรูป ดูให้ครบทุกวง</small>
            <div id="ec_ed_faces" class="ec_ed_faces"></div>
            <div class="ec_ed_sliders">
                <label>ซ้าย ↔ ขวา <input type="range" id="ec_ed_cx" min="0" max="100" step="1"></label>
                <label>ขึ้น ↕ ลง <input type="range" id="ec_ed_cy" min="0" max="100" step="1"></label>
                <label>ซูม <input type="range" id="ec_ed_cz" min="0" max="90" step="1"></label>
                <div id="ec_ed_crop_reset" class="menu_button" title="ตำแหน่งเริ่มต้น"><i class="fa-solid fa-rotate-left"></i></div>
            </div>
            <small id="ec_ed_cropnote" class="ec_note"></small>
            <label class="ec_field">หรือใช้รูปไอคอนแยก <small class="ec_note ec_inline">(ไม่บังคับ · รูปหน้าตรง ๆ จะเต็มวงพอดี)</small>
                <input type="url" id="ec_ed_icon" class="text_pole" placeholder="https://…" autocomplete="off" spellcheck="false"></label>

            <div class="ec_set_title">error แต่ละแบบ</div>
            <small class="ec_note">เลือกรูปและเขียนบทพูด · บรรทัดละประโยค (สุ่มมาหนึ่งประโยค) · ขึ้นต้นด้วย <code>[3]</code> = ใช้ตั้งแต่เจอครั้งที่ 3 ของวัน · <code>{n}</code> = จำนวนครั้ง · ว่าง = ใช้บทของตะวัน · คำอธิบายใต้บทพูดใช้ของกลางเหมือนกันทุกตัว</small>
            ${ALL_RULES.map(r => `
            <details class="ec_ed_rule" data-rule="${r.id}">
                <summary><span class="ec_ed_face ec_ed_face_sm"><img alt=""></span><span>${esc(r.name)}</span> <small class="ec_ed_mark"></small></summary>
                <label class="ec_field">รูป <select class="text_pole ec_ed_pick"></select></label>
                <label class="ec_field">บทพูด
                    <textarea class="text_pole" rows="4" spellcheck="false" placeholder="${esc(formatLines(r.lines))}"></textarea></label>
            </details>`).join('')}

            <div class="ec_btns">
                <div id="ec_ed_save" class="menu_button"><i class="fa-solid fa-floppy-disk"></i> บันทึก</div>
                <div id="ec_ed_try" class="menu_button"><i class="fa-solid fa-play"></i> ลองดู</div>
                <div id="ec_ed_cancel" class="menu_button"><i class="fa-solid fa-xmark"></i> ยกเลิก</div>
            </div>
        </div>`;

    /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_name')).value = c.name ?? '';
    /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_color')).value = c.color || DEFAULT_COLOR;
    /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_icon')).value = c.icon ?? '';
    for (const img of c.images ?? []) addImageRow(box, img);
    refreshPicks(box);
    for (const det of box.querySelectorAll('.ec_ed_rule')) {
        const id = /** @type {HTMLElement} */ (det).dataset.rule;
        /** @type {HTMLSelectElement} */ (det.querySelector('.ec_ed_pick')).value = c.errorImages?.[id] ?? '';
        det.querySelector('textarea').value = formatLines(c.lines?.[id]);
        markRule(det);
    }
    const setCropInputs = k => {
        /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_cx')).value = String(Math.round(k.x * 100));
        /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_cy')).value = String(Math.round(k.y * 100));
        /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_cz')).value = String(Math.round((1 - k.size) * 100));
    };
    setCropInputs(sanitizeCrop(c.crop));
    updatePreview();

    box.oninput = e => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t.closest('.ec_ed_img')) refreshPicks(box);
        if (t.closest('.ec_ed_rule')) markRule(t.closest('.ec_ed_rule'));
        updatePreview();
    };
    box.onchange = box.oninput;
    box.querySelector('#ec_ed_addimg').addEventListener('click', () => {
        const row = addImageRow(box, { id: '', name: '', url: '' });
        refreshPicks(box);
        updatePreview();
        row.querySelector('.ec_ed_imgname').focus();
    });
    box.querySelector('#ec_ed_images').addEventListener('click', e => {
        const row = /** @type {HTMLElement} */ (e.target).closest('.ec_ed_delimg')?.closest('.ec_ed_img');
        if (!row) return;
        row.remove();
        refreshPicks(box);
        updatePreview();
    });
    box.querySelector('#ec_ed_crop_reset').addEventListener('click', () => { setCropInputs(DEFAULT_CROP); updatePreview(); });
    box.querySelector('#ec_ed_save').addEventListener('click', saveEditor);
    box.querySelector('#ec_ed_try').addEventListener('click', () => {
        const comp = readEditor();
        if (!comp) return;
        const touched = ALL_RULES.filter(r => comp.lines[r.id] || comp.errorImages[r.id]);
        const pool = touched.length ? touched : RULES;
        const rule = pool[Math.floor(Math.random() * pool.length)];
        closeFull();
        show(rule, rule.sample, 1, 'full', { id: 'preview', ...comp });
    });
    box.querySelector('#ec_ed_cancel').addEventListener('click', closeEditor);
    box.hidden = false;
    box.querySelector('#ec_ed_name').focus();
}

/** One row in the image list. A new row gets an id unused in this editor. */
function addImageRow(box, img) {
    const list = box.querySelector('#ec_ed_images');
    const taken = new Set([...list.querySelectorAll('.ec_ed_img')].map(r => /** @type {HTMLElement} */ (r).dataset.img));
    let id = img.id;
    for (let n = taken.size + 1; !id || taken.has(id); n++) id = `img${n}`;
    const row = document.createElement('div');
    row.className = 'ec_ed_img';
    row.dataset.img = id;
    row.innerHTML = `
        <img class="ec_ed_thumb" alt="">
        <div class="ec_ed_img_fields">
            <input type="text" class="text_pole ec_ed_imgname" maxlength="30" placeholder="ชื่อรูป เช่น ยิ้ม, ตกใจ, ร้องไห้">
            <input type="url" class="text_pole ec_ed_url" placeholder="https://…" autocomplete="off" spellcheck="false">
        </div>
        <div class="menu_button ec_ed_delimg" title="ลบรูปนี้"><i class="fa-solid fa-trash"></i></div>`;
    /** @type {HTMLInputElement} */ (row.querySelector('.ec_ed_imgname')).value = img.name ?? '';
    /** @type {HTMLInputElement} */ (row.querySelector('.ec_ed_url')).value = img.url ?? '';
    list.append(row);
    return row;
}

/** The image dropdown of every error follows the image list (keeping each choice while it exists). */
function refreshPicks(box) {
    const rows = [...box.querySelectorAll('.ec_ed_img')];
    const options = `<option value="">รูปแรก (ค่าเริ่มต้น)</option>` + rows.map((row, i) => {
        const name = /** @type {HTMLInputElement} */ (row.querySelector('.ec_ed_imgname')).value.trim() || `รูป ${i + 1}`;
        return `<option value="${esc(/** @type {HTMLElement} */ (row).dataset.img)}">${esc(name)}</option>`;
    }).join('');
    for (const select of box.querySelectorAll('.ec_ed_pick')) {
        const keep = /** @type {HTMLSelectElement} */ (select).value;
        select.innerHTML = options;
        /** @type {HTMLSelectElement} */ (select).value = rows.some(r => /** @type {HTMLElement} */ (r).dataset.img === keep) ? keep : '';
    }
}

function markRule(det) {
    const parts = [];
    if (det.querySelector('.ec_ed_pick').value) parts.push('เลือกรูปแล้ว');
    if (det.querySelector('textarea').value.trim()) parts.push('เขียนบทเองแล้ว');
    det.querySelector('.ec_ed_mark').textContent = parts.length ? `· ${parts.join(' · ')}` : '';
}

/** Crop as set by the sliders. */
function editorCrop(box) {
    const val = id => Number(/** @type {HTMLInputElement} */ (box.querySelector(id)).value);
    return sanitizeCrop({ x: val('#ec_ed_cx') / 100, y: val('#ec_ed_cy') / 100, size: 1 - val('#ec_ed_cz') / 100 });
}

/** What the form says right now, leniently: bad or empty links are left out (and outlined) instead of refused. */
function editorPreview(box) {
    const usable = input => {
        const url = /** @type {HTMLInputElement} */ (input).value.trim();
        const ok = !url || isSafeImageUrl(url);
        input.classList.toggle('ec_bad', !ok);
        return url && ok ? url : '';
    };
    const images = [];
    for (const row of box.querySelectorAll('.ec_ed_img')) {
        const url = usable(row.querySelector('.ec_ed_url'));
        const name = /** @type {HTMLInputElement} */ (row.querySelector('.ec_ed_imgname')).value.trim();
        setSprite(row.querySelector('.ec_ed_thumb'), url || builtinSprite('neutral'));
        row.querySelector('.ec_ed_thumb').classList.toggle('ec_placeholder', !url);
        if (url) images.push({ id: /** @type {HTMLElement} */ (row).dataset.img, name, url });
    }
    const errorImages = {};
    for (const det of box.querySelectorAll('.ec_ed_rule')) {
        const pick = /** @type {HTMLSelectElement} */ (det.querySelector('.ec_ed_pick')).value;
        if (pick) errorImages[/** @type {HTMLElement} */ (det).dataset.rule] = pick;
    }
    return { images, errorImages, icon: usable(box.querySelector('#ec_ed_icon')), crop: editorCrop(box) };
}

/** Thumbnails and round icons show what each error will use, including the fallbacks. */
function updatePreview() {
    const box = $id('ec_editor');
    const preview = editorPreview(box);
    const color = /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_color')).value;

    // one round icon per image (or the icon image / Tawan when there are none of their own)
    const faces = box.querySelector('#ec_ed_faces');
    const icons = preview.icon ? [{ title: 'รูปไอคอนแยก', icon: { url: preview.icon, crop: null } }]
        : preview.images.length ? preview.images.map(img => ({ title: img.name, icon: { url: img.url, crop: preview.crop } }))
            : [{ title: TAWAN.name, icon: iconFor(preview, UNKNOWN) }];
    faces.innerHTML = icons.map(() => '<span class="ec_ed_face"><img alt=""></span>').join('');
    icons.forEach((it, i) => {
        const face = /** @type {HTMLElement} */ (faces.children[i]);
        face.title = it.title;
        face.style.borderColor = color;
        placeIcon(face, it.icon, 48);
    });
    for (const det of box.querySelectorAll('.ec_ed_rule')) {
        const face = /** @type {HTMLElement} */ (det.querySelector('.ec_ed_face'));
        face.style.borderColor = color;
        placeIcon(face, iconFor(preview, ruleById(/** @type {HTMLElement} */ (det).dataset.rule)), 28);
    }

    // the sliders only matter for the companion's own images
    const own = !preview.icon && preview.images.length > 0;
    box.querySelector('.ec_ed_sliders').classList.toggle('ec_off', !own);
    box.querySelector('#ec_ed_cropnote').textContent = preview.icon
        ? 'ใช้รูปไอคอนแยกอยู่ (ลบลิงก์ไอคอนออกเพื่อกลับมาครอปจากรูป)'
        : own ? '' : 'ยังไม่มีรูปของตัวเอง ใช้รูปและตำแหน่งของตะวัน';
}

/** Form → checked companion (without id), or null after telling the user what's wrong. */
function readEditor() {
    const box = $id('ec_editor');
    const raw = {
        name: /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_name')).value,
        color: /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_color')).value,
        images: [...box.querySelectorAll('.ec_ed_img')].map(row => ({
            id: /** @type {HTMLElement} */ (row).dataset.img,
            name: /** @type {HTMLInputElement} */ (row.querySelector('.ec_ed_imgname')).value,
            url: /** @type {HTMLInputElement} */ (row.querySelector('.ec_ed_url')).value,
        })),
        errorImages: {},
        icon: /** @type {HTMLInputElement} */ (box.querySelector('#ec_ed_icon')).value,
        crop: editorCrop(box),
        lines: {},
    };
    for (const det of box.querySelectorAll('.ec_ed_rule')) {
        const id = /** @type {HTMLElement} */ (det).dataset.rule;
        raw.errorImages[id] = /** @type {HTMLSelectElement} */ (det.querySelector('.ec_ed_pick')).value;
        raw.lines[id] = det.querySelector('textarea').value;
    }
    try {
        return sanitizeCompanion(raw);
    } catch (e) {
        notify('warning', e.message);
        return null;
    }
}

function saveEditor() {
    const comp = readEditor();
    if (!comp) return;
    const s = settings();
    const id = editingId ?? newId();
    const saved = { id, ...comp, name: uniqueName(comp.name, id) };
    const i = s.companions.findIndex(c => c.id === id);
    if (i >= 0) s.companions[i] = saved; else s.companions.push(saved);
    closeEditor();
    setActive(id);
    notify('success', `บันทึก "${saved.name}" แล้ว`);
}

function closeEditor() {
    const box = $id('ec_editor');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    editingId = null;
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
        await Promise.all(['index.js', 'lib.js', 'errors.js', 'style.css', 'manifest.json'].map(f =>
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
