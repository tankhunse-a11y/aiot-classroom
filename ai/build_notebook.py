"""สร้างไฟล์ train_comfort_model.ipynb (Colab notebook) จากเซลล์ที่เขียนไว้ด้านล่าง
รัน:  python ai/build_notebook.py
"""
import json
import os

cells = []


def md(s):
    cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})


def code(s):
    cells.append({"cell_type": "code", "metadata": {}, "execution_count": None,
                  "outputs": [], "source": s.strip("\n")})


md("""
# 🌡️ AIoT Classroom — เทรน AI ทำนายความสบายของห้องเรียน

**เป้าหมาย:** สอนคอมพิวเตอร์ให้ดูค่า *อุณหภูมิ* และ *ความชื้น* จากบอร์ด Cucumber แล้วบอกว่าห้องตอนนี้
**เย็นไป / สบาย / ร้อนไป / อบชื้น**

ขั้นตอนใน notebook นี้ (กด ▶ ทีละเซลล์จากบนลงล่าง)
1. โหลดข้อมูล (ข้อมูลตั้งต้น หรือไฟล์ CSV ที่กลุ่มเก็บเองจากหน้า Dashboard)
2. ดูข้อมูลด้วยกราฟ
3. แบ่งข้อมูล train / test และปรับสเกล
4. สร้างและเทรนโครงข่ายประสาทเทียม (Neural Network)
5. วัดผล
6. ส่งออกโมเดลเป็น TensorFlow.js เพื่อไปรันบนมือถือ
""")

md("## 1) โหลดข้อมูล\nเลือกได้ 2 ทาง: ใช้ข้อมูลตั้งต้นจากเว็บโปรเจกต์ หรือ อัปโหลดไฟล์ CSV ของกลุ่มตัวเอง")
code("""
import pandas as pd, numpy as np, matplotlib.pyplot as plt

# ทางที่ 1: ข้อมูลตั้งต้น (ข้อมูลสังเคราะห์) — แก้ YOUR_GITHUB_USERNAME ให้เป็นชื่อบัญชี GitHub ของคุณ
DATA_URL = "https://YOUR_GITHUB_USERNAME.github.io/aiot-classroom/data/comfort_starter.csv"

# ทางที่ 2: ถ้าต้องการอัปโหลดไฟล์ของกลุ่ม ให้เปลี่ยนเป็น True แล้วรันเซลล์นี้ใหม่
UPLOAD_MY_CSV = False

if UPLOAD_MY_CSV:
    from google.colab import files
    up = files.upload()
    frames = [pd.read_csv(name) for name in up]
    df = pd.concat(frames, ignore_index=True)
elif "YOUR_GITHUB_USERNAME" not in DATA_URL:
    df = pd.read_csv(DATA_URL)
else:
    # ยังไม่ได้ตั้ง DATA_URL -> สร้างข้อมูลสังเคราะห์ด้วยกฎเดียวกับ ai/make_starter_model.py
    print("ใช้ข้อมูลสังเคราะห์ (ยังไม่ได้แก้ DATA_URL)")
    rng = np.random.default_rng(42)
    t, h = rng.uniform(18, 38, 600).round(1), rng.uniform(30, 95, 600).round(1)
    def rule(a, b):
        a, b = a + rng.normal(0, .8), b + rng.normal(0, 4)
        return "cold" if a < 24 else "hot" if a > 30 else "humid" if b > 70 else "comfy"
    df = pd.DataFrame({"temp": t, "hum": h, "label": [rule(a, b) for a, b in zip(t, h)]})

df = df[["temp", "hum", "label"]].dropna()
print("จำนวนข้อมูล:", len(df))
print(df["label"].value_counts())
df.head()
""")

md("## 2) ดูข้อมูลด้วยกราฟ\n❓ **คำถามชวนคิด:** จุดแต่ละสีอยู่กันเป็นกลุ่มไหม? ตรงไหนที่สีปนกัน และทำไมถึงปน?")
code("""
LABELS = ["cold", "comfy", "hot", "humid"]
LABELS_TH = ["เย็นไป", "สบาย", "ร้อนไป", "อบชื้น"]
COLORS = ["#3b82f6", "#22c55e", "#ef4444", "#a855f7"]

plt.figure(figsize=(6, 5))
for lab, c in zip(LABELS, COLORS):
    d = df[df.label == lab]
    plt.scatter(d.temp, d.hum, s=12, c=c, label=lab)
plt.xlabel("Temperature (°C)"); plt.ylabel("Humidity (%)"); plt.legend(); plt.grid(alpha=.3)
plt.show()
""")

