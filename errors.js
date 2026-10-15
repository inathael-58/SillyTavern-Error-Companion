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
 * followup: a vague message SillyTavern shows next to a more specific one; it
 *   never replaces an explanation that is already on screen.
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
 * @property {boolean} [followup]
 */

/** @type {ErrorRule[]} */
export const RULES = [
    {
        id: 'stserver',
        name: 'เชื่อมต่อเซิร์ฟเวอร์ ST ไม่ได้ / บันทึกไม่ได้',
        mood: 'shocked',
        match: [
            /(settings|chat) could not be saved|check the server connection|csrf token|st server cannot be reached|server is running and accessible/i,
        ],
        lines: [
            { from: 1, text: ['เดี๋ยวนะ! บันทึกไม่ลงครับ', 'บ้านหลังใหญ่ (เซิร์ฟเวอร์ ST) ไม่ตอบรับครับ', 'ใจเย็นนะครับ ก๊อปข้อความที่พิมพ์ค้างไว้เก็บก่อนเลย'] },
            { from: 3, text: ['เซิร์ฟเวอร์ยังไม่ตอบ {n} รอบแล้วครับ… ไปดูหน้าต่าง terminal ทีนะ'] },
        ],
        title: 'หน้าเว็บคุยกับเซิร์ฟเวอร์ SillyTavern ไม่ได้',
        what: 'SillyTavern มีสองส่วน: หน้าเว็บที่เราเห็น กับเซิร์ฟเวอร์ที่รันอยู่เบื้องหลัง (หน้าต่าง terminal, Termux หรือโฮสต์) error นี้แปลว่าหน้าเว็บส่งข้อมูลไปให้เซิร์ฟเวอร์ไม่สำเร็จ การตั้งค่าหรือแชทล่าสุดอาจยังไม่ถูกบันทึก · ถ้าขึ้นว่า CSRF token แปลว่าหน้าเว็บกับเซิร์ฟเวอร์จำกันไม่ได้ เช่นเซิร์ฟเวอร์เพิ่งรีสตาร์ต หรือเปิดหน้าทิ้งไว้นาน',
        fixes: [
            'คัดลอกข้อความที่พิมพ์ค้างไว้เก็บก่อน เผื่อหาย',
            'เช็กว่าเซิร์ฟเวอร์ ST ยังรันอยู่ (หน้าต่าง terminal ยังเปิด, บนมือถือ Termux ยังไม่ถูกปิด)',
            'รีเฟรชหน้าเว็บ · CSRF token แก้ด้วยวิธีนี้เกือบทุกครั้ง',
            'ถ้าเปิด ST จากเครื่องอื่นหรือผ่านเว็บโฮสต์ เช็กอินเทอร์เน็ตและที่อยู่ที่ใช้เปิด',
            'ถ้าพื้นที่ดิสก์ของเครื่องที่รัน ST เต็ม ก็บันทึกไม่ได้เหมือนกัน',
        ],
        sample: { message: 'Check the server connection and reload the page to prevent data loss.', title: 'Settings could not be saved' },
    },
    {
        id: 'import',
        name: 'นำเข้าการ์ดตัวละครไม่ได้',
        mood: 'confused',
        match: [
            /could not import character|file is likely invalid or corrupted/i,
        ],
        lines: [
            { from: 1, text: ['การ์ดใบนี้… อ่านไม่ออกเลยครับ', 'ได้ซองเปล่ามาครับ ข้างในไม่มีตัวละคร', 'รูปสวยนะครับ แต่ตัวละครหายไปไหนก็ไม่รู้'] },
        ],
        title: 'ไฟล์นี้ไม่ใช่การ์ดตัวละครที่ ST อ่านได้',
        what: 'การ์ดตัวละครแบบ PNG ซ่อนข้อมูลตัวละครไว้ในไฟล์ภาพ ถ้าไฟล์ถูกบีบอัดหรือบันทึกใหม่ ข้อมูลส่วนนี้จะหายไป เหลือแค่รูปธรรมดา · หรือไฟล์อาจไม่ใช่การ์ดจริง ๆ เช่นได้ไฟล์หน้าเว็บมาแทน หรือเป็นรูปแบบที่ ST ไม่รองรับ',
        fixes: [
            'ดาวน์โหลดไฟล์ต้นฉบับจากที่มาอีกครั้ง อย่าใช้รูปที่แคปหน้าจอ หรือรูปที่ส่งต่อผ่านแชทและโซเชียล (มักถูกบีบอัดจนข้อมูลหาย)',
            'ถ้ามีไฟล์ .json ของการ์ด ลองนำเข้าไฟล์นั้นแทน',
            'การ์ดจากเว็บไซต์ ลองใช้ช่องนำเข้าจากลิงก์ในหน้ารายชื่อตัวละครแทนการดาวน์โหลดเอง',
        ],
        sample: { message: 'The file is likely invalid or corrupted.', title: 'Could not import character' },
    },
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
        id: 'prefill',
        name: 'ข้อความสุดท้ายเป็นของบอท (prefill)',
        mood: 'confused',
        match: [
            /end(s|ing)? with an? (model|assistant) (turn|message)|must end with a user (turn|message)|(assistant|model) (message )?prefill/i,
        ],
        lines: [
            { from: 1, text: ['เอ๊ะ… จะให้พี่พูดต่อจากประโยคตัวเองเหรอครับ โมเดลนี้เขาไม่ยอมนะ', 'คิวพูดสุดท้ายต้องเป็นของเราครับ ไม่ใช่ของบอท', 'บทจบที่ฝั่งบอทอยู่ครับ เขาเลยไม่รู้จะตอบอะไร'] },
            { from: 3, text: ['{n} รอบแล้วนะครับ ลองไปปิด prefill ดูก่อนไหม'] },
        ],
        title: 'ข้อความสุดท้ายที่ส่งไปเป็นของบอท แต่โมเดลนี้ไม่รับ',
        what: 'prompt ที่ส่งไปลงท้ายด้วยข้อความฝั่งบอท (assistant / model) ซึ่งเป็นเทคนิค "prefill" ให้โมเดลพูดต่อจากคำที่เราใส่ไว้ แต่โมเดลรุ่นใหม่หลายตัว (เช่น Gemini บางรุ่น และ Claude บางรุ่น) ไม่รองรับแล้ว ต้องจบด้วยข้อความฝั่งผู้ใช้เท่านั้น',
        fixes: [
            'ถ้าเกิดตอนกด Continue: ปิด "Continue prefill" ในหน้า AI Response Configuration',
            'ใน preset ถ้ามี prompt ท้ายสุดที่ตั้ง role เป็น AI / Assistant (มักชื่อ prefill) ให้ปิด หรือเปลี่ยน role เป็น User / System',
            'ลบข้อความในช่อง Assistant Prefill (ของ Claude) หรือ Start Reply With (ใน Advanced Formatting)',
        ],
        sample: { message: 'Requests ending with a model turn are not supported.', title: 'Chat Completion API' },
    },
    {
        id: 'param',
        name: 'ตั้งค่าที่โมเดลนี้ไม่รองรับ',
        mood: 'confused',
        match: [
            /thinking (level|budget|config)|reasoning[ _]?effort|unsupported (parameter|value)|(parameter|argument|value).{0,60}not supported|not supported (for|with|by) (this|the) model|invalid value for|unknown (parameter|field)|unrecognized (request )?(argument|parameter)|extra inputs are not permitted/i,
        ],
        lines: [
            { from: 1, text: ['โมเดลนี้เขาไม่รับค่าที่ตั้งไว้ครับ ปรับนิดเดียวก็ได้แล้ว', 'ตั้งค่าเกินสเปกไปนิดนึงครับ', 'ปุ่มนี้โมเดลนี้ไม่มีครับ กดไปก็ไม่ติด'] },
        ],
        title: 'ส่งค่าตั้งค่าที่โมเดลนี้ไม่รองรับ',
        what: 'ค่าบางอย่างใน AI Response Configuration ใช้กับโมเดลนี้ไม่ได้ เช่นระดับการคิด (Reasoning Effort / thinking level) ที่โมเดลนี้ไม่มี หรือค่าอย่าง temperature, top_k, penalty ที่บางรุ่นไม่รับ · ข้อความ error มักบอกชื่อค่าที่มีปัญหาไว้',
        fixes: [
            'ถ้าเกี่ยวกับ thinking / reasoning: เปลี่ยน Reasoning Effort เป็น Auto หรือระดับอื่น',
            'ดูชื่อค่าในข้อความ error แล้วไปปรับหรือรีเซ็ตค่านั้นในหน้า AI Response Configuration',
            'preset ที่ทำมาสำหรับโมเดลอื่นอาจตั้งค่าที่โมเดลนี้ไม่รับ ลองเปลี่ยน preset ดู',
        ],
        sample: { message: 'Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.', title: 'Chat Completion API' },
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
        id: 'denied',
        name: 'บัญชี / โปรเจกต์ถูกระงับสิทธิ์',
        mood: 'shocked',
        match: [
            /denied access|has been (suspended|banned|disabled|terminated)|account (is |was |has been )?(suspended|disabled|deactivated|banned)|organization (has been )?disabled/i,
        ],
        lines: [
            { from: 1, text: ['เอ่อ… เขาบอกว่าโปรเจกต์นี้ถูกระงับครับ', 'ประตูนี้ไม่ได้แค่ล็อกครับ เขาปิดตายเลย'] },
        ],
        title: 'ผู้ให้บริการระงับสิทธิ์ของบัญชีหรือโปรเจกต์นี้',
        what: 'ไม่ใช่ key พิมพ์ผิด แต่ผู้ให้บริการปิดสิทธิ์การใช้งานของบัญชี หรือของโปรเจกต์ที่ key นี้สังกัด (เช่นโปรเจกต์ใน Google AI Studio / Google Cloud) อาจเพราะระบบตรวจพบการใช้งานที่ขัดนโยบาย ปัญหาการชำระเงิน หรือเหตุผลอื่นของผู้ให้บริการ · แก้จากฝั่ง SillyTavern ไม่ได้',
        fixes: [
            'เข้าเว็บของผู้ให้บริการ (เช่น Google AI Studio, Google Cloud Console) แล้วดูประกาศหรืออีเมลที่แจ้งเหตุผล',
            'ถ้าคิดว่าเป็นความผิดพลาด ติดต่อฝ่ายซัพพอร์ตหรือยื่นอุทธรณ์ตามช่องทางที่เขาแจ้ง',
            'ระหว่างรอ ใช้ผู้ให้บริการอื่นไปก่อนได้',
        ],
        sample: { message: 'Your project has been denied access. Please contact support.', title: 'Chat Completion API' },
    },
    {
        id: 'forbidden',
        name: 'ถูกปฏิเสธการเข้าถึง (403 Forbidden)',
        mood: 'confused',
        match: [
            /\bforbidden\b|\b403\b/i,
        ],
        lines: [
            { from: 1, text: ['ยามหน้าประตูไม่ให้เข้าครับ', 'เคาะประตูแล้ว… เขาบอกว่าห้ามเข้าครับ', 'บัตรผ่านเราใช้กับประตูนี้ไม่ได้ครับ'] },
            { from: 3, text: ['โดนไล่กลับมา {n} รอบแล้วครับ ลองเช็กรหัสผ่านของ proxy ดูไหม'] },
        ],
        title: 'ปลายทางรู้ว่าเราเป็นใคร แต่ไม่อนุญาตให้ใช้',
        what: 'ต่างจาก Unauthorized (ยืนยันตัวตนไม่ผ่าน) ตรงที่ 403 Forbidden แปลว่าปลายทางไม่ยอมให้ใช้ · ถ้าใช้ reverse proxy มักเป็นเพราะรหัสผ่านของ proxy ผิดหรือไม่ได้ใส่, proxy ปิดรับคนนอก / ต้องลงทะเบียน IP ก่อน, proxy บล็อกประเทศหรือ IP ของเรา หรือ key ที่เจ้าของ proxy ใช้ต่อไปยังผู้ให้บริการใช้ไม่ได้แล้ว',
        fixes: [
            'เช็กช่อง Proxy Password ในหน้า API Connections ว่าตรงกับที่เจ้าของ proxy ให้มา (ไม่มีช่องว่างติดมา)',
            'เช็กที่อยู่ proxy (ช่อง Reverse Proxy) ว่าถูก และลงท้ายตามที่ proxy นั้นบอก เช่น /v1',
            'ดูประกาศของ proxy (Discord, หน้าเว็บ) ว่าปิดชั่วคราว เปลี่ยนรหัส หรือต้องลงทะเบียนก่อนใช้หรือเปล่า',
            'ถ้าเปิด VPN อยู่ ลองปิด หรือถ้าไม่ได้เปิด ลองถามเจ้าของ proxy ว่าบล็อกประเทศเราไหม',
            'ถ้าใช้ reverse proxy แล้วยังไม่หาย ติดต่อผู้ให้บริการ reverse proxy นั้นโดยตรง แจ้งข้อความ error กับเวลาที่เกิดไปด้วย (อย่าส่ง API key หรือรหัสผ่านไปในแชทสาธารณะ)',
            'ถ้าไม่ได้ใช้ proxy: key อาจไม่มีสิทธิ์ใช้โมเดลหรือบริการนี้ ลองสร้าง key ใหม่หรือเช็กสิทธิ์ในบัญชี',
        ],
        sample: { message: 'Forbidden', title: 'API returned an error' },
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
        name: 'ใช้โมเดลนี้ไม่ได้ / ไม่พบโมเดล',
        mood: 'confused',
        match: [
            /not found for API version|no endpoints found|model.{0,60}(not found|does not exist|not supported|is not available)|model_not_found|(invalid|unknown) model/i,
            /multi-?turn chat is not enabled|is not enabled for models?\//i,
        ],
        lines: [
            { from: 1, text: ['โมเดลนี้… ไม่มีอยู่จริงครับ หรืออาจจะเคยมี', 'หาโมเดลนี้ไม่เจอครับ ย้ายบ้านไปแล้วมั้ง'] },
        ],
        title: 'โมเดลที่เลือกไว้ใช้ไม่ได้',
        what: 'ชื่อโมเดลที่เลือกไว้ไม่มีอยู่, ถูกเลิกให้บริการไปแล้ว, key นี้ไม่มีสิทธิ์ใช้ หรือเป็นโมเดลที่ไม่ได้ทำมาสำหรับแชท (เช่นรุ่นทดลองเฉพาะทางที่คุยต่อเนื่องหลายรอบไม่ได้) · โมเดลรุ่น preview / experimental มักถูกปิดหลังออกรุ่นจริง',
        fixes: [
            'เลือกโมเดลใหม่จากรายการใน API Connections',
            'ถ้าขึ้นว่า Multiturn chat is not enabled แปลว่าโมเดลนี้ใช้คุยต่อเนื่องไม่ได้ ให้เลือกโมเดลที่ทำมาสำหรับแชท',
            'ถ้าพิมพ์ชื่อโมเดลเอง ตรวจตัวสะกดอีกที',
        ],
        sample: { message: 'models/gemini-1.0-pro is not found for API version v1beta, or is not supported for generateContent.', title: 'Chat Completion API' },
    },
    {
        id: 'network',
        name: 'ต่อไม่ติด',
        mood: 'shocked',
        match: [
            /failed to fetch|fetch failed|network ?error|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|connection (refused|error|reset)|load failed/i,
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
            'ถ้าใช้ reverse proxy แล้วยังไม่หาย ติดต่อผู้ให้บริการ reverse proxy นั้นโดยตรง แจ้งข้อความ error กับเวลาที่เกิดไปด้วย (อย่าส่ง API key หรือรหัสผ่านไปในแชทสาธารณะ)',
        ],
        sample: { message: 'Failed to fetch', title: 'Chat Completion API' },
    },
    {
        id: 'noreply',
        name: 'ไม่ได้คำตอบจาก API',
        mood: 'confused',
        followup: true,
        match: [
            /could not get a reply/i,
        ],
        lines: [
            { from: 1, text: ['เขาไม่ตอบอะไรกลับมาเลยครับ', 'ส่งไปแล้ว… แต่ไม่มีเสียงตอบรับครับ'] },
        ],
        title: 'SillyTavern ไม่ได้คำตอบที่ใช้ได้จาก API',
        what: 'ข้อความนี้เป็นคำเตือนกว้าง ๆ ของ ST ว่าเชื่อมต่อหรือขอคำตอบไม่สำเร็จ มักขึ้นคู่กับ error อีกอันที่บอกสาเหตุจริง (เช่น Unauthorized, 503, project denied) ถ้ามี ให้ดูอันนั้นเป็นหลัก',
        fixes: [
            'ดู error อีกอันที่เด้งมาพร้อมกัน ส่วนใหญ่บอกสาเหตุได้ชัดกว่า',
            'เช็ก API key และผู้ให้บริการที่เลือกในหน้า API Connections แล้วกด Connect ใหม่',
            'เช็กอินเทอร์เน็ต และที่อยู่ reverse proxy ถ้าใช้',
            'ถ้าใช้ reverse proxy แล้วยังไม่หาย ติดต่อผู้ให้บริการ reverse proxy นั้นโดยตรง แจ้งข้อความ error กับเวลาที่เกิดไปด้วย (อย่าส่ง API key หรือรหัสผ่านไปในแชทสาธารณะ)',
        ],
        sample: { message: 'Could not get a reply from API. Check your connection settings / API key and try again.' },
    },
    {
        id: 'server',
        name: 'เซิร์ฟเวอร์ปลายทางพัง (500/502/504)',
        mood: 'shocked',
        match: [
            /internal (server )?error|bad gateway|gateway time-?out|deadline.(exceeded|expired)|timed? ?out|\b50[024]\b|provider returned error/i,
            /upstream (error|request|connect)|do request failed|bad response from upstream/i,
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
            'ข้อความแบบ upstream error มาจากเว็บตัวกลาง (proxy ที่รวม API หลายเจ้า) แปลว่าตัวกลางต่อไปหาผู้ให้บริการต้นทางไม่สำเร็จ ลองใหม่ หรือเปลี่ยนโมเดล / ช่องทางในเว็บนั้น',
            'ถ้าใช้ reverse proxy แล้วยังไม่หาย ติดต่อผู้ให้บริการ reverse proxy นั้นโดยตรง แจ้งข้อความ error กับเวลาที่เกิดไปด้วย (อย่าส่ง API key หรือรหัสผ่านไปในแชทสาธารณะ)',
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
