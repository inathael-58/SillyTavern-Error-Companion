# Error Companion — SillyTavern extension

คอมพาเนียนจะโผล่มาบอกว่า error ที่เด้งขึ้นมาใน SillyTavern หมายถึงอะไร แบบ visual novel
เริ่มจากมุกให้หายเซ็งก่อน แล้วตามด้วยคำอธิบายจริงจังและวิธีแก้

เลือกได้ใน Extensions → Error Companion → คอมพาเนียน

| | |
|---|---|
| **ตะวัน** | พี่ชายข้างบ้าน ใจดี ลงท้าย "ครับ" |
| **mINT** | เพื่อนสาวเอไอสายไฮเทค สดใส ลงท้าย "ค่ะ" · โควตาหมด = แบตหมด, เซิร์ฟเวอร์แน่น = วงโหลดหมุน |
| **เฮงเฮง** | แมววิเชียรมาศจอมป่วน เรียกเราว่า "ทาส" ลงท้าย "เมี้ยว" · เซิร์ฟเวอร์ ST พัง = ปัดแก้วตก, ตั้งค่าผิด = นอนทับคีย์บอร์ด |
| **Seraphina** | ตัวละครเริ่มต้นของ SillyTavern ผู้พิทักษ์ป่าใจดี ลงท้าย "ค่ะ" · ใช้ภาพ Character Expressions ของ ST เอง (ขึ้นในรายการเมื่อมีโฟลเดอร์ expression ของเธอ) |
| **ตัวละครที่คุยอยู่** | เปลี่ยนตามแชตที่เปิด: ใช้ชื่อและภาพ Character Expressions ของตัวละครนั้น · บทพูดเล่าถึงตัวละคร เช่น "Seraphina สะดุ้ง: สายหลุด ติดต่อไม่ได้เลย" |

สามตัวแรกมากับ extension ส่วน Seraphina กับตัวละครที่คุยอยู่ใช้ภาพที่อยู่ใน SillyTavern อยู่แล้ว

- error แต่ละแบบจับคู่กับ expression มาตรฐาน 28 แบบ เช่น เซิร์ฟเวอร์ล่ม = `surprise`, โดนตัวกรอง = `embarrassment`, เครดิตหมด = `grief` ถ้าตัวละครไม่มี expression นั้นจะใช้ตัวถัดไปในรายการ แล้วค่อย `neutral`
- ตัวละครที่ไม่มี expression เลยจะใช้รูปการ์ดแทน · แชตกลุ่มหรือยังไม่ได้เปิดแชต = ใช้ตะวันแทน

> 503 overloaded → *"ออกไปแตะหญ้าเถอะครับ"*
> PROHIBITED_CONTENT → *"มีบาปจะสารภาพไหมครับ"*

## error ที่รู้จัก

