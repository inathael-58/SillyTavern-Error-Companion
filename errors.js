/*
 * Error Companion — what Tawan knows about
 *
 * Rules are tried in order; the first whose `match` hits the toast text
 * (title + message, tags stripped) wins, so put the specific ones first:
 * "blocked" before "empty" (a blocked prompt also says "no candidate"),
 * "quota" before "credits" (Google's 429 mentions billing), "overloaded"
 * before "server" (both can carry a 5xx code).
 *
 * lines: tiers by how many times this error was seen today; the highest tier
 * whose `from` ≤ count is used and one line is picked at random. {n} = count.
 * sample: a real-looking toast for the settings preview and /ec-test.
 */

/** @typedef {'neutral'|'tired'|'pious'|'exhausted'|'shocked'|'confused'} Mood */

/**
 * @typedef {object} ErrorRule
 * @property {string} id
 * @property {string} name      short label for the settings list
 * @property {Mood} mood
 * @property {RegExp[]} match
 * @property {{ from: number, text: string[] }[]} lines
 * @property {string} title     heading above the explanation
 * @property {string} what      what it means
 * @property {string[]} fixes   what to try
 * @property {{ message: string, title?: string }} sample
 */

/** @type {ErrorRule[]} */
export const RULES = [
    {
        id: 'blocked',
        name: 'โดนตัวกรองเนื้อหาบล็อก',
        mood: 'pious',
        match: [
            /PROHIBITED_CONTENT|\bSAFETY\b|BLOCKLIST|\bSPII\b/, // Google's block reasons, upper case only
            /blocked due to|block_?reason|requires moderation|content (filter|policy|management)|flagged|safety (system|filter)|violat(es|ed|ion)/i,
            /^Reasons:/,
        ],
        lines: [
            { from: 1, text: ['มีบาปจะสารภาพไหมครับ', 'ลูกเอ๋ย… ระบบเขาไม่ให้ผ่านนะครับ', 'พี่จะไม่ถามนะว่าเขียนอะไรไป แต่ระบบเขาเห็นหมดแล้วครับ'] },
            { from: 3, text: ['สารภาพมา {n} รอบแล้วนะครับวันนี้ บาปเยอะจริง', 'ขอให้พระเจ้า… เอ้ย ขอให้ตัวกรองเมตตาครับ'] },
            { from: 8, text: ['{n} ครั้งแล้ว… พี่ว่าวันนี้ไปทำบุญก่อนดีไหมครับ'] },
        ],
        title: 'ผู้ให้บริการไม่ยอมตอบ เพราะเนื้อหาติดตัวกรอง',
        what: 'ผู้ให้บริการตรวจ prompt (หรือคำตอบที่กำลังจะส่งกลับ) แล้วเห็นว่าขัดกับนโยบายเนื้อหา เลยไม่ยอมตอบ · ของ Google ถ้าขึ้น PROHIBITED_CONTENT คือตัวกรองที่ปิดไม่ได้ ตั้งค่า Safety ใน SillyTavern ไม่ช่วย ส่วน SAFETY เป็นตัวกรองที่ปรับระดับได้',
        fixes: [
            'ลองแก้หรือลบข้อความล่าสุดแล้วส่งใหม่ บางทีแค่คำเดียวก็ทำให้โดน',
            'ไล่ดูการ์ดตัวละคร, lorebook, preset ว่ามีส่วนไหนน่าจะติดตัวกรอง แล้วปรับถ้อยคำ',
            'แชทยาว ๆ เนื้อหาเก่าที่ยังอยู่ใน context ก็ทำให้โดนได้ ไม่ใช่แค่ข้อความล่าสุด',
            'ตัวกรองแต่ละเจ้า/แต่ละโมเดลเข้มไม่เท่ากัน ลองสลับโมเดลหรือผู้ให้บริการ',
        ],
        sample: { message: 'Google AI Studio API returned no candidate\nPrompt was blocked due to : PROHIBITED_CONTENT', title: 'Chat Completion API' },
    },
    {
        id: 'overloaded',
        name: 'เซิร์ฟเวอร์คนแน่น (503)',
        mood: 'tired',
        match: [
            /overloaded|high demand|spikes? in demand|currently unavailable|UNAVAILABLE|over capacity|\b(503|529)\b/i,
        ],
        lines: [
            { from: 1, text: ['อ้าว… เซิร์ฟเวอร์เขาคนแน่นอีกแล้ว รอแป๊บนึงนะครับ', 'ร้านเต็มครับ ต่อคิวก่อนนะ', 'ตอนนี้คนทั้งโลกแย่งกันใช้อยู่ครับ ใจเย็น ๆ'] },
            { from: 3, text: ['ออกไปแตะหญ้าเถอะครับ', 'ไปดื่มน้ำ ยืดเส้นยืดสายก่อนไหมครับ เดี๋ยวค่อยกลับมากดใหม่', 'ครั้งที่ {n} แล้วครับ… ชงชามาจิบรอด้วยกันไหม'] },
            { from: 8, text: ['พี่ไปแตะหญ้ามาให้แล้วนะ… หญ้าก็ยังไม่ตอบเหมือนกันครับ', '{n} ครั้งแล้ววันนี้ หญ้าข้างนอกคิดถึงคุณแล้วนะครับ'] },
        ],
        title: 'เซิร์ฟเวอร์ของผู้ให้บริการรับไม่ไหวชั่วคราว',
        what: 'ตอนนั้นมีคนใช้โมเดลนี้พร้อมกันเยอะเกินกว่าเซิร์ฟเวอร์จะรับไหว เจอบ่อยกับโมเดลยอดนิยมและ API ฟรีของ Google AI Studio · ไม่ใช่ความผิดของเรา ไม่ได้แปลว่า API key หรือการตั้งค่าผิด',
        fixes: [
            'รอสักพัก (ไม่กี่วินาทีถึงไม่กี่นาที) แล้วกด regenerate / swipe ใหม่',
            'สลับไปใช้โมเดลอื่นชั่วคราว เช่นรุ่น Flash หรือรุ่นที่คนใช้น้อยกว่า',
            'สร้าง API key ใหม่ไม่ช่วยนะครับ ปัญหาอยู่ที่ฝั่งเซิร์ฟเวอร์',
        ],
        sample: { message: 'The model is overloaded. Please try again later.', title: 'Chat Completion API' },
    },
    {
        id: 'quota',
        name: 'โควตาหมด / ส่งถี่เกิน (429)',
        mood: 'exhausted',
        match: [
            /quota|rate.?limit|RESOURCE_EXHAUSTED|resource has been exhausted|too many requests|\b429\b|free-models-per/i,
        ],
        lines: [
            { from: 1, text: ['วันนี้คุยกันเยอะแล้วนะครับ ขอพักก่อน…', 'หมดแรงแล้วครับ… โควตาเขาไม่ให้ไปต่อ', 'ช้า ๆ หน่อยครับ พี่ตามไม่ทัน'] },
            { from: 3, text: ['{n} ครั้งแล้ว… พี่ไม่ไหวแล้วครับ', 'โควตาไม่ใช่บ่อน้ำมันนะครับ มันหมดได้'] },
        ],
        title: 'ส่งคำขอเกินโควตาที่ได้รับ',
        what: 'ผู้ให้บริการจำกัดจำนวนคำขอไว้ อาจเป็นต่อนาที (ส่งถี่ไป) หรือต่อวัน (ใช้ครบโควตาของวันแล้ว) · API ฟรีของ Google มีโควตาแยกตามโมเดล ส่วนโมเดลฟรีของ OpenRouter จำกัดจำนวนครั้งต่อวัน',
        fixes: [
            'ถ้าเพิ่งกดรัว ๆ ลองรอสัก 1 นาทีแล้วส่งใหม่',
            'ถ้าโควตารายวันหมด ต้องรอรีเซ็ต · Google รีเซ็ตตอนเที่ยงคืนเวลาแปซิฟิก (ประมาณบ่ายสองถึงบ่ายสามโมงเวลาไทย)',
            'สลับไปใช้โมเดลอื่น โควตาของแต่ละโมเดลแยกกัน',
            'ส่วนขยายที่ยิงคำขอเบื้องหลัง (สรุปความอัตโนมัติ, สร้างภาพ, แปลภาษา ฯลฯ) ก็กินโควตาด้วย ปิดไว้ช่วยประหยัดได้',
        ],
        sample: { message: 'You exceeded your current quota, please check your plan and billing details.', title: 'Chat Completion API' },
    },
    {
        id: 'credits',
        name: 'เครดิตหมด (402)',
        mood: 'exhausted',
        match: [
            /insufficient (credits|balance|funds)|credit balance|more credits|can only afford|payment required|\b402\b/i,
        ],
        lines: [
            { from: 1, text: ['กระเป๋าตังค์ร้องไห้แล้วครับ', 'เงินในบัญชีไม่พอแล้วนะครับ…', 'พี่ช่วยออกให้ได้นะ ถ้าพี่มีเงิน'] },
            { from: 3, text: ['กระเป๋าตังค์ยังร้องไห้อยู่เลยครับ ({n} รอบแล้ว)'] },
        ],
        title: 'เครดิตในบัญชีไม่พอ',
        what: 'บัญชีที่ผู้ให้บริการแบบจ่ายเงิน (เช่น OpenRouter, Anthropic, OpenAI) มีเครดิตไม่พอสำหรับคำขอนี้ · บางครั้งเครดิตยังเหลือ แต่ไม่พอกับความยาวคำตอบสูงสุดที่ตั้งไว้ เพราะผู้ให้บริการกันเงินเผื่อไว้ตามค่านั้น',
        fixes: [
            'เติมเครดิตที่เว็บของผู้ให้บริการ',
            'ลด Max Response Length (ความยาวคำตอบ) ลง',
            'สลับไปใช้โมเดลฟรีชั่วคราว (ใน OpenRouter คือรุ่นที่ลงท้ายด้วย :free)',
        ],
        sample: { message: 'This request requires more credits, or fewer max_tokens. You requested up to 8192 tokens, but can only afford 1200.', title: 'Chat Completion API' },
    },
    {
        id: 'key',
        name: 'API key ไม่ถูกต้อง',
        mood: 'confused',
        match: [
            /api.?key (is )?(not valid|invalid|expired)|invalid.{0,20}(api.?key|x-api-key|authentication)|incorrect api key|API_KEY_INVALID/i,
            /no auth credentials|unauthori[sz]ed|\b401\b|permission.denied|PERMISSION_DENIED|user not found/i,
        ],
        lines: [
            { from: 1, text: ['กุญแจผิดดอกนะครับ ไขไม่เข้า', 'เอ๊ะ… key นี้เขาไม่รับนะครับ', 'ประตูล็อกอยู่ครับ กุญแจที่ให้มาใช้ไม่ได้'] },
            { from: 3, text: ['ลองกุญแจดอกเดิมมา {n} รอบแล้วนะครับ…'] },
        ],
        title: 'ผู้ให้บริการไม่รับ API key',
        what: 'API key ที่ใส่ไว้ใช้ไม่ได้ อาจพิมพ์/คัดลอกผิด, key ถูกลบหรือหมดอายุ, ไม่มีสิทธิ์ใช้โมเดลนี้, หรือใส่ key ผิดเจ้า (เช่นเอา key ของ OpenRouter ไปใส่ช่อง Google)',
        fixes: [
            'เปิด API Connections ตรวจว่าเลือกผู้ให้บริการถูกเจ้า',
            'คัดลอก key ใหม่จากเว็บของผู้ให้บริการ ระวังช่องว่างติดมาหัวท้าย แล้วกด Connect อีกครั้ง',
            'ถ้าจะแคปหน้าจอไปถามในกลุ่ม อย่าให้เห็น API key นะครับ',
        ],
        sample: { message: 'API key not valid. Please pass a valid API key.', title: 'Chat Completion API' },
    },
    {
        id: 'location',
        name: 'ประเทศไม่รองรับ',
        mood: 'confused',
        match: [
            /location is not supported|unsupported.(country|region|location)|not available in your (country|region)|FAILED_PRECONDITION/i,
        ],
        lines: [
            { from: 1, text: ['เขาบอกว่าแถวบ้านเรายังไม่เปิดให้บริการครับ', 'เอ๊ะ… ตอนนี้เราอยู่ประเทศไหนกันนะครับ'] },
        ],
        title: 'ผู้ให้บริการไม่เปิดให้ใช้จากประเทศนี้',
        what: 'ผู้ให้บริการเห็นว่าคำขอมาจากประเทศหรือภูมิภาคที่ยังไม่รองรับ มักเกิดตอนเปิด VPN อยู่ หรือรัน SillyTavern บนเซิร์ฟเวอร์เช่าที่ตั้งอยู่ในประเทศที่ไม่รองรับ',
        fixes: [
            'ถ้าเปิด VPN อยู่ ลองปิดหรือเปลี่ยนไปประเทศที่รองรับ',
            'ถ้ารัน ST บนเซิร์ฟเวอร์เช่าหรือคลาวด์ ตรวจว่าเซิร์ฟเวอร์อยู่ประเทศไหน',
        ],
        sample: { message: 'User location is not supported for the API use.', title: 'Chat Completion API' },
    },
    {
        id: 'context',
        name: 'prompt ยาวเกิน context',
        mood: 'exhausted',
        match: [
            /exceed(s)? the context|context (size|length|window)|maximum context|exceeds the maximum number of tokens|prompt is too long|too many (input )?tokens|input token count/i,
        ],
        lines: [
            { from: 1, text: ['ยัดเยอะไปแล้วครับ หัวพี่จะระเบิด', 'ความจำเต็มแล้วครับ ใส่ไม่ลงแล้ว', 'อ่านไม่ไหวแล้วครับ ยาวกว่านิยายอีก'] },
        ],
        title: 'ข้อความที่จะส่งยาวเกินขนาด context',
        what: 'prompt ที่ประกอบจากการ์ดตัวละคร, preset, lorebook และประวัติแชท ยาวเกินที่โมเดลรับได้ หรือเกิน Context Size ที่ตั้งไว้ · ถ้าขึ้นว่า Mandatory prompts exceed แปลว่าแค่ส่วนที่ "ต้องส่งเสมอ" (system prompt, การ์ด, ส่วนที่ปักไว้) ก็ใหญ่จนไม่เหลือที่ให้แชทแล้ว',
        fixes: [
            'เพิ่ม Context Size ในหน้า AI Response Configuration (ไม่เกินที่โมเดลรองรับ)',
            'ลด Max Response Length ลง เพราะ ST กันที่ไว้ให้คำตอบด้วย',
            'ย่อการ์ดตัวละคร, lorebook ที่ตั้งเป็น constant, author\'s note หรือ preset ที่ยาวมาก',
        ],
        sample: { message: 'Mandatory prompts exceed the context size.' },
    },
    {
        id: 'empty',
        name: 'ตอบกลับมาว่างเปล่า',
        mood: 'confused',
        match: [
            /candidate text empty|returned no candidate|empty (response|reply|message)|response was empty|no (response|content) (was )?returned/i,
        ],
        lines: [
            { from: 1, text: ['เขาตอบมา… ว่างเปล่าครับ', 'เงียบ… เหมือนทักไปแล้วอีกฝ่ายอ่านไม่ตอบเลยครับ', 'ได้กล่องเปล่ามาครับ ข้างในไม่มีอะไรเลย'] },
            { from: 3, text: ['ว่างเปล่ามา {n} รอบแล้วครับ… เขาโกรธอะไรเราหรือเปล่า'] },
        ],
        title: 'ผู้ให้บริการตอบกลับมาแต่ไม่มีข้อความ',
        what: 'คำขอส่งไปถึงแล้ว แต่ไม่มีข้อความกลับมา สาเหตุที่เจอบ่อย: คำตอบโดนตัวกรองตัดกลางทางโดยไม่บอกตรง ๆ หรือโมเดลแบบคิดก่อนตอบ (thinking) ใช้โทเคนหมดไปกับการคิด จนไม่เหลือให้ตอบ',
        fixes: [
            'ลอง swipe ใหม่ก่อน บางทีเป็นแค่ครั้งเดียว',
            'ถ้าใช้โมเดล thinking ลองเพิ่ม Max Response Length',
            'ถ้าเป็นทุกครั้งที่จุดเดิมของเรื่อง อาจโดนตัวกรอง ลองแก้ข้อความล่าสุดดู',
        ],
        sample: { message: 'Google AI Studio Candidate text empty', title: 'Chat Completion API' },
    },
    {
        id: 'model',
        name: 'ไม่พบโมเดล',
        mood: 'confused',
        match: [
            /not found for API version|no endpoints found|model.{0,60}(not found|does not exist|not supported|is not available)|model_not_found|(invalid|unknown) model/i,
        ],
        lines: [
            { from: 1, text: ['โมเดลนี้… ไม่มีอยู่จริงครับ หรืออาจจะเคยมี', 'หาโมเดลนี้ไม่เจอครับ ย้ายบ้านไปแล้วมั้ง'] },
        ],
        title: 'หาโมเดลที่เลือกไว้ไม่เจอ',
        what: 'ชื่อโมเดลที่เลือกไว้ไม่มีอยู่, ถูกเลิกให้บริการไปแล้ว หรือ key นี้ไม่มีสิทธิ์ใช้ · โมเดลรุ่น preview / experimental มักถูกปิดหลังออกรุ่นจริง',
        fixes: [
            'เลือกโมเดลใหม่จากรายการใน API Connections',
            'ถ้าพิมพ์ชื่อโมเดลเอง ตรวจตัวสะกดอีกที',
        ],
        sample: { message: 'models/gemini-1.0-pro is not found for API version v1beta, or is not supported for generateContent.', title: 'Chat Completion API' },
    },
    {
        id: 'network',
        name: 'ต่อไม่ติด',
        mood: 'shocked',
        match: [
            /failed to fetch|fetch failed|network ?error|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|cannot be reached|could not get a reply|connection (refused|error|reset)|load failed/i,
        ],
        lines: [
            { from: 1, text: ['สายหลุด! ติดต่อไม่ได้เลยครับ', 'ฮัลโหล? ฮัลโหล?? ไม่มีใครรับสายครับ', 'เดี๋ยวนะ เน็ตไปไหนแล้วครับ!'] },
            { from: 3, text: ['ยังติดต่อไม่ได้อีกแล้วครับ ({n} รอบ)… พี่เริ่มใจไม่ดีแล้ว'] },
        ],
        title: 'ส่งคำขอไปไม่ถึงปลายทาง',
        what: 'SillyTavern ติดต่อปลายทางไม่ได้ อาจเป็นเน็ตหลุด, หน้าต่าง terminal ของ ST ถูกปิดไป, ที่อยู่ API หรือ reverse proxy ผิด, หรือโปรแกรมในเครื่องอย่าง KoboldCpp / Ollama ยังไม่ได้เปิด',
        fixes: [
            'เช็กอินเทอร์เน็ต',
            'ดูว่าหน้าต่าง terminal ของ ST ยังเปิดอยู่ (บนมือถือที่ใช้ Termux อย่าปัดแอปทิ้ง)',
            'ตรวจ URL ใน API Connections และ reverse proxy แล้วกด Connect ใหม่',
        ],
        sample: { message: 'Could not get a reply from API. Check your connection settings / API key and try again.' },
    },
    {
        id: 'server',
        name: 'เซิร์ฟเวอร์ปลายทางพัง (500/502/504)',
        mood: 'shocked',
        match: [
            /internal (server )?error|bad gateway|gateway time-?out|deadline.(exceeded|expired)|timed? ?out|\b50[024]\b|provider returned error/i,
        ],
        lines: [
            { from: 1, text: ['ฝั่งเขาพังครับ! ไม่ใช่ฝีมือเรานะ', 'เกิดอะไรขึ้นที่โน่นเนี่ย…', 'เซิร์ฟเวอร์เขาล้มครับ! ใครก็ได้ช่วยที'] },
            { from: 3, text: ['พังมา {n} รอบแล้วครับ… พักก่อนไหม'] },
        ],
        title: 'เซิร์ฟเวอร์ของผู้ให้บริการมีปัญหา',
        what: 'เซิร์ฟเวอร์ปลายทาง (หรือ proxy / ผู้ให้บริการตัวกลางระหว่างทาง) เกิดข้อผิดพลาดภายใน หรือใช้เวลานานจนหมดเวลา · ส่วนใหญ่เป็นปัญหาชั่วคราวฝั่งเขา',
        fixes: [
            'ลองใหม่อีกครั้ง ส่วนใหญ่หายเอง',
            'ถ้าเป็นนาน ดูหน้า status ของผู้ให้บริการ',
            'ถ้าใช้ reverse proxy ลองปิดชั่วคราว เพื่อดูว่าปัญหาอยู่ที่ proxy หรือเปล่า',
            'prompt ยาวมาก ๆ หรือโมเดลคิดนาน อาจทำให้หมดเวลา (504) ลองลดความยาวดู',
        ],
        sample: { message: 'Internal error encountered.', title: 'Chat Completion API' },
    },
];

