/* AIoT Classroom Dashboard
 * IoT  : รับค่าจากบอร์ด Cucumber ผ่าน MQTT over WebSocket (หรือโหมดจำลอง)
 * AI   : TensorFlow.js ทำนาย เย็นไป/สบาย/ร้อนไป/อบชื้น จาก temp + hum
 * Loop : ส่งสีผลลัพธ์กลับไปที่ NeoPixel บนบอร์ด
 */
(() => {
  const BROKER_WSS = "wss://broker.hivemq.com:8884/mqtt";
  const TOPIC_ROOT = "aiot-classroom";
  const LABELS = ["cold", "comfy", "hot", "humid"];
  const TH = { cold: "เย็นไป", comfy: "สบาย", hot: "ร้อนไป", humid: "อบชื้น" };
  const EMOJI = { cold: "🥶", comfy: "😊", hot: "🥵", humid: "💦" };
  const LED = { cold: [0, 80, 255], comfy: [0, 255, 0], hot: [255, 0, 0], humid: [170, 0, 255] };
  const MAP = { tMin: 16, tMax: 40, hMin: 25, hMax: 100 };

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ไม่มี storage ก็ทำงานต่อได้ */ } },
  };

  // ---------------- state ----------------
  let client = null, simTimer = null;
  let model = null, meta = null, modelIsCustom = false;
  let latest = null;              // ค่าล่าสุด {temp, hum, pres, vib}
  let lastLabel = null, lastLedAt = 0;
  let currentLabel = "comfy", recording = false;
  let rows = store.get("aiot-rows", []);
  let mapImage = null;

  // ---------------- AI ----------------
  async function loadSiteModel() {
    $("modelInfo").textContent = "กำลังโหลดโมเดล…";
    try {
      const [m, mt] = await Promise.all([
        tf.loadLayersModel("model/model.json"),
        fetch("model/meta.json").then((r) => r.json()),
      ]);
      setModel(m, mt, false);
    } catch (e) {
      console.error(e);
      $("modelInfo").textContent = "โหลดโมเดลไม่สำเร็จ: " + e.message;
    }
  }

  function setModel(m, mt, custom) {
    if (model && model !== m) model.dispose();
    model = m; meta = mt; modelIsCustom = custom;
    $("modelInfo").textContent = (custom ? "ใช้โมเดลที่เทรนบนเครื่องนี้ · " : "ใช้โมเดลจากเว็บ (docs/model) · ") + (mt.source || "");
    buildMap();
    if (latest) runAI();
  }

  function predict(points) {
    // points = [[temp, hum], ...] -> array ของความน่าจะเป็น
    return tf.tidy(() => {
      const x = tf.tensor2d(points).sub(meta.mean).div(meta.std);
      return model.predict(x).arraySync();
    });
  }

  function runAI() {
    if (!model || !latest || latest.temp == null || latest.hum == null) return;
    const p = predict([[latest.temp, latest.hum]])[0];
    const idx = p.indexOf(Math.max(...p));
    const lab = meta.labels[idx];
    $("aiEmoji").textContent = EMOJI[lab] || "🤖";
    $("aiLabel").textContent = TH[lab] || lab;
    $("aiLabel").className = "ai-label c-" + lab;
    $("aiConf").textContent = `มั่นใจ ${(p[idx] * 100).toFixed(0)}% · จาก ${latest.temp.toFixed(1)} °C, ${latest.hum.toFixed(0)} %`;
    $("probs").innerHTML = meta.labels.map((l, i) =>
      `<div class="prob"><span>${TH[l] || l}</span><span class="bar"><i class="bg-${l}" style="width:${(p[i] * 100).toFixed(1)}%"></i></span><span class="pct">${(p[i] * 100).toFixed(0)}%</span></div>`
    ).join("");
    sendLed(lab);
    drawMap();
  }

  function sendLed(lab) {
    if (!client || !client.connected || !$("sendLed").checked) return;
    const now = Date.now();
    if (lab === lastLabel && now - lastLedAt < 15000) return;   // ส่งเมื่อผลเปลี่ยน หรือทุก 15 วินาที
    const [r, g, b] = LED[lab] || [255, 255, 255];
    client.publish(topic("led"), JSON.stringify({ r, g, b, label: lab }));
    lastLabel = lab; lastLedAt = now;
  }

  // ---------------- decision map ----------------
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexToRgb(hex) {
    const m = hex.replace("#", "").match(/.{2}/g);
    return m ? m.map((x) => parseInt(x, 16)) : [128, 128, 128];
  }

  function buildMap() {
    const W = 96, H = 80, pts = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      pts.push([MAP.tMin + (i + .5) / W * (MAP.tMax - MAP.tMin), MAP.hMax - (j + .5) / H * (MAP.hMax - MAP.hMin)]);
    }
    const probs = predict(pts);
    const cols = Object.fromEntries(LABELS.map((l) => [l, hexToRgb(cssVar("--" + l))]));
    const img = new ImageData(W, H);
    probs.forEach((p, k) => {
      const idx = p.indexOf(Math.max(...p));
      const c = cols[meta.labels[idx]] || [128, 128, 128];
      img.data.set([c[0], c[1], c[2], 70], k * 4);
    });
    mapImage = img;
    drawMap();
  }

  function drawMap() {
    const cv = $("map");
    const rect = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr);
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (mapImage) {
      const off = document.createElement("canvas");
      off.width = mapImage.width; off.height = mapImage.height;
      off.getContext("2d").putImageData(mapImage, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, cv.width, cv.height);
    }
    const toXY = (t, h) => [
      (t - MAP.tMin) / (MAP.tMax - MAP.tMin) * cv.width,
      (MAP.hMax - h) / (MAP.hMax - MAP.hMin) * cv.height,
    ];
    // แกน
    ctx.fillStyle = cssVar("--muted"); ctx.font = `${11 * dpr}px system-ui`;
    for (let t = 20; t <= 36; t += 4) { const [x] = toXY(t, 0); ctx.fillText(t + "°", x - 8 * dpr, cv.height - 5 * dpr); }
    for (let h = 40; h <= 90; h += 20) { const [, y] = toXY(0, h); ctx.fillText(h + "%", 4 * dpr, y + 4 * dpr); }
    // ข้อมูลที่เก็บ
    rows.slice(-400).forEach((r) => {
      const [x, y] = toXY(r.temp, r.hum);
      ctx.fillStyle = cssVar("--" + r.label);
      ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, 7); ctx.fill();
    });
    // ค่าปัจจุบัน
    if (latest && latest.temp != null) {
      const [x, y] = toXY(latest.temp, latest.hum);
      ctx.strokeStyle = cssVar("--surface"); ctx.lineWidth = 3 * dpr;
      ctx.fillStyle = cssVar("--text");
      ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  // ---------------- chart ----------------
  const chart = new Chart($("chart"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "อุณหภูมิ (°C)", data: [], borderColor: cssVar("--hot"), backgroundColor: cssVar("--hot"), yAxisID: "t", tension: .3, pointRadius: 0, borderWidth: 2 },
      { label: "ความชื้น (%)", data: [], borderColor: cssVar("--cold"), backgroundColor: cssVar("--cold"), yAxisID: "h", tension: .3, pointRadius: 0, borderWidth: 2 },
    ] },
    options: {
      animation: false, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 6, color: cssVar("--muted") }, grid: { display: false } },
        t: { position: "left", ticks: { color: cssVar("--muted") }, grid: { color: cssVar("--border") } },
        h: { position: "right", ticks: { color: cssVar("--muted") }, grid: { display: false } },
      },
      plugins: { legend: { labels: { color: cssVar("--text"), boxWidth: 12 } } },
    },
  });

  function pushChart(d) {
    const ds = chart.data;
    ds.labels.push(new Date().toLocaleTimeString("th-TH", { hour12: false }));
    ds.datasets[0].data.push(d.temp);
    ds.datasets[1].data.push(d.hum);
    if (ds.labels.length > 60) { ds.labels.shift(); ds.datasets.forEach((s) => s.data.shift()); }
    chart.update();
  }

  // ---------------- incoming data ----------------
  const fmt = (v, n) => (v == null || isNaN(v) ? "–" : Number(v).toFixed(n));

  function onReading(d) {
    if (d.ax != null) d.vib = Math.abs(Math.hypot(d.ax, d.ay, d.az) - 9.81);
    latest = d;
    $("vTemp").textContent = fmt(d.temp, 1);
    $("vHum").textContent = fmt(d.hum, 0);
    $("vPres").textContent = fmt(d.pres, 1);
    $("vVib").textContent = fmt(d.vib, 2);
    if (d.temp != null && d.hum != null) {
      pushChart(d);
      if (recording) addRow();
    }
    runAI();
  }

  // ---------------- MQTT ----------------
  const deviceId = () => $("deviceId").value.trim() || "cucumber-group01";
  const topic = (s) => `${TOPIC_ROOT}/${deviceId()}/${s}`;

  function setStatus(text, cls) { const s = $("status"); s.textContent = text; s.className = "status " + (cls || ""); }

  function connect() {
    disconnect();
    store.set("aiot-device", deviceId());
    setStatus("กำลังเชื่อมต่อ…");
    client = mqtt.connect(BROKER_WSS, { clientId: "web-" + Math.random().toString(16).slice(2, 10), reconnectPeriod: 3000 });
    client.on("connect", () => {
      setStatus("เชื่อมต่อ broker แล้ว รอข้อมูลจากบอร์ด…", "on");
      client.subscribe([topic("sensors"), topic("status")]);
      $("connectBtn").textContent = "ตัดการเชื่อมต่อ";
    });
    client.on("message", (t, payload) => {
      const msg = payload.toString();
      if (t.endsWith("/status")) {
        setStatus(msg === "online" ? "บอร์ดออนไลน์" : "บอร์ดออฟไลน์", msg === "online" ? "on" : "err");
        return;
      }
      try { onReading(JSON.parse(msg)); setStatus("รับข้อมูลจากบอร์ดอยู่", "on"); } catch (e) { console.warn("bad payload", msg); }
    });
    client.on("error", (e) => setStatus("ผิดพลาด: " + e.message, "err"));
    client.on("offline", () => setStatus("หลุดการเชื่อมต่อ กำลังลองใหม่…", "err"));
    updateHint();
  }

  function disconnect() {
    if (client) { client.end(true); client = null; }
    $("connectBtn").textContent = "เชื่อมต่อ";
    setStatus("ยังไม่เชื่อมต่อ");
  }

  function updateHint() {
    $("topicHint").innerHTML = `Topic: <code>${topic("sensors")}</code> → ต้องตรงกับ <code>DEVICE_ID</code> ในเฟิร์มแวร์`;
  }

  // ---------------- simulation ----------------
  function startSim() {
    stopSim();
    const tick = () => {
      const t = +$("simT").value, h = +$("simH").value;
      $("simTv").textContent = t.toFixed(1); $("simHv").textContent = h.toFixed(0);
      onReading({
        temp: +(t + (Math.random() - .5) * .3).toFixed(1),
        hum: +(h + (Math.random() - .5) * 1.5).toFixed(1),
        pres: +(1009 + (Math.random() - .5)).toFixed(1),
        ax: (Math.random() - .5) * .2, ay: (Math.random() - .5) * .2, az: 9.81 + (Math.random() - .5) * .2,
      });
    };
    tick();
    simTimer = setInterval(tick, 2000);
    setStatus("โหมดจำลอง", "on");
  }
  function stopSim() { if (simTimer) clearInterval(simTimer); simTimer = null; }

  function setMode(mode) {
    const sim = mode === "sim";
    $("simBox").classList.toggle("show", sim);
    $("boardBox").style.display = sim ? "none" : "";
    $("topicHint").style.display = sim ? "none" : "";
    if (sim) { disconnect(); startSim(); } else { stopSim(); setStatus("ยังไม่เชื่อมต่อ"); }
  }

  // ---------------- data collection ----------------
  function renderLabelBtns() {
    $("labelBtns").innerHTML = LABELS.map((l) =>
      `<button class="btn c-${l}" data-label="${l}" aria-pressed="${l === currentLabel}">${EMOJI[l]} ${TH[l]}</button>`).join("");
  }
  function renderCounts() {
    const c = Object.fromEntries(LABELS.map((l) => [l, 0]));
    rows.forEach((r) => { if (c[r.label] != null) c[r.label]++; });
    $("counts").innerHTML = LABELS.map((l) => `<span class="c-${l}">${TH[l]}: <b>${c[l]}</b></span>`).join("") +
      `<span class="muted">รวม ${rows.length} แถว</span>`;
  }
  function addRow() {
    if (!latest || latest.temp == null) return;
    rows.push({ time: new Date().toISOString(), temp: latest.temp, hum: latest.hum, label: currentLabel });
    store.set("aiot-rows", rows);
    renderCounts(); drawMap();
  }
  function downloadCsv() {
    const csv = "time,temp,hum,label\n" + rows.map((r) => `${r.time},${r.temp},${r.hum},${r.label}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `aiot-${deviceId()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------- train in browser ----------------
  async function trainInBrowser() {
    let data = rows.map((r) => [r.temp, r.hum, LABELS.indexOf(r.label)]);
    if ($("useStarter").checked) {
      const txt = await fetch("data/comfort_starter.csv").then((r) => r.text());
      txt.trim().split("\n").slice(1).forEach((line) => {
        const [t, h, l] = line.split(",");
        data.push([+t, +h, LABELS.indexOf(l.trim())]);
      });
    }
    data = data.filter((d) => d[2] >= 0 && !isNaN(d[0]) && !isNaN(d[1]));
    if (data.length < 10 || new Set(data.map((d) => d[2])).size < 2) {
      $("trainLog").textContent = "ข้อมูลยังน้อยเกินไป: ต้องมีอย่างน้อย 10 แถว และอย่างน้อย 2 ป้าย";
      return;
    }
    $("trainBtn").disabled = true;
    const X = data.map((d) => [d[0], d[1]]);
    const mean = [0, 1].map((k) => X.reduce((s, x) => s + x[k], 0) / X.length);
    const std = [0, 1].map((k) => Math.sqrt(X.reduce((s, x) => s + (x[k] - mean[k]) ** 2, 0) / X.length) || 1);
    const xs = tf.tensor2d(X).sub(mean).div(std);
    const ys = tf.oneHot(tf.tensor1d(data.map((d) => d[2]), "int32"), LABELS.length);

    const m = tf.sequential({ layers: [
      tf.layers.dense({ inputShape: [2], units: 16, activation: "relu" }),
      tf.layers.dense({ units: LABELS.length, activation: "softmax" }),
    ] });
    m.compile({ optimizer: tf.train.adam(0.02), loss: "categoricalCrossentropy", metrics: ["accuracy"] });

    const EPOCHS = 80;
    await m.fit(xs, ys, {
      epochs: EPOCHS, batchSize: 32, shuffle: true, validationSplit: 0.2, yieldEvery: "never",
      callbacks: { onEpochEnd: async (ep, logs) => {
        $("trainBar").style.width = ((ep + 1) / EPOCHS * 100) + "%";
        $("trainLog").textContent = `epoch ${ep + 1}/${EPOCHS} · loss ${logs.loss.toFixed(3)} · ความแม่นยำ (validation) ${(logs.val_acc * 100).toFixed(0)}%`;
        if (ep % 10 === 9) await new Promise((r) => setTimeout(r, 0));   // ให้หน้าจอได้อัปเดตแถบความคืบหน้า
      } },
    });
    xs.dispose(); ys.dispose();
    setModel(m, { features: ["temp", "hum"], mean, std, labels: LABELS, source: `เทรนในเบราว์เซอร์ (${data.length} แถว)` }, true);
    $("trainBtn").disabled = false;
  }

  // ---------------- wire up ----------------
  $("deviceId").value = store.get("aiot-device", "cucumber-group01");
  $("deviceId").addEventListener("input", updateHint);
  $("connectBtn").addEventListener("click", () => (client ? disconnect() : connect()));
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", (e) => setMode(e.target.value)));
  ["simT", "simH"].forEach((id) => $(id).addEventListener("input", () => {
    $("simTv").textContent = (+$("simT").value).toFixed(1); $("simHv").textContent = (+$("simH").value).toFixed(0);
  }));
  $("labelBtns").addEventListener("click", (e) => {
    const b = e.target.closest("[data-label]"); if (!b) return;
    currentLabel = b.dataset.label; renderLabelBtns();
  });
  $("recOnce").addEventListener("click", addRow);
  $("recToggle").addEventListener("click", () => {
    recording = !recording;
    $("recToggle").textContent = recording ? "⏸ หยุดบันทึก" : "▶ บันทึกต่อเนื่อง";
    $("recToggle").classList.toggle("primary", recording);
  });
  $("dlCsv").addEventListener("click", downloadCsv);
  $("clearData").addEventListener("click", () => {
    if (!confirm("ล้างข้อมูลที่เก็บไว้ทั้งหมดในเครื่องนี้?")) return;
    rows = []; store.set("aiot-rows", rows); renderCounts(); drawMap();
  });
  $("trainBtn").addEventListener("click", () => trainInBrowser().catch((e) => {
    $("trainLog").textContent = "เทรนไม่สำเร็จ: " + e.message; $("trainBtn").disabled = false;
  }));
  $("resetModel").addEventListener("click", loadSiteModel);
  window.addEventListener("resize", drawMap);

  $("simTv").textContent = (+$("simT").value).toFixed(1); $("simHv").textContent = (+$("simH").value).toFixed(0);
  renderLabelBtns(); renderCounts(); updateHint();
  // โมเดลเล็กมาก -> CPU backend เร็วกว่าและไม่ต้องรอ GPU
  tf.setBackend("cpu").then(loadSiteModel);
})();
