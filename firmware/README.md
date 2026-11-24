# เฟิร์มแวร์บอร์ด Cucumber RIS

## ติดตั้ง

1. Arduino IDE 2 → File → Preferences → Additional boards manager URLs:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. Boards Manager → ติดตั้ง **esp32 by Espressif Systems**
3. Library Manager → ติดตั้ง
   - PubSubClient
   - ArduinoJson (v7)
   - Adafruit HTS221
   - Adafruit BMP280 Library
   - Adafruit MPU6050
   - Adafruit NeoPixel

## ตั้งค่าและอัปโหลด

แก้ใน `cucumber_aiot/cucumber_aiot.ino`:

```cpp
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* DEVICE_ID     = "cucumber-group01";   // ห้ามซ้ำกับกลุ่มอื่น
```

Tools:
- Board: **ESP32S2 Dev Module**
- USB CDC On Boot: **Enabled**
- PSRAM: **Enabled**

ครั้งแรกให้เข้าโหมดอัปโหลด: กด **BOOT** ค้าง → กด **RESET** → ปล่อย BOOT → Upload → กด RESET

## ข้อมูลที่ส่ง

| Topic | ทิศทาง | ข้อมูล |
|---|---|---|
| `aiot-classroom/<DEVICE_ID>/sensors` | บอร์ด → เว็บ | `{"id","ms","temp","hum","pres","ax","ay","az"}` ทุก 2 วินาที |
| `aiot-classroom/<DEVICE_ID>/led` | เว็บ → บอร์ด | `{"r":0,"g":255,"b":0}` หรือ `"#00ff00"` |
| `aiot-classroom/<DEVICE_ID>/status` | บอร์ด → เว็บ | `online` / `offline` (Last Will) |

## สีไฟสถานะ

ส้ม = เริ่มระบบ · ฟ้ากะพริบ = ต่อ WiFi · ม่วง = ต่อ MQTT ไม่ได้ · ขาวจาง = พร้อม รอผล AI

## หมายเหตุเรื่องขา

- NeoPixel: GPIO18
- I2C: แหล่งข้อมูลระบุไม่ตรงกัน (SDA 41/SCL 40 หรือกลับกัน) โปรแกรมจะลองทั้งสองแบบโดยดูว่าเจอ HTS221 (`0x5F`) หรือ MPU-6050 (`0x68`) หรือไม่