/** Shown for API errors no rule knows. */
export const UNKNOWN = {
    id: 'unknown',
    name: 'error ที่ยังไม่รู้จัก',
    mood: 'neutral',
    match: [],
    lines: [
        { from: 1, text: ['อันนี้พี่ก็ไม่รู้จักแฮะ…', 'error หน้าใหม่ครับ พี่ยังไม่เคยเจอเหมือนกัน', 'อืม… อันนี้ต้องอ่านข้อความต้นฉบับกันแล้วครับ'] },
    ],
    title: 'ตะวันยังไม่รู้จัก error นี้',
    what: 'ข้อความต้นฉบับอยู่ด้านล่าง มักมีคำใบ้อยู่ เช่นรหัส 4xx มักเป็นฝั่งเรา (การตั้งค่า, key, เนื้อหา) ส่วน 5xx เป็นฝั่งเซิร์ฟเวอร์',
    fixes: [
        'ลอง regenerate อีกครั้ง',
        'คัดลอกข้อความ error ไปถามในกลุ่มหรือค้นในเน็ต (ลบ API key ออกก่อนถ้ามีติดไป)',
    ],
    sample: { message: 'Something strange happened: [object Object]', title: 'API returned an error' },
};

/** Toast titles that mean "the model / API call failed" — only these get the unknown fallback. */
export const API_TITLE = /API|generation|completion|connection/i;