| error | ตัวอย่างข้อความ |
|---|---|
| เชื่อมต่อเซิร์ฟเวอร์ ST ไม่ได้ / บันทึกไม่ได้ | `Settings could not be saved`, `Chat could not be saved`, `Couldn't get CSRF token` |
| นำเข้าการ์ดตัวละครไม่ได้ | `Could not import character` · `The file is likely invalid or corrupted` |
| โดนตัวกรองเนื้อหาบล็อก | `Prompt was blocked due to : PROHIBITED_CONTENT`, moderation ของ OpenRouter |
| ข้อความสุดท้ายเป็นของบอท (prefill) | `Requests ending with a model turn are not supported`, `must end with a user message` |
| ตั้งค่าที่โมเดลนี้ไม่รองรับ | `Thinking level MINIMAL is not supported for this model`, `Unsupported parameter` |
| เซิร์ฟเวอร์คนแน่น (503 / 529) | `The model is overloaded`, `high demand`, `Service Unavailable` |
| โควตาหมด / ส่งถี่เกิน (429) | `You exceeded your current quota`, `Rate limit exceeded` |
| เครดิตหมด (402) | `Insufficient credits`, `can only afford` |
| บัญชี / โปรเจกต์ถูกระงับสิทธิ์ | `Your project has been denied access`, `account has been suspended` |
| ถูกปฏิเสธการเข้าถึง (403) | `Forbidden` (มักเป็น reverse proxy: รหัสผ่าน proxy ผิด, proxy ปิดรับ / บล็อกประเทศ) |
| API key ไม่ถูกต้อง | `API key not valid`, `Unauthorized`, `No auth credentials found` |
| ประเทศไม่รองรับ | `User location is not supported` |
| prompt ยาวเกิน context | `Mandatory prompts exceed the context size`, `maximum context length` |
| ตอบกลับมาว่างเปล่า | `Candidate text empty`, `returned no candidate` |
| ใช้โมเดลนี้ไม่ได้ / ไม่พบโมเดล | `is not found for API version`, `No endpoints found`, `Multiturn chat is not enabled` |
| ต่อไม่ติด | `Failed to fetch`, `ECONNREFUSED` |
| ไม่ได้คำตอบจาก API | `Could not get a reply from API` (ถ้าเด้งคู่กับ error อื่น จะไม่บังคำอธิบายของ error นั้น) |
| เซิร์ฟเวอร์ปลายทางพัง (500 / 502 / 504) | `Internal error encountered`, `Bad Gateway`, `upstream error: do request failed` |

error จาก API ที่ยังไม่รู้จัก คอมพาเนียนจะบอกว่ายังไม่รู้จัก พร้อมข้อความต้นฉบับและปุ่มคัดลอกไปถามคนอื่น

- เจอ error เดิมซ้ำในวันเดียวกันบ่อย ๆ คอมพาเนียนจะพูดแรงขึ้นเรื่อย ๆ
- error เดิมเด้งซ้ำตอนคอมพาเนียนยังพูดอยู่ จะไม่เปิดใหม่ แต่ขึ้นตัวนับ ×2 ×3 แทน
- กล่อง error เดิมของ SillyTavern ยังขึ้นตามปกติ (ตั้งให้ซ่อนได้)

## ติดตั้ง

Extensions → Install extension → วาง URL ของ repo นี้

## ตั้งค่า

Extensions → Error Companion

| ตัวเลือก | ทำอะไร |
|---|---|
| ตอนเจอ error | **เด้งเต็มครั้งแรกของวัน ครั้งต่อไปเป็นแบบมินิ** (ค่าเริ่มต้น) · เด้งเต็มทุกครั้ง · แบบมินิทุกครั้ง |
| ซ่อนกล่อง error เดิม | เอา toast ของ SillyTavern ออกเมื่อคอมพาเนียนรู้จัก error นั้น |
| ตัวอักษรขึ้นทีละตัว | เปิด/ปิด effect พิมพ์ทีละตัว (ปิดเองถ้าตั้งเครื่องไว้ว่าลดการเคลื่อนไหว) |
| error ที่รู้จัก | ติ๊กออก = ไม่ต้องบอก error นั้น · ▶ = ลองดู · ตัวเลข = เจอวันนี้กี่ครั้ง |

ในกล่องเต็มมีปุ่ม **พัก 10 นาที** (คอมพาเนียนเงียบชั่วคราว) และ **ไม่ต้องบอก error นี้อีก**

แบบมินิ = คอมพาเนียนโผล่มุมจอพร้อมประโยคสั้น ๆ แล้วหายไปเอง แตะเพื่อดูคำอธิบายเต็ม

## สร้างคอมพาเนียนเอง

> มือใหม่เริ่มที่ **[คู่มือทำคอมพาเนียนแบบง่ายที่สุด](examples/README.md)** มีรูปประกอบทุกขั้น และตัวอย่าง "โมจิ" ให้ลองนำเข้า

Extensions → Error Companion → คอมพาเนียน