md("## 3) แบ่งข้อมูลและปรับสเกล\nเก็บข้อมูล 20% ไว้ *สอบ* โมเดล (test set) โมเดลจะไม่เคยเห็นข้อมูลชุดนี้ตอนเรียน")
code("""
from sklearn.model_selection import train_test_split

X = df[["temp", "hum"]].values.astype("float32")
y = df["label"].map({l: i for i, l in enumerate(LABELS)}).values

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0, stratify=y)

# ปรับสเกล: อุณหภูมิ (~20-38) กับความชื้น (~30-95) มีช่วงต่างกันมาก
mean, std = X_train.mean(0), X_train.std(0)
norm = lambda a: (a - mean) / std
print("mean =", mean, " std =", std)
""")

md("## 4) สร้างและเทรน Neural Network\nโครงสร้าง: input 2 ค่า → ชั้นซ่อน 16 นิวรอน (ReLU) → output 4 คลาส (Softmax)\n\n🧪 **ทดลอง:** ลองเปลี่ยนจำนวนนิวรอน หรือจำนวน epochs แล้วดูว่าความแม่นยำเปลี่ยนไปอย่างไร")
code("""
import tensorflow as tf
tf.random.set_seed(0)

model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(2,)),
    tf.keras.layers.Dense(16, activation="relu", name="dense"),
    tf.keras.layers.Dense(len(LABELS), activation="softmax", name="dense_1"),
])
model.compile(optimizer=tf.keras.optimizers.Adam(0.02),
              loss="sparse_categorical_crossentropy", metrics=["accuracy"])
model.summary()

hist = model.fit(norm(X_train), y_train, validation_data=(norm(X_test), y_test),
                 epochs=150, batch_size=32, verbose=0)

plt.figure(figsize=(10, 3.5))
plt.subplot(1, 2, 1); plt.plot(hist.history["loss"], label="train"); plt.plot(hist.history["val_loss"], label="test"); plt.title("loss"); plt.legend()
plt.subplot(1, 2, 2); plt.plot(hist.history["accuracy"], label="train"); plt.plot(hist.history["val_accuracy"], label="test"); plt.title("accuracy"); plt.legend()
plt.show()
""")

md("## 5) วัดผล\nConfusion matrix บอกว่าโมเดล *สับสน* คลาสไหนกับคลาสไหน")
code("""
from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay, accuracy_score

pred = model.predict(norm(X_test), verbose=0).argmax(1)
print("ความแม่นยำบน test set = %.1f%%" % (100 * accuracy_score(y_test, pred)))
ConfusionMatrixDisplay(confusion_matrix(y_test, pred, labels=range(len(LABELS))), display_labels=LABELS).plot(cmap="Greens")
plt.show()

# แผนที่การตัดสินใจ: โมเดลแบ่งพื้นที่ temp-hum ออกเป็นโซนอย่างไร
tt, hh = np.meshgrid(np.linspace(16, 40, 200), np.linspace(25, 100, 200))
grid = np.c_[tt.ravel(), hh.ravel()].astype("float32")
zz = model.predict(norm(grid), verbose=0).argmax(1).reshape(tt.shape)
from matplotlib.colors import ListedColormap
plt.figure(figsize=(6, 5))
plt.contourf(tt, hh, zz, levels=[-.5, .5, 1.5, 2.5, 3.5], cmap=ListedColormap(COLORS), alpha=.25)
for i, c in enumerate(COLORS):
    d = X[y == i]; plt.scatter(d[:, 0], d[:, 1], s=8, c=c, label=LABELS[i])
plt.xlabel("Temperature (°C)"); plt.ylabel("Humidity (%)"); plt.legend(); plt.title("Decision regions")
plt.show()
""")

