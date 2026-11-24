# AIoT Classroom 🌡️🤖

ชุดการเรียนรู้ **AIoT** สำหรับนักเรียนมัธยมปลาย: บอร์ด **Cucumber RIS (ESP32-S2)** วัดอุณหภูมิ/ความชื้นของห้องเรียน ส่งผ่าน **MQTT** ไปที่หน้าเว็บบน **GitHub Pages** ซึ่งรันโมเดล AI ด้วย **TensorFlow.js บนมือถือ** (เทรนบน **Google Colab**) เพื่อบอกว่าห้อง *เย็นไป / สบาย / ร้อนไป / อบชื้น* แล้วส่งสีไฟกลับไปที่ LED บนบอร์ด

```
Cucumber RIS ──MQTT──▶ broker.hivemq.com ──WebSocket──▶ Dashboard (มือถือ, TF.js)
     ▲                                                        │
     └──────────────── สีไฟ LED ตามผลของ AI ◀──────────────────┘
                         Google Colab ──model.json──▶ docs/model/
```

| ข้อกำหนดของงาน | ในโปรเจกต์นี้ |
|---|---|
| โค้ดและเอกสารบน GitHub + GitHub Pages | repo นี้ · เว็บอยู่ใน `docs/` · deploy ด้วย GitHub Actions |
| บอร์ด IoT | Cucumber RIS (HTS221, BMP280, MPU-6050, NeoPixel) |
| ส่วน AI | เทรนบน Colab → รันบนมือถือ (TensorFlow.js) · เทรนบนมือถือได้ด้วย |
| ส่วน UI | หน้าเว็บของโปรเจกต์ (Dashboard) |
| กลุ่มเป้าหมาย | นักเรียน ม.4–ม.6 · 5 บทเรียน 7 คาบ |
| ใช้ AI เป็นผู้ช่วยพัฒนา | บันทึกไว้ใน `docs/lessons.html#ai-assistant` |

## โครงสร้าง

```
firmware/cucumber_aiot/cucumber_aiot.ino   เฟิร์มแวร์ Arduino ของบอร์ด
ai/train_comfort_model.ipynb               Colab notebook: เทรน + ส่งออก TF.js
ai/make_starter_model.py                   สร้างข้อมูล/โมเดลตั้งต้น (numpy)
ai/build_notebook.py                       สร้างไฟล์ .ipynb ใหม่จากโค้ด
docs/                                      เว็บไซต์ (GitHub Pages)
  index.html        หน้าแรก
  lessons.html      บทเรียน 5 บท + rubric + แก้ปัญหา
  dashboard.html    Dashboard สด + AI + เก็บข้อมูล + เทรนบนมือถือ
  model/            โมเดล TF.js ที่หน้าเว็บโหลด (แทนที่ด้วยของ Colab ได้)
  data/             ชุดข้อมูลตั้งต้น (สังเคราะห์)
.github/workflows/pages.yml                deploy docs/ ขึ้น GitHub Pages
```

## เริ่มต้นใช้งาน

1. **ขึ้น GitHub:** สร้าง repo ชื่อ `aiot-classroom` (Public) แล้ว push โค้ดนี้
2. **เปิด Pages:** Settings → Pages → Source: **GitHub Actions** รอ workflow เสร็จ เว็บจะอยู่ที่ `https://<username>.github.io/aiot-classroom/`
3. **บอร์ด:** คัดลอก `firmware/cucumber_aiot/secrets_example.h` เป็น `secrets.h` แล้วใส่ WiFi (ไฟล์นี้ไม่ขึ้น GitHub) แก้ `DEVICE_ID` ใน `cucumber_aiot.ino` แล้วอัปโหลด (รายละเอียดใน [firmware/README.md](firmware/README.md))
4. **Dashboard:** เปิดเว็บบนมือถือ → Dashboard → ใส่ `DEVICE_ID` → เชื่อมต่อ (ไม่มีบอร์ด ใช้ "โหมดจำลอง" ได้)
5. **เทรน AI:** เก็บข้อมูลใน Dashboard → ดาวน์โหลด CSV → เปิด notebook ใน Colab → อัปโหลดโมเดลที่ได้ไปที่ `docs/model/`

ลิงก์ไป GitHub และ Colab บนหน้าเว็บจะถูกเติมอัตโนมัติจาก URL ของ GitHub Pages ไม่ต้องแก้ไฟล์เอง

## ทดสอบบนเครื่อง

```bash
python3 -m http.server 8000 --directory docs
```
แล้วเปิด http://localhost:8000/dashboard.html

## หมายเหตุ

- MQTT broker `broker.hivemq.com` เป็นแบบสาธารณะ ใครรู้ topic ก็อ่าน/เขียนได้ ใช้เพื่อการเรียนเท่านั้น
- ข้อมูลและโมเดลตั้งต้นเป็น **ข้อมูลสังเคราะห์** ที่ติดป้ายด้วยกฎง่าย ๆ ให้นักเรียนเก็บข้อมูลจริงแล้วเทรนใหม่
- แหล่งข้อมูลระบุขา I2C ของ Cucumber ไม่ตรงกัน (SDA/SCL = GPIO41/40 หรือ 40/41) เฟิร์มแวร์จึงลองทั้งสองแบบอัตโนมัติ