- **＋** สร้างใหม่ · **✎** แก้ไข (กดตอนเลือกตัวที่มากับ extension = สร้างตัวใหม่โดยเริ่มจากรูปและบทพูดของตัวนั้น) · **🗑** ลบ
- **ชื่อ** และ **สีป้ายชื่อ**
- **รูป** เพิ่มได้กี่รูปก็ได้ (สูงสุด 40) แต่ละรูปมีชื่อกับลิงก์
  - รูปแรก = รูปเริ่มต้นของ error ที่ไม่ได้เลือกรูป · ไม่มีรูปเลย = ใช้รูปของตะวัน (ทำแค่ชุดบทพูดก็ได้)
  - กด 📁 เพื่อเลือกรูปจากเครื่อง (รูปถูกย่อแล้วเก็บไว้ในคอมพาเนียน ติดไปกับไฟล์ที่ส่งออกด้วย ไม่ต้องฝากรูปที่ไหน)
  - หรือวางลิงก์ `https://…` หรือไฟล์ในเซิร์ฟเวอร์ ST เช่น `/characters/ชื่อ/joy.png` (รูปของ Character Expressions)
  - ภาพครึ่งตัว พื้นหลังโปร่งใส ขอบล่างตัดตรง จะดูดีที่สุด
- **ไอคอนในแบบมินิ** (วงกลมข้างฟองคำพูด)
  - เลื่อนแถบ ซ้าย↔ขวา / ขึ้น↕ลง / ซูม ให้หน้าอยู่กลางวง มีพรีวิวครบทุกรูป (ใช้ตำแหน่งเดียวกันทุกรูป)
  - หรือใส่ลิงก์ **รูปไอคอนแยก** (รูปหน้าตรง ๆ) แทนการครอป
- **error แต่ละแบบ** เลือกได้ว่าจะใช้รูปไหน และเขียนบทพูดเอง
  - บทพูดบรรทัดละประโยค สุ่มมาหนึ่งประโยค · ขึ้นต้นด้วย `[3]` = ใช้ตั้งแต่เจอครั้งที่ 3 ของวัน · `{n}` = จำนวนครั้ง · `{name}` = ชื่อคอมพาเนียน
  - ว่าง = ใช้บทของตะวัน · คำอธิบายจริงจังด้านล่างใช้ของกลางเหมือนกันทุกตัว
- **ลองดู** ได้ก่อนบันทึก

### แบ่งให้เพื่อน

- **ส่งออก** = ไฟล์ `.companion.json` · **คัดลอก** = ข้อความ JSON ไว้วางในแชท
- **นำเข้า** จากไฟล์ หรือวางข้อความในช่อง "นำเข้าจากข้อความที่คัดลอกมา"
- รูปที่เลือกด้วย 📁 ติดไปในไฟล์ด้วย ส่วนรูปที่ใส่เป็น **ลิงก์** ไฟล์จะเก็บแค่ลิงก์ ถ้าจะแชร์ให้ใช้ลิงก์ที่เปิดได้จากทุกเครื่อง ลิงก์ไฟล์ในเซิร์ฟเวอร์ ST ของเราเปิดจากเครื่องคนอื่นไม่ได้
- ตอนนำเข้า ลิงก์รูปที่ไม่ใช่ `https://`, `http://`, ที่อยู่ไฟล์ หรือรูปแบบ `data:image/…` จะไม่ถูกรับ

```json
{
  "type": "error-companion",
  "version": 2,
  "name": "พี่ฟ้า",
  "color": "#3b6ea8",
  "images": [
    { "id": "smile", "name": "ยิ้ม", "url": "https://…/smile.png" },
    { "id": "sleepy", "name": "ง่วง", "url": "https://…/sleepy.png" }
  ],
  "errorImages": { "overloaded": "sleepy", "quota": "sleepy" },
  "crop": { "x": 0.5, "y": 0.22, "size": 0.5 },
  "lines": {
    "overloaded": [
      { "from": 1, "text": ["ฟ้าบอกว่าคนเยอะจ้า"] },
      { "from": 3, "text": ["ครั้งที่ {n} แล้ว ไปนอนเถอะ"] }
    ]
  }
}
```

