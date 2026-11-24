/*
 * AIoT Classroom — เฟิร์มแวร์บอร์ด Cucumber RIS (ESP32-S2)
 * ------------------------------------------------------------
 * หน้าที่ของบอร์ด (ส่วน "IoT")
 *   1) อ่านค่าเซนเซอร์บนบอร์ด: HTS221 (อุณหภูมิ/ความชื้น), BMP280 (ความกดอากาศ),
 *      MPU-6050 (ความเร่ง 3 แกน)
 *   2) ส่งค่าเป็น JSON ขึ้น MQTT broker ทุก ๆ SEND_INTERVAL_MS
 *   3) รับคำสั่งสีไฟจากหน้าเว็บ (ผลการทำนายของ AI) แล้วแสดงบน NeoPixel
 *
 * ไลบรารีที่ต้องติดตั้ง (Arduino IDE > Library Manager):
 *   - PubSubClient            (Nick O'Leary)
 *   - ArduinoJson             (Benoit Blanchon) v7
 *   - Adafruit HTS221
 *   - Adafruit BMP280 Library
 *   - Adafruit MPU6050
 *   - Adafruit NeoPixel
 *
 * ตั้งค่าบอร์ด: Tools > Board > ESP32 Arduino > "ESP32S2 Dev Module"
 *   USB CDC On Boot: Enabled   (เพื่อให้ Serial Monitor ใช้ได้ผ่านพอร์ต USB)
 *   PSRAM: Enabled             (Cucumber ใช้โมดูล WROVER)
 */

#include <WiFi.h>
#include <Wire.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_HTS221.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_NeoPixel.h>

// ====== 1. แก้ค่าตรงนี้ให้ตรงกับห้องเรียนของคุณ ======
// ชื่อและรหัส WiFi อยู่ในไฟล์ secrets.h (ไฟล์นี้ไม่ถูกส่งขึ้น GitHub ตาม .gitignore)
// ครั้งแรก: คัดลอก secrets_example.h เป็น secrets.h แล้วใส่ค่าจริงในไฟล์ใหม่
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "ไม่พบ secrets.h: คัดลอก secrets_example.h เป็น secrets.h แล้วใส่ชื่อ/รหัส WiFi"
#endif

// ชื่ออุปกรณ์ต้องไม่ซ้ำกับกลุ่มอื่น เช่น "school123-group01"
// ต้องพิมพ์ชื่อเดียวกันนี้ในหน้า Dashboard
const char* DEVICE_ID     = "cucumber-group01";

// MQTT broker สาธารณะ (ฟรี ไม่ต้องสมัคร) — ข้อมูลที่ส่งจะเปิดเผยต่อสาธารณะ
const char* MQTT_HOST     = "broker.hivemq.com";
const uint16_t MQTT_PORT  = 1883;
const char* TOPIC_ROOT    = "aiot-classroom";   // หัวข้อจริง = aiot-classroom/<DEVICE_ID>/...

const unsigned long SEND_INTERVAL_MS = 2000;     // ส่งข้อมูลทุก 2 วินาที
// =====================================================

// ขาบนบอร์ด Cucumber
const int PIN_NEOPIXEL = 18;
// แหล่งข้อมูลระบุขา I2C ไม่ตรงกัน (40/41) โปรแกรมจึงลองทั้งสองแบบให้อัตโนมัติ
const int I2C_PIN_A = 41;
const int I2C_PIN_B = 40;

Adafruit_HTS221 hts;
Adafruit_BMP280 bmp;
Adafruit_MPU6050 mpu;
Adafruit_NeoPixel pixel(1, PIN_NEOPIXEL, NEO_GRB + NEO_KHZ800);

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

bool hasHTS = false, hasBMP = false, hasMPU = false;
char topicSensors[96], topicLed[96], topicStatus[96];
unsigned long lastSend = 0;

