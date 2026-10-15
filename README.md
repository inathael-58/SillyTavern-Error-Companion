# Error Companion — SillyTavern extension

**ตะวัน** พี่ชายข้างบ้าน จะโผล่มาบอกว่า error ที่เด้งขึ้นมาใน SillyTavern หมายถึงอะไร แบบ visual novel
เริ่มจากมุกให้หายเซ็งก่อน แล้วตามด้วยคำอธิบายจริงจังและวิธีแก้

> 503 overloaded → *"ออกไปแตะหญ้าเถอะครับ"*
> PROHIBITED_CONTENT → *"มีบาปจะสารภาพไหมครับ"*

## error ที่ตะวันรู้จัก

| error | ตัวอย่างข้อความ |
|---|---|
| โดนตัวกรองเนื้อหาบล็อก | `Prompt was blocked due to : PROHIBITED_CONTENT`, moderation ของ OpenRouter |
| เซิร์ฟเวอร์คนแน่น (503 / 529) | `The model is overloaded`, `high demand` |
| โควตาหมด / ส่งถี่เกิน (429) | `You exceeded your current quota`, `Rate limit exceeded` |
| เครดิตหมด (402) | `Insufficient credits`, `can only afford` |
| API key ไม่ถูกต้อง | `API key not valid`, `No auth credentials found` |
| ประเทศไม่รองรับ | `User location is not supported` |
| prompt ยาวเกิน context | `Mandatory prompts exceed the context size`, `maximum context length` |
| ตอบกลับมาว่างเปล่า | `Candidate text empty`, `returned no candidate` |
| ไม่พบโมเดล | `is not found for API version`, `No endpoints found` |
| ต่อไม่ติด | `Could not get a reply from API`, `Failed to fetch` |
| เซิร์ฟเวอร์ปลายทางพัง (500 / 502 / 504) | `Internal error encountered`, `Bad Gateway` |

error จาก API ที่ยังไม่รู้จัก ตะวันจะบอกว่ายังไม่รู้จัก พร้อมข้อความต้นฉบับและปุ่มคัดลอกไปถามคนอื่น

- เจอ error เดิมซ้ำในวันเดียวกันบ่อย ๆ ตะวันจะพูดแรงขึ้นเรื่อย ๆ
- error เดิมเด้งซ้ำตอนตะวันยังพูดอยู่ จะไม่เปิดใหม่ แต่ขึ้นตัวนับ ×2 ×3 แทน
- กล่อง error เดิมของ SillyTavern ยังขึ้นตามปกติ (ตั้งให้ซ่อนได้)

## ติดตั้ง

Extensions → Install extension → วาง URL ของ repo นี้

## ตั้งค่า

Extensions → Error Companion

| ตัวเลือก | ทำอะไร |
|---|---|
| ตอนเจอ error | **เด้งเต็มครั้งแรกของวัน ครั้งต่อไปเป็นแบบมินิ** (ค่าเริ่มต้น) · เด้งเต็มทุกครั้ง · แบบมินิทุกครั้ง |
| ซ่อนกล่อง error เดิม | เอา toast ของ SillyTavern ออกเมื่อตะวันรู้จัก error นั้น |
| ตัวอักษรขึ้นทีละตัว | เปิด/ปิด effect พิมพ์ทีละตัว (ปิดเองถ้าตั้งเครื่องไว้ว่าลดการเคลื่อนไหว) |
| error ที่ตะวันรู้จัก | ติ๊กออก = ไม่ต้องบอก error นั้น · ▶ = ลองดู · ตัวเลข = เจอวันนี้กี่ครั้ง |

ในกล่องเต็มมีปุ่ม **พัก 10 นาที** (ตะวันเงียบชั่วคราว) และ **ไม่ต้องบอก error นี้อีก**

แบบมินิ = ตะวันโผล่มุมจอพร้อมประโยคสั้น ๆ แล้วหายไปเอง แตะเพื่อดูคำอธิบายเต็ม

## ลองดู

- กด ▶ หน้า error ในหน้าตั้งค่า
- หรือพิมพ์ `/ec-test overloaded` ในช่องแชท (ใส่ id ของ error: `blocked`, `overloaded`, `quota`, `credits`, `key`, `location`, `context`, `empty`, `model`, `network`, `server`, `unknown` · ว่าง = สุ่ม)
  คำสั่งนี้สร้าง error toast จริง เลยผ่านเส้นทางเดียวกับ error จริงทุกอย่าง (และนับเป็นหนึ่งครั้งด้วย)

## สำหรับคนพัฒนา

- `errors.js` — รายการ error: regex, สีหน้า, บทพูดตามจำนวนครั้ง, คำอธิบาย, วิธีแก้, ข้อความตัวอย่าง
- `lib.js` — จับคู่ข้อความกับ error และเลือกบทพูด (ไม่มี DOM) · ทดสอบด้วย `npm test`
- `sprites/tawan/` — ภาพตะวัน 6 สีหน้า (neutral, tired, pious, exhausted, shocked, confused) ขนาด 588×520 พื้นโปร่งใส
- `tools/slice_sheet.py` — หั่นภาพรวม 3×2 เป็น sprite: ลบหมอกพื้นหลังที่ตัวลบพื้นหลังทิ้งไว้ และจัดทุกรูปให้ตรงกัน

เจอ error ที่ตะวันยังไม่รู้จัก ส่งข้อความต้นฉบับมาได้เลย (ลบ API key ออกก่อน)