md("""
## 6) ส่งออกเป็น TensorFlow.js
เซลล์นี้สร้างไฟล์ 3 ไฟล์ แล้วดาวน์โหลดเป็น `comfort_model.zip`
- `model.json` + `weights.bin` → ตัวโมเดล
- `meta.json` → ค่า mean/std และชื่อคลาส (ต้องใช้คู่กัน)

**นำไปใช้:** แตกไฟล์ zip แล้วอัปโหลดทั้ง 3 ไฟล์ทับของเดิมในโฟลเดอร์ `docs/model/` ของ repo บน GitHub
(Add file → Upload files) รอ GitHub Pages อัปเดต 1–2 นาที แล้วเปิดหน้า Dashboard บนมือถือ

> เราเขียนไฟล์รูปแบบ TF.js เองด้วยโค้ดสั้น ๆ แทนการติดตั้ง `tensorflowjs` converter
> เพราะ converter มักชนเวอร์ชันกับ TensorFlow บน Colab
""")
code("""
import json, os, zipfile, datetime
from google.colab import files

def dense_cfg(layer, first):
    cfg = {"name": layer.name, "trainable": True, "dtype": "float32", "units": layer.units,
           "activation": layer.activation.__name__, "use_bias": True,
           "kernel_initializer": {"class_name": "GlorotUniform", "config": {"seed": None}},
           "bias_initializer": {"class_name": "Zeros", "config": {}},
           "kernel_regularizer": None, "bias_regularizer": None, "activity_regularizer": None,
           "kernel_constraint": None, "bias_constraint": None}
    if first:
        cfg["batch_input_shape"] = [None, int(layer.get_weights()[0].shape[0])]
    return {"class_name": "Dense", "config": cfg}

os.makedirs("comfort_model", exist_ok=True)
layers = [l for l in model.layers if isinstance(l, tf.keras.layers.Dense)]
manifest, blobs = [], []
for l in layers:
    k, b = l.get_weights()
    for name, w in (("kernel", k), ("bias", b)):
        manifest.append({"name": f"{l.name}/{name}", "shape": list(w.shape), "dtype": "float32"})
        blobs.append(w.astype("<f4").tobytes())

open("comfort_model/weights.bin", "wb").write(b"".join(blobs))
json.dump({"format": "layers-model", "generatedBy": "aiot-classroom colab", "convertedBy": None,
           "modelTopology": {"class_name": "Sequential", "config": {"name": "comfort_model",
               "layers": [dense_cfg(l, i == 0) for i, l in enumerate(layers)]},
               "keras_version": "2.15.0", "backend": "tensorflow"},
           "weightsManifest": [{"paths": ["weights.bin"], "weights": manifest}]},
          open("comfort_model/model.json", "w"), indent=1)
json.dump({"features": ["temp", "hum"], "mean": mean.tolist(), "std": std.tolist(),
           "labels": LABELS, "labels_th": LABELS_TH,
           "source": "colab " + datetime.date.today().isoformat() + f" ({len(df)} rows)"},
          open("comfort_model/meta.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

with zipfile.ZipFile("comfort_model.zip", "w") as z:
    for f in ("model.json", "weights.bin", "meta.json"):
        z.write(f"comfort_model/{f}", f)
files.download("comfort_model.zip")
""")

md("""
## ✅ แบบฝึกหัดท้ายบท
1. ความแม่นยำบน test set ของกลุ่มคุณเท่าไร? คลาสไหนที่โมเดลทายผิดบ่อยที่สุด
2. ถ้าเก็บข้อมูล "อบชื้น" มาน้อยมาก (เช่น 5 แถว) จะเกิดอะไรขึ้น? ลองดู
3. ถ้าจะให้ AI รู้ว่า "มีคนเปิดประตู" ควรใช้เซนเซอร์ตัวไหนบนบอร์ด Cucumber เพิ่ม?
""")

nb = {
    "nbformat": 4, "nbformat_minor": 5,
    "metadata": {"colab": {"provenance": []},
                 "kernelspec": {"name": "python3", "display_name": "Python 3"},
                 "language_info": {"name": "python"}},
    "cells": cells,
}
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "train_comfort_model.ipynb")
with open(out, "w", encoding="utf-8") as f:
    json.dump(nb, f, ensure_ascii=False, indent=1)
print("saved", out)