void setPixel(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

bool i2cHas(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

// เริ่ม I2C แล้วหา HTS221 (0x5F) ถ้าไม่เจอให้สลับขา SDA/SCL
void beginI2C() {
  Wire.begin(I2C_PIN_A, I2C_PIN_B);
  if (i2cHas(0x5F) || i2cHas(0x68)) {
    Serial.printf("I2C: SDA=%d SCL=%d\n", I2C_PIN_A, I2C_PIN_B);
    return;
  }
  Wire.end();
  Wire.begin(I2C_PIN_B, I2C_PIN_A);
  Serial.printf("I2C: SDA=%d SCL=%d\n", I2C_PIN_B, I2C_PIN_A);
}

void beginSensors() {
  beginI2C();

  hasHTS = hts.begin_I2C();
  hasBMP = bmp.begin(0x77) || bmp.begin(0x76);
  hasMPU = mpu.begin();

  if (hasMPU) {
    mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }
  Serial.printf("HTS221:%s  BMP280:%s  MPU6050:%s\n",
                hasHTS ? "OK" : "-", hasBMP ? "OK" : "-", hasMPU ? "OK" : "-");
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("กำลังต่อ WiFi \"%s\"", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    setPixel(0, 0, 40);   // ฟ้า = กำลังต่อ WiFi
    delay(250);
    setPixel(0, 0, 0);
    delay(250);
    Serial.print(".");
  }
  Serial.printf("\nWiFi OK, IP = %s\n", WiFi.localIP().toString().c_str());
}

// รับข้อความจากหน้าเว็บ: {"r":0,"g":255,"b":0,"label":"สบาย"} หรือ "#00ff00"
void onMessage(char* topic, byte* payload, unsigned int length) {
  String msg;
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  Serial.printf("<- %s : %s\n", topic, msg.c_str());

  if (msg.startsWith("#") && msg.length() == 7) {
    long c = strtol(msg.c_str() + 1, nullptr, 16);
    setPixel((c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF);
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, msg) == DeserializationError::Ok) {
    setPixel(doc["r"] | 0, doc["g"] | 0, doc["b"] | 0);
  }
}

void connectMQTT() {
  while (!mqtt.connected()) {
    String clientId = String(DEVICE_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    Serial.printf("กำลังต่อ MQTT %s ...", MQTT_HOST);
    // Last Will: ถ้าบอร์ดหลุด broker จะประกาศ "offline" แทนเรา
    if (mqtt.connect(clientId.c_str(), topicStatus, 0, true, "offline")) {
      Serial.println(" OK");
      mqtt.publish(topicStatus, "online", true);
      mqtt.subscribe(topicLed);
      setPixel(20, 20, 20);   // ขาวจาง = พร้อมทำงาน รอผลจาก AI
    } else {
      Serial.printf(" ไม่สำเร็จ (rc=%d) ลองใหม่ใน 3 วินาที\n", mqtt.state());
      setPixel(40, 0, 40);    // ม่วง = ต่อ MQTT ไม่ได้
      delay(3000);
    }
  }
}

void publishSensors() {
  JsonDocument doc;
  doc["id"] = DEVICE_ID;
  doc["ms"] = millis();

  if (hasHTS) {
    sensors_event_t humidity, temp;
    hts.getEvent(&humidity, &temp);
    doc["temp"] = round(temp.temperature * 10) / 10.0;
    doc["hum"]  = round(humidity.relative_humidity * 10) / 10.0;
  }
  if (hasBMP) {
    doc["pres"] = round(bmp.readPressure() / 10.0) / 10.0;   // hPa
  }
  if (hasMPU) {
    sensors_event_t a, g, t;
    mpu.getEvent(&a, &g, &t);
    doc["ax"] = round(a.acceleration.x * 100) / 100.0;   // m/s^2
    doc["ay"] = round(a.acceleration.y * 100) / 100.0;
    doc["az"] = round(a.acceleration.z * 100) / 100.0;
  }

  char buf[256];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(topicSensors, buf, n);
  Serial.printf("-> %s\n", buf);
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  pixel.begin();
  pixel.setBrightness(60);
  setPixel(40, 20, 0);   // ส้ม = กำลังเริ่มระบบ

  snprintf(topicSensors, sizeof(topicSensors), "%s/%s/sensors", TOPIC_ROOT, DEVICE_ID);
  snprintf(topicLed,     sizeof(topicLed),     "%s/%s/led",     TOPIC_ROOT, DEVICE_ID);
  snprintf(topicStatus,  sizeof(topicStatus),  "%s/%s/status",  TOPIC_ROOT, DEVICE_ID);

  beginSensors();
  connectWiFi();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);
  connectMQTT();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    publishSensors();
  }
}
