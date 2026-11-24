"""
สร้าง "ชุดข้อมูลตั้งต้น" + "โมเดลตั้งต้น" สำหรับหน้า Dashboard
---------------------------------------------------------------
ใช้แค่ numpy (ไม่ต้องลง TensorFlow) เพื่อให้หน้าเว็บมีโมเดลพร้อมใช้ตั้งแต่วันแรก
ส่วนการเรียนจริง นักเรียนจะเก็บข้อมูลของห้องตัวเองแล้วเทรนใหม่บน Google Colab
(ai/train_comfort_model.ipynb) ซึ่งให้ไฟล์ผลลัพธ์รูปแบบเดียวกับสคริปต์นี้

หมายเหตุ: ข้อมูลตั้งต้นเป็น "ข้อมูลสังเคราะห์" ที่ติดป้ายด้วยกฎง่าย ๆ
ไม่ใช่ข้อมูลวัดจริง ใช้เพื่อการสาธิตเท่านั้น

รัน:  python ai/make_starter_model.py
ผลลัพธ์:
  docs/data/comfort_starter.csv
  docs/model/model.json, docs/model/weights.bin, docs/model/meta.json
"""
import csv
import json
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = ["cold", "comfy", "hot", "humid"]
LABELS_TH = ["เย็นไป", "สบาย", "ร้อนไป", "อบชื้น"]
FEATURES = ["temp", "hum"]

rng = np.random.default_rng(42)


def rule_label(t, h):
    """กฎที่ใช้ติดป้ายข้อมูลสังเคราะห์ (ครูอาจให้นักเรียนลองแก้กฎนี้)"""
    if t < 24:
        return 0  # cold
    if t > 30:
        return 2  # hot
    if h > 70:
        return 3  # humid
    return 1      # comfy


def make_dataset(n=600):
    t = rng.uniform(18, 38, n)
    h = rng.uniform(30, 95, n)
    # ความรู้สึกของคนไม่เท่ากัน -> ใส่สัญญาณรบกวนตอนติดป้าย ทำให้ขอบเขตไม่คมเป๊ะ
    y = np.array([rule_label(a + rng.normal(0, 0.8), b + rng.normal(0, 4)) for a, b in zip(t, h)])
    return np.round(t, 1), np.round(h, 1), y


def train(X, y, hidden=16, epochs=3000, lr=0.02):
    """โครงข่ายประสาทเทียม 2 ชั้น: Dense(16, relu) -> Dense(4, softmax) เทรนด้วย Adam"""
    n_in, n_out = X.shape[1], len(LABELS)
    W1 = rng.normal(0, np.sqrt(2 / n_in), (n_in, hidden))
    b1 = np.zeros(hidden)
    W2 = rng.normal(0, np.sqrt(2 / hidden), (hidden, n_out))
    b2 = np.zeros(n_out)
    params = [W1, b1, W2, b2]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    Y = np.eye(n_out)[y]

    for ep in range(1, epochs + 1):
        z1 = X @ W1 + b1
        a1 = np.maximum(z1, 0)
        z2 = a1 @ W2 + b2
        p = np.exp(z2 - z2.max(1, keepdims=True))
        p /= p.sum(1, keepdims=True)

        d2 = (p - Y) / len(X)
        gW2 = a1.T @ d2
        gb2 = d2.sum(0)
        d1 = (d2 @ W2.T) * (z1 > 0)
        gW1 = X.T @ d1
        gb1 = d1.sum(0)

        for i, g in enumerate([gW1, gb1, gW2, gb2]):
            m[i] = 0.9 * m[i] + 0.1 * g
            v[i] = 0.999 * v[i] + 0.001 * g * g
            mh = m[i] / (1 - 0.9 ** ep)
            vh = v[i] / (1 - 0.999 ** ep)
            params[i] -= lr * mh / (np.sqrt(vh) + 1e-8)

        if ep % 500 == 0:
            loss = -np.mean(np.log(p[np.arange(len(y)), y] + 1e-9))
            acc = np.mean(p.argmax(1) == y)
            print(f"epoch {ep:4d}  loss={loss:.3f}  acc={acc:.3f}")
    return params


def dense_layer(name, units, activation, input_dim=None):
    cfg = {
        "name": name, "trainable": True, "dtype": "float32",
        "units": units, "activation": activation, "use_bias": True,
        "kernel_initializer": {"class_name": "GlorotUniform", "config": {"seed": None}},
        "bias_initializer": {"class_name": "Zeros", "config": {}},
        "kernel_regularizer": None, "bias_regularizer": None, "activity_regularizer": None,
        "kernel_constraint": None, "bias_constraint": None,
    }
    if input_dim is not None:
        cfg["batch_input_shape"] = [None, input_dim]
    return {"class_name": "Dense", "config": cfg}


def export_tfjs(params, mean, std, out_dir):
    """เขียนไฟล์ในรูปแบบ TensorFlow.js Layers model (เหมือนที่ tensorflowjs converter สร้าง)"""
    W1, b1, W2, b2 = params
    os.makedirs(out_dir, exist_ok=True)
    topology = {
        "class_name": "Sequential",
        "config": {"name": "comfort_model", "layers": [
            dense_layer("dense", W1.shape[1], "relu", input_dim=W1.shape[0]),
            dense_layer("dense_1", W2.shape[1], "softmax"),
        ]},
        "keras_version": "2.15.0", "backend": "tensorflow",
    }
    weights = [("dense/kernel", W1), ("dense/bias", b1), ("dense_1/kernel", W2), ("dense_1/bias", b2)]
    with open(os.path.join(out_dir, "weights.bin"), "wb") as f:
        for _, w in weights:
            f.write(np.asarray(w, dtype="<f4").tobytes())
    model_json = {
        "format": "layers-model",
        "generatedBy": "aiot-classroom make_starter_model.py",
        "convertedBy": None,
        "modelTopology": topology,
        "weightsManifest": [{
            "paths": ["weights.bin"],
            "weights": [{"name": n, "shape": list(w.shape), "dtype": "float32"} for n, w in weights],
        }],
    }
    with open(os.path.join(out_dir, "model.json"), "w") as f:
        json.dump(model_json, f, indent=1)
    meta = {
        "features": FEATURES, "mean": [float(x) for x in mean], "std": [float(x) for x in std],
        "labels": LABELS, "labels_th": LABELS_TH,
        "source": "starter (synthetic data)",
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


def main():
    t, h, y = make_dataset()
    data_dir = os.path.join(ROOT, "docs", "data")
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, "comfort_starter.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["temp", "hum", "label"])
        for a, b, c in zip(t, h, y):
            w.writerow([a, b, LABELS[c]])

    X = np.stack([t, h], 1)
    mean, std = X.mean(0), X.std(0)
    params = train((X - mean) / std, y)
    export_tfjs(params, mean, std, os.path.join(ROOT, "docs", "model"))
    print("saved docs/data/comfort_starter.csv and docs/model/*")


if __name__ == "__main__":
    main()