`errorImages` = error ไหนใช้รูปไหน (อ้างด้วย `id` ของรูป · ไม่ระบุ = รูปแรก) · `crop` = จุดที่อยู่กลางวงไอคอน (`x`, `y` เป็นสัดส่วนของความกว้าง / สูงของรูป) และ `size` = วงกว้างกี่ส่วนของความกว้างรูป (น้อย = ซูมเข้า) · ใส่ `"icon": "https://…"` เพื่อใช้รูปไอคอนแยกแทน

ไฟล์แบบเก่า (`version: 1` ที่มี `sprites` 6 ช่อง) ยังนำเข้าได้ จะถูกแปลงเป็นรูป 6 รูปตามชื่อช่องเดิมให้อัตโนมัติ

id ของ error ที่ใช้ใน `lines` และ `errorImages`: `stserver`, `import`, `blocked`, `prefill`, `param`, `overloaded`, `quota`, `credits`, `denied`, `forbidden`, `key`, `location`, `context`, `empty`, `model`, `network`, `noreply`, `server`, `unknown`

## ลองดู

- กด ▶ หน้า error ในหน้าตั้งค่า
- หรือพิมพ์ `/ec-test overloaded` ในช่องแชท (ใส่ id ของ error: `stserver`, `import`, `blocked`, `prefill`, `param`, `overloaded`, `quota`, `credits`, `denied`, `forbidden`, `key`, `location`, `context`, `empty`, `model`, `network`, `noreply`, `server`, `unknown` · ว่าง = สุ่ม)
  คำสั่งนี้สร้าง error toast จริง เลยผ่านเส้นทางเดียวกับ error จริงทุกอย่าง (และนับเป็นหนึ่งครั้งด้วย)

## สำหรับคนพัฒนา

- `errors.js` — รายการ error: regex, สีหน้า, บทพูดตามจำนวนครั้ง (ของตะวัน), คำอธิบาย, วิธีแก้, ข้อความตัวอย่าง
- `companions.js` — mINT กับเฮงเฮง: รูปของแต่ละ error, บทพูด, ตำแหน่งหน้าสำหรับไอคอนในแบบมินิ · Seraphina และบทของตัวละครที่คุยอยู่ · ตาราง error → expression (`EXPRESSION_FOR`)
- `lib.js` — จับคู่ข้อความกับ error และเลือกบทพูด (ไม่มี DOM) · ทดสอบด้วย `npm test`
- `sprites/tawan/` — ภาพตะวัน 6 สีหน้า (neutral, tired, pious, exhausted, shocked, confused) ขนาด 588×520 พื้นโปร่งใส
- `tools/slice_sheet.py` — หั่นภาพรวม 3×2 เป็น sprite: ลบหมอกพื้นหลังที่ตัวลบพื้นหลังทิ้งไว้ และจัดทุกรูปให้ตรงกัน
- `sprites/mint/` — mINT 6 รูป (happy, loading, pray, lowbatt, shocked, confused) ขนาด 837×678
- `sprites/hengheng/` — เฮงเฮง 9 รูป (smug, yawn, pray, dizzy, shocked, confused, keyboard, mischief, beg) ขนาด 780×720
- `examples/` — คู่มือทำคอมพาเนียนสำหรับมือใหม่ และตัวอย่าง "โมจิ" (`examples/mochi/`)
- `tools/key_sheet.py` — ตัดภาพรวมที่มีพื้นหลังสีเรียบ (ไม่โปร่งใส) เป็น sprite: ใช้โมเดล isnet-anime แยกตัวละคร + ตัดพื้นหลังด้วยสี สำหรับเอฟเฟกต์ลอย ๆ ลบหมอกขาวและเงาที่พื้น จัดทุกรูปให้ตรงกัน (วิธีใช้อยู่หัวไฟล์)

เจอ error ที่คอมพาเนียนยังไม่รู้จัก ส่งข้อความต้นฉบับมาได้เลย (ลบ API key ออกก่อน)
