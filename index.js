/*
 * Error Companion — SillyTavern UI extension
 *
 *   • watches SillyTavern's error toasts; when one is an error Tawan knows
 *     (503 overloaded, blocked content, quota, bad key, …) he pops up
 *     visual-novel style with a joke, then explains what it really means and
 *     what to try
 *   • full box or a small bubble in the corner (setting: always full, full the
 *     first time each day then small, or always small)
 *   • the more often an error shows up today, the more he has to say about it
 *
 * The original toast still shows (optionally hidden). Matching lives in lib.js,
 * what he knows in errors.js.
 */

import { RULES, UNKNOWN } from './errors.js';
import { dayKey, graphemes, matchRule, pickLine, plainText } from './lib.js';

const MODULE = 'error_companion';
const LOG = '[ErrorCompanion]';
const VERSION = '0.1.0'; // keep in sync with manifest.json
const BASE_URL = new URL('.', import.meta.url);

const NAME = 'ตะวัน';
const MOODS = ['neutral', 'tired', 'pious', 'exhausted', 'shocked', 'confused'];
const spriteUrl = mood => new URL(`sprites/tawan/${mood}.webp`, BASE_URL).href;
/** Face centre in each 588×520 sprite, for the round crop in the small bubble. */
const FACE = {
    neutral: [278, 132], tired: [282, 125], pious: [278, 131],
    exhausted: [262, 133], shocked: [280, 129], confused: [240, 147],
};
const SPRITE_W = 588;

const DEFAULTS = Object.freeze({
    enabled: true,
    display: 'first',   // 'full' | 'first' (full the first time each day, then small) | 'mini'
    hideToast: false,   // remove SillyTavern's own toast when Tawan explains it
    typewriter: true,
    muted: {},          // rule id → true: don't show this one
});

const MINI_MS = 9000;      // the small bubble hides itself after this long
const SNOOZE_MS = 10 * 60_000;
const TYPE_MS = 28;        // per character

// ---------------------------------------------------------------- helpers

const ctx = () => SillyTavern.getContext();
const $id = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ALL_RULES = [...RULES, UNKNOWN];
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
                onToast(type, message, title, toast);
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

/** What is on screen now: { rule, raw, count, line, hits } */
let current = null;

/**
 * @param {import('./errors.js').ErrorRule} rule
 * @param {{ message: string, title?: string }} raw the toast text
 * @param {number} count times seen today (1 = first)
 * @param {'full'|'mini'} [force]
 */
function show(rule, raw, count, force) {
    const mode = settings().display;
    const fullOpen = !!root && !root.hidden;
    if (current?.rule === rule && (fullOpen || miniOpen())) {
        // the same error again while he is still talking about it: just count it
        current.hits++;
        current.count = count;
        updateBadges();
        if (miniOpen()) armMiniTimer();
        return;
    }
    current = { rule, raw, count, line: pickLine(rule, count), hits: 1 };
    const full = force ? force === 'full' : fullOpen || mode === 'full' || (mode === 'first' && count <= 1);
    if (full) openFull(); else openMini();
}

function updateBadges() {
    const text = current?.hits > 1 ? `×${current.hits}` : '';
    for (const el of document.querySelectorAll('.ec_badge')) el.textContent = text;
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
                <div class="ec_nameplate"><span id="ec_name">${NAME}</span><span class="ec_badge"></span></div>
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
        snoozeUntil = Date.now() + SNOOZE_MS;
        closeFull();
        globalThis.toastr?.info?.('ตะวันจะเงียบ 10 นาทีครับ', 'Error Companion', { timeOut: 2500 });
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
        navigator.clipboard?.writeText(text).then(
            () => globalThis.toastr?.success?.('คัดลอกแล้ว', 'Error Companion', { timeOut: 1500 }),
            () => {});
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
    const { rule, raw, line } = current;
    const sprite = root.querySelector('.ec_sprite');
    sprite.src = spriteUrl(rule.mood);
    root.dataset.mood = rule.mood;
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
    mini.innerHTML = `
        <div class="ec_face"><img alt="${NAME}" draggable="false"></div>
        <div class="ec_bubble" title="แตะเพื่อดูคำอธิบาย">
            <div class="ec_mini_name">${NAME} <span class="ec_badge"></span></div>
            <div class="ec_mini_line"></div>
            <div class="ec_mini_hint">แตะเพื่อดูว่าหมายถึงอะไร</div>
        </div>
        <div class="ec_mini_close fa-solid fa-xmark" title="ปิด" role="button" tabindex="0"></div>`;
    document.body.append(mini);
    const expand = () => { if (current) { clearTimeout(miniTimer); openFull(); } };
    mini.querySelector('.ec_bubble').addEventListener('click', expand);
    mini.querySelector('.ec_face').addEventListener('click', expand);
    mini.querySelector('.ec_mini_close').addEventListener('click', () => { closeMini(); current = null; });
    mini.addEventListener('mouseenter', () => clearTimeout(miniTimer));
    mini.addEventListener('mouseleave', armMiniTimer);
}

