# SyaCo Automated Workflows Directory

โฟลเดอร์นี้รวบรวมไฟล์ Workflow ทั้งหมดของระบบ SyaCo Automation บน n8n

---

## 📁 สรุปโครงสร้างไฟล์

```
workflows/
├── flow1-solution-discovery.json        # Flow 1: ค้นหาไอเดียโซลูชันใหม่จาก Trend เทคโนโลยี
├── flow2-content-publisher.json         # Flow 2: สร้างและเตรียมร่างคอนเทนต์ 3 แพลตฟอร์ม
├── flow3-community-lead-assistant.json  # Flow 3: ระบบคัดกรอง Lead และร่างคำตอบสำหรับ Community
├── README.md                            # คู่มือและเอกสารกำกับโฟลเดอร์ workflows
└── archive/                             # เวิร์กโฟลว์เวอร์ชันเก่า / ย้ายระบบ
    ├── flow2b-dispatch-publisher.json   # (Legacy Tree 2) แทนที่ด้วย discord-bot/flow2-publisher.js
    └── SyaCo Backlink Research v3.json  # (Legacy Duplicate) ชื่อเดิมของ Flow 3
```

---

## 🚀 รายละเอียดของแต่ละ Workflow

### 1. [Flow 1: Solution Discovery](file:///c:/Users/dYflyTaxi/Desktop/n8n-sandbox/workflows/flow1-solution-discovery.json)
* **ชื่องาน:** `SyaCo Flow 1 - Solution Discovery` (ID: `475dbc08-2252-45`)
* **Trigger:**
  * Schedule Trigger: ทุกวันจันทร์ เวลา 09:00 น.
  * Webhook Trigger: `POST /webhook/flow1-request-idea` (สำหรับสั่งรันทันทีจากปุ่มใน Discord)
* **การทำงาน:**
  1. ดึงรายการโซลูชันปัจจุบันจาก API สาธารณะ `https://www.syaco.co.th/api/solutions`
  2. ดึง RSS Feed จาก TechTalkThai และ Blognone
  3. คัดกรองหัวข้อเทคโนโลยีระดับ Enterprise B2B และส่งให้ Gemini วิเคราะห์หา Adjacent Solution
  4. บันทึกผลลัพธ์ลง PostgreSQL ตาราง `solution_suggestions` (สถานะ `pending_review`)
  5. ส่ง Card แจ้งเตือนเข้า Discord Channel พร้อมปุ่มกด Approve / Reject
* **การสร้าง Draft ขึ้นเว็บ:**
  * ดำเนินการโดย Discord Bot ผ่านโมดูล [`discord-bot/solution-draft.js`](file:///c:/Users/dYflyTaxi/Desktop/n8n-sandbox/discord-bot/solution-draft.js) โดยคำนวณ `order` อัตโนมัติ (`max(order) + 1`)

---

### 2. [Flow 2: Content Creator & Publisher](file:///c:/Users/dYflyTaxi/Desktop/n8n-sandbox/workflows/flow2-content-publisher.json)
* **ชื่องาน:** `SyaCo Flow 2 - Content Creator & Publisher` (ID: `c693e161-63c9-4a`)
* **Trigger:**
  * Schedule Trigger: ทุกวัน เวลา 08:00 น. (`triggerAtHour: 8`)
  * Webhook Trigger: `POST /webhook/flow2-run-publisher` (สำหรับสั่งรันทันที)
* **การทำงาน:**
  1. ดึงโซลูชันทั้งหมดจาก API สาธารณะ `https://www.syaco.co.th/api/solutions`
  2. โหลด `solution_id` ที่ประมวลผลแล้วจาก PostgreSQL ตาราง `processed_solutions` (พร้อม `alwaysOutputData: true`, `executeOnce: true`)
  3. กรองเฉพาะโซลูชันใหม่ที่ยังไม่เคยทำ และจำกัดไม่เกิน 3 รายการต่อรอบ (`MAX_PER_RUN = 3`)
  4. ล็อกสถานะโซลูชันเป็น `processing`
  5. เรียก Gemini AI 2 รอบคู่ขนาน:
     * **Call A:** Bluesky Post (ภาษาไทย ≤300 ตัวอักษร) + Dev.to Technical Article
     * **Call B:** Manual Long-form Article (บทความเชิงลึกสำหรับสื่อ/บล็อกองค์กร)
  6. Sanitize แท็ก และบันทึกร่างคอนเทนต์ลงตาราง `content_drafts` (สถานะ `draft`)
  7. ส่ง Card พร้อมปุ่มโพสต์เข้า Discord Channel
* **การเผยแพร่คอนเทนต์ (Option B):**
  * ปุ่ม **Publish** บน Discord Bot จัดการยิง API ตรงไปยังแต่ละแพลตฟอร์มผ่าน [`discord-bot/flow2-publisher.js`](file:///c:/Users/dYflyTaxi/Desktop/n8n-sandbox/discord-bot/flow2-publisher.js) พร้อม Transaction Lock ป้องกันการโพสต์ซ้ำ จึงตัดสายยิงกลับเข้า Webhook ใน n8n ออกทั้งหมด

---

### 3. [Flow 3: Community Lead Assistant](file:///c:/Users/dYflyTaxi/Desktop/n8n-sandbox/workflows/flow3-community-lead-assistant.json)
* **ชื่องาน:** `SyaCo Flow 3 - Community Lead Assistant` (ID: `Sg2alI4qwUwcESfL`)
* **Trigger:**
  * Webhook Trigger: `POST /webhook/answer-question`
* **การทำงาน:**
  1. ทำความสะอาดและ Normalize ลิงก์โพสต์ต้นทาง (รองรับ Pantip, Reddit, Quora, Medium ฯลฯ)
  2. ตรวจสอบ Quota ย้อนหลัง 7 วัน (จำกัดไม่เกิน 5 ลีด/สัปดาห์) และป้องกันลิงก์ซ้ำ
  3. ตอบรับ Webhook ทันที (`Respond Accepted`)
  4. ดึงรายการ Published Solutions จาก SyaCo API
  5. ใช้ Gemini ประเมินความเหมาะสม (Lead Fit Score 1-10) และร่างคำตอบเชิงวิศวกรรมที่แนบ SyaCo Solution อย่างเป็นธรรมชาติ
  6. บันทึกลงตาราง `backlink_candidates`
  7. หากคะแนนผ่านเกณฑ์ จะส่ง Card เข้า Discord เพื่อให้ทีมงาน Review ก่อนนำไปตอบ

---

## 🗄️ โฟลเดอร์ Archive (`workflows/archive/`)

* `flow2b-dispatch-publisher.json`: เดิมคือต้นที่ 2 ของ Flow 2 (Webhook `/webhook/flow2-dispatch-action`) ซึ่งถูกย้ายฟังก์ชันทั้งหมดไปรันตรงที่ Discord Bot แล้ว
* `SyaCo Backlink Research v3.json`: ไฟล์เดิมก่อนเปลี่ยนชื่อมาตรฐานเป็น `flow3-community-lead-assistant.json`