function openMini() {
    if (!mini) buildMini();
    const { rule, line } = current;
    const img = mini.querySelector('.ec_face img');
    const size = 64;
    const k = size / 200; // show about 200px of the sprite around his face
    const [fx, fy] = FACE[rule.mood] ?? FACE.neutral;
    img.src = spriteUrl(rule.mood);
    img.style.width = `${SPRITE_W * k}px`;
    img.style.left = `${size / 2 - fx * k}px`;
    img.style.top = `${size / 2 - fy * k}px`;
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

                <div class="ec_set_title">ตอนเจอ error</div>
                <select id="ec_display" class="text_pole">
                    <option value="first">เด้งเต็มครั้งแรกของวัน ครั้งต่อไปเป็นแบบมินิ</option>
                    <option value="full">เด้งเต็มทุกครั้ง</option>
                    <option value="mini">แบบมินิทุกครั้ง</option>
                </select>
                <small class="ec_note">แบบมินิ = ตะวันโผล่มุมจอพร้อมประโยคสั้น ๆ แตะเพื่อดูคำอธิบายเต็ม · นับครั้งแยกตาม error แต่ละแบบ</small>
                <label class="checkbox_label"><input type="checkbox" id="ec_hidetoast"> ซ่อนกล่อง error เดิมของ SillyTavern เมื่อตะวันรู้จัก error นั้น</label>
                <label class="checkbox_label"><input type="checkbox" id="ec_typewriter"> ตัวอักษรขึ้นทีละตัว</label>

                <div class="ec_set_title">error ที่ตะวันรู้จัก <small class="ec_note ec_inline">(ติ๊กออก = ไม่ต้องบอก · ตัวเลข = เจอวันนี้กี่ครั้ง)</small></div>
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
    renderSettingsList();
}

function renderSettingsList() {
    const list = $id('ec_rules');
    if (!list) return;
    const s = settings();
    list.innerHTML = ALL_RULES.map(r => `
        <div class="ec_rule" data-rule="${r.id}">
            <label class="checkbox_label"><input type="checkbox" ${s.muted[r.id] ? '' : 'checked'}>
                <img class="ec_rule_face" src="${spriteUrl(r.mood)}" alt="" loading="lazy">
                <span>${esc(r.name)}</span></label>
            <span class="ec_count" title="เจอวันนี้"></span>
            <div class="menu_button ec_try" title="ลองดู"><i class="fa-solid fa-play"></i></div>
        </div>`).join('');
    renderSettingsCounts();
}

function renderSettingsCounts() {
    const counts = readStats().counts;
    for (const row of document.querySelectorAll('#ec_rules [data-rule]')) {
        const n = counts[/** @type {HTMLElement} */ (row).dataset.rule] ?? 0;
        row.querySelector('.ec_count').textContent = n ? String(n) : '';
    }
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
                globalThis.toastr?.warning?.(`ไม่รู้จัก "${id}" · มี: ${ALL_RULES.map(r => r.id).join(', ')}`, 'Error Companion');
                return '';
            }
            // a real error toast, so it goes through the same path as the real thing
            globalThis.toastr.error(rule.sample.message, rule.sample.title ?? '');
            return '';
        },
        unnamedArgumentList: SlashCommandArgument?.fromProps ? [SlashCommandArgument.fromProps({
            description: 'error id (ว่าง = สุ่ม)',
            typeList: ARGUMENT_TYPE ? [ARGUMENT_TYPE.STRING] : undefined,
            enumList: ALL_RULES.map(r => r.id),
            isRequired: false,
        })] : [],
        helpString: 'Error Companion: แสดง error ตัวอย่าง (เช่น <code>/ec-test overloaded</code>) เพื่อดูว่าตะวันจะพูดว่าอะไร',
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
    globalThis.toastr?.info(`ติดตั้ง v${esc(remote)} ไว้แล้ว แต่หน้านี้ยังรัน v${VERSION} อยู่<br>แตะที่นี่เพื่อโหลดเวอร์ชันใหม่`, 'Error Companion', {
        timeOut: 0, extendedTimeOut: 0, closeButton: true, escapeHtml: false,
        onclick: () => reloadWithFreshFiles(),
    });
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
    hookToastr();
    renderSettings();
    registerCommand();
    // warm the cache so the first pop-up doesn't show an empty frame
    setTimeout(() => { for (const m of MOODS) new Image().src = spriteUrl(m); }, 4000);

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForNewVersion(); });
    setTimeout(checkForNewVersion, 3000);
    globalThis.ErrorCompanion = { VERSION, settings, show: (id, count = 1, mode) => { const r = ruleById(id); if (r) show(r, r.sample, count, mode); } };
    console.log(LOG, 'loaded', `v${VERSION}`);
}

if (typeof jQuery === 'function') jQuery(init); else init();
