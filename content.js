/* AI Studio TTS Batch — content script
 * Tách file .txt theo dấu "---", lần lượt:
 *   điền đoạn -> Run -> chờ audio xong -> tải về -> (chờ xác nhận) -> đoạn kế.
 */
(() => {
  "use strict";
  if (window.__ttsbLoaded) return;
  window.__ttsbLoaded = true;

  // ---------- Cấu hình mặc định (có thể chỉnh trong panel > Nâng cao) ----------
  const DEFAULTS = {
    // CSS selector cho ô nhập lời. Để trống = tự dò theo placeholder.
    speechSelector: "",
    // CSS selector cho nút Run. Để trống = tự dò theo text/aria.
    runSelector: "",
    // CSS selector cho nút Download của AI Studio. Để trống = tự dò.
    downloadSelector: "",
    maxWaitSec: 240, // thời gian tối đa chờ tạo audio
    filePrefix: "", // trống = tên file chỉ là số thứ tự (1, 2, 3...)
    autoConfirm: false, // false = chạy tự động hết, không dừng giữa các đoạn
    useNativeDownload: false, // false = tự fetch blob để đặt tên theo số thứ tự
    voice: "", // tên giọng muốn dùng (trống = giữ nguyên giọng đang chọn trên trang)
    reapplyVoice: false, // đặt lại giọng trước mỗi đoạn (đảm bảo tuyệt đối đồng nhất)
    persona: "", // mô tả phong cách giọng (Audio Profile) — trống = không đụng tới
  };

  // Danh sách giọng Gemini TTS (⭐ = hợp nội dung trầm lắng / chữa lành)
  const VOICES = [
    ["", "— Giữ nguyên giọng trên trang —"],
    ["Vindemiatrix", "⭐ Vindemiatrix — Dịu dàng"],
    ["Sulafat", "⭐ Sulafat — Ấm áp"],
    ["Achernar", "⭐ Achernar — Êm, nhẹ"],
    ["Enceladus", "⭐ Enceladus — Thì thầm, có hơi thở"],
    ["Charon", "⭐ Charon — Trầm, rõ ràng"],
    ["Algieba", "⭐ Algieba — Mượt mà"],
    ["Gacrux", "⭐ Gacrux — Trầm chín, từng trải"],
    ["Iapetus", "⭐ Iapetus — Trong trẻo"],
    ["Zephyr", "Zephyr — Sáng, cao"],
    ["Puck", "Puck — Tươi vui"],
    ["Kore", "Kore — Chắc chắn"],
    ["Fenrir", "Fenrir — Hào hứng"],
    ["Leda", "Leda — Trẻ trung"],
    ["Orus", "Orus — Chắc, trầm"],
    ["Aoede", "Aoede — Nhẹ nhàng, thoáng"],
    ["Callirrhoe", "Callirrhoe — Thoải mái"],
    ["Autonoe", "Autonoe — Sáng"],
    ["Umbriel", "Umbriel — Dễ chịu"],
    ["Despina", "Despina — Mượt"],
    ["Erinome", "Erinome — Trong"],
    ["Algenib", "Algenib — Khàn ấm"],
    ["Rasalgethi", "Rasalgethi — Rõ, nhiều thông tin"],
    ["Laomedeia", "Laomedeia — Lạc quan"],
    ["Alnilam", "Alnilam — Chắc"],
    ["Schedar", "Schedar — Đều, ổn"],
    ["Pulcherrima", "Pulcherrima — Hướng tới trước"],
    ["Achird", "Achird — Thân thiện"],
    ["Zubenelgenubi", "Zubenelgenubi — Đời thường"],
    ["Sadachbia", "Sadachbia — Sống động"],
    ["Sadaltager", "Sadaltager — Hiểu biết"],
  ];
  const CFG_VERSION = 2; // tăng khi đổi hành vi mặc định để reset cấu hình cũ
  let cfg = loadCfg();

  // ---------- State ----------
  const S = {
    segments: [],
    index: 0,
    running: false,
    paused: false,
    awaitingConfirm: false,
    fileName: "",
  };

  // ---------- Build panel UI ----------
  const panel = document.createElement("div");
  panel.id = "ttsb-panel";
  panel.innerHTML = `
    <div id="ttsb-header">
      <span class="ttsb-dot"></span>
      <span class="ttsb-title">AI Studio TTS Batch</span>
      <button id="ttsb-min" title="Thu gọn/Mở">▁</button>
    </div>
    <div id="ttsb-body">
      <div class="ttsb-row">
        <button class="ttsb-btn" id="ttsb-pick">📄 Chọn file .txt</button>
        <input type="file" id="ttsb-file" accept=".txt,.md,text/plain" />
      </div>
      <div class="ttsb-progress">
        <span id="ttsb-filename">Chưa nạp file</span> ·
        Đoạn <span id="ttsb-counter">0 / 0</span>
      </div>

      <div>
        <div class="ttsb-label">Giọng đọc (đồng nhất cả video)</div>
        <div class="ttsb-row">
          <select id="ttsb-voice" class="ttsb-select"></select>
          <button class="ttsb-btn small" id="ttsb-applyvoice">Áp dụng</button>
        </div>
        <label class="ttsb-check" style="margin-top:6px">
          <input type="checkbox" id="ttsb-reapply"> Đặt lại giọng trước mỗi đoạn (chắc chắn đồng nhất)
        </label>
        <div class="ttsb-field" style="margin-top:6px">
          <span class="ttsb-label">Phong cách giọng (persona) — tùy chọn</span>
          <input type="text" id="ttsb-persona" class="ttsb-select"
            placeholder="vd: trầm ấm, chậm rãi, nhẹ nhàng, chữa lành">
        </div>
      </div>

      <div>
        <div class="ttsb-label">Đoạn hiện tại (có thể sửa trước khi gửi)</div>
        <textarea id="ttsb-current" placeholder="Nội dung đoạn sẽ hiện ở đây..."></textarea>
      </div>

      <div class="ttsb-row wrap">
        <button class="ttsb-btn primary" id="ttsb-start">▶ Bắt đầu</button>
        <button class="ttsb-btn" id="ttsb-next" disabled>⏭ Tiếp</button>
        <button class="ttsb-btn danger" id="ttsb-stop" disabled>⏹ Dừng</button>
      </div>
      <div class="ttsb-row wrap">
        <button class="ttsb-btn small" id="ttsb-fillonly">Chỉ điền</button>
        <button class="ttsb-btn small" id="ttsb-run">Run</button>
        <button class="ttsb-btn small" id="ttsb-dl">Tải audio</button>
        <button class="ttsb-btn small" id="ttsb-prev">◀ Lùi</button>
      </div>

      <label class="ttsb-check">
        <input type="checkbox" id="ttsb-autoconfirm"> Dừng chờ xác nhận giữa các đoạn
      </label>

      <details class="ttsb-adv">
        <summary>⚙ Nâng cao (selector & tùy chọn)</summary>
        <div class="ttsb-field">
          <span class="ttsb-label">Selector ô nhập lời (trống = tự dò)</span>
          <input type="text" id="ttsb-sel-speech" placeholder="vd: textarea[placeholder*='tags']">
        </div>
        <div class="ttsb-field">
          <span class="ttsb-label">Selector nút Run (trống = tự dò)</span>
          <input type="text" id="ttsb-sel-run" placeholder="vd: button[aria-label*='Run']">
        </div>
        <div class="ttsb-field">
          <span class="ttsb-label">Selector nút Download (trống = tự dò)</span>
          <input type="text" id="ttsb-sel-dl" placeholder="vd: button[aria-label*='Download']">
        </div>
        <div class="ttsb-field">
          <span class="ttsb-label">Thời gian chờ tối đa (giây)</span>
          <input type="number" id="ttsb-maxwait" min="10" max="900">
        </div>
        <div class="ttsb-field">
          <span class="ttsb-label">Tiền tố tên file tải về</span>
          <input type="text" id="ttsb-prefix">
        </div>
        <label class="ttsb-check" style="margin-top:8px">
          <input type="checkbox" id="ttsb-nativedl"> Tải bằng nút Download của AI Studio (bỏ chọn = tự fetch blob)
        </label>
        <div class="ttsb-row" style="margin-top:8px">
          <button class="ttsb-btn small" id="ttsb-test-speech">Test ô lời</button>
          <button class="ttsb-btn small" id="ttsb-test-run">Test nút Run</button>
          <button class="ttsb-btn small" id="ttsb-test-dl">Test Download</button>
        </div>
        <p class="ttsb-hint">Mẹo: nếu tự dò sai, mở DevTools chọn phần tử rồi dán CSS selector vào đây.</p>
      </details>

      <div>
        <div class="ttsb-label">Nhật ký</div>
        <div id="ttsb-log"></div>
      </div>
    </div>
  `;
  document.documentElement.appendChild(panel);

  const $ = (id) => panel.querySelector(id);
  const el = {
    body: $("#ttsb-body"),
    min: $("#ttsb-min"),
    header: $("#ttsb-header"),
    pick: $("#ttsb-pick"),
    file: $("#ttsb-file"),
    filename: $("#ttsb-filename"),
    counter: $("#ttsb-counter"),
    voice: $("#ttsb-voice"),
    applyvoice: $("#ttsb-applyvoice"),
    reapply: $("#ttsb-reapply"),
    persona: $("#ttsb-persona"),
    current: $("#ttsb-current"),
    start: $("#ttsb-start"),
    next: $("#ttsb-next"),
    stop: $("#ttsb-stop"),
    fillonly: $("#ttsb-fillonly"),
    run: $("#ttsb-run"),
    dl: $("#ttsb-dl"),
    prev: $("#ttsb-prev"),
    autoconfirm: $("#ttsb-autoconfirm"),
    selSpeech: $("#ttsb-sel-speech"),
    selRun: $("#ttsb-sel-run"),
    selDl: $("#ttsb-sel-dl"),
    maxwait: $("#ttsb-maxwait"),
    prefix: $("#ttsb-prefix"),
    nativedl: $("#ttsb-nativedl"),
    testSpeech: $("#ttsb-test-speech"),
    testRun: $("#ttsb-test-run"),
    testDl: $("#ttsb-test-dl"),
    log: $("#ttsb-log"),
  };

  // Đổ danh sách giọng vào dropdown
  for (const [val, label] of VOICES) {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = label;
    el.voice.appendChild(opt);
  }
  el.voice.value = cfg.voice;
  el.reapply.checked = cfg.reapplyVoice;
  el.persona.value = cfg.persona;

  // Hydrate settings vào UI
  el.selSpeech.value = cfg.speechSelector;
  el.selRun.value = cfg.runSelector;
  el.selDl.value = cfg.downloadSelector;
  el.maxwait.value = cfg.maxWaitSec;
  el.prefix.value = cfg.filePrefix;
  el.autoconfirm.checked = cfg.autoConfirm;
  el.nativedl.checked = cfg.useNativeDownload;

  // ---------- Logging ----------
  function log(msg, kind) {
    const line = document.createElement("div");
    if (kind) line.className = "ttsb-log-" + kind;
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, "0");
    const mm = String(t.getMinutes()).padStart(2, "0");
    const ss = String(t.getSeconds()).padStart(2, "0");
    line.textContent = `[${hh}:${mm}:${ss}] ${msg}`;
    el.log.appendChild(line);
    el.log.scrollTop = el.log.scrollHeight;
  }

  // ---------- Cấu hình lưu/đọc ----------
  function loadCfg() {
    try {
      const raw = localStorage.getItem("ttsb-cfg");
      if (!raw) return { ...DEFAULTS, __v: CFG_VERSION };
      const stored = JSON.parse(raw);
      const merged = { ...DEFAULTS, ...stored };
      if (stored.__v !== CFG_VERSION) {
        // phiên bản cũ: ép lại các cờ hành vi về mặc định mới (auto chạy hết, đặt tên số)
        merged.autoConfirm = DEFAULTS.autoConfirm;
        merged.useNativeDownload = DEFAULTS.useNativeDownload;
        merged.filePrefix = DEFAULTS.filePrefix;
        merged.__v = CFG_VERSION;
      }
      return merged;
    } catch {
      return { ...DEFAULTS, __v: CFG_VERSION };
    }
  }
  function saveCfg() {
    cfg.speechSelector = el.selSpeech.value.trim();
    cfg.runSelector = el.selRun.value.trim();
    cfg.downloadSelector = el.selDl.value.trim();
    cfg.maxWaitSec = clampNum(parseInt(el.maxwait.value, 10), 10, 900, 240);
    cfg.filePrefix = (el.prefix.value.trim() || "tts").replace(/[^\w\-]+/g, "_");
    cfg.autoConfirm = el.autoconfirm.checked;
    cfg.useNativeDownload = el.nativedl.checked;
    cfg.voice = el.voice.value;
    cfg.reapplyVoice = el.reapply.checked;
    cfg.persona = el.persona.value.trim();
    try { localStorage.setItem("ttsb-cfg", JSON.stringify(cfg)); } catch {}
  }
  function clampNum(n, lo, hi, def) {
    if (!Number.isFinite(n)) return def;
    return Math.min(hi, Math.max(lo, n));
  }
  [el.selSpeech, el.selRun, el.selDl, el.maxwait, el.prefix, el.autoconfirm, el.nativedl, el.voice, el.reapply, el.persona]
    .forEach((node) => node.addEventListener("change", saveCfg));

  // ---------- Tách đoạn ----------
  function parseSegments(text) {
    // tách theo dòng chỉ chứa --- (cho phép khoảng trắng)
    const parts = text.split(/\r?\n[ \t]*-{3,}[ \t]*\r?\n/);
    return parts
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }

  // ---------- Tìm phần tử trên trang ----------
  function isVisible(node) {
    if (!node) return false;
    const r = node.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const st = getComputedStyle(node);
    return st.display !== "none" && st.visibility !== "hidden";
  }

  // Selector "biết trước" theo markup thực tế của ô nhập lời (speech block)
  const SPEECH_SELECTORS = [
    "ms-autosize-textarea.text-block textarea",
    "textarea[aria-label='Speech block text']",
    ".speech-block-card textarea",
    "ms-autosize-textarea textarea",
  ];

  function findSpeechInput() {
    if (cfg.speechSelector) {
      const n = document.querySelector(cfg.speechSelector);
      if (n) return n;
      log("Không thấy phần tử khớp selector ô lời đã đặt.", "warn");
    }
    for (const sel of SPEECH_SELECTORS) {
      try {
        const n = document.querySelector(sel);
        if (n && isVisible(n)) return n;
      } catch { /* selector lỗi thì bỏ qua */ }
    }
    const candidates = [
      ...document.querySelectorAll(
        "textarea, [contenteditable='true'], [contenteditable='']"
      ),
    ].filter(isVisible);
    // Ưu tiên theo placeholder/aria gợi ý ô nhập lời (tránh nhầm ô Scene/Context)
    const hintRe = /\[|tags|amused|laughs|speech|spoken|dialog/i;
    const avoidRe = /scene|context|search|prompt to/i;
    let best = candidates.find((n) => {
      const ph = (n.getAttribute("placeholder") || n.getAttribute("aria-label") || n.dataset?.placeholder || "").toString();
      return hintRe.test(ph) && !avoidRe.test(ph);
    });
    if (best) return best;
    // fallback: textarea lớn nhất không phải Scene/Context
    const tas = candidates.filter((n) => {
      const ph = (n.getAttribute("placeholder") || n.getAttribute("aria-label") || "").toString();
      return !avoidRe.test(ph);
    });
    if (tas.length) {
      tas.sort((a, b) => area(b) - area(a));
      return tas[0];
    }
    return candidates[0] || null;
  }
  function area(n) { const r = n.getBoundingClientRect(); return r.width * r.height; }

  function findButtonByText(reList, opts = {}) {
    const nodes = [...document.querySelectorAll("button, [role='button'], a")].filter(isVisible);
    for (const re of reList) {
      const hit = nodes.find((n) => {
        const txt = (n.innerText || n.textContent || "").trim();
        const aria = (n.getAttribute("aria-label") || n.getAttribute("title") || "").trim();
        const match = re.test(txt) || re.test(aria);
        if (!match) return false;
        if (opts.enabledOnly && (n.disabled || n.getAttribute("aria-disabled") === "true")) return false;
        return true;
      });
      if (hit) return hit;
    }
    return null;
  }

  // Selector "biết trước" theo markup thực tế của AI Studio Generate Speech
  const RUN_SELECTORS = [
    "button[type='submit']:has(.run-button-label)",
    "button.ms-button-primary[type='submit']",
    "button.ctrl-enter-submits",
    "button:has(.run-button-label)",
    "run-button button",
  ];

  function findRunButton() {
    if (cfg.runSelector) {
      const n = document.querySelector(cfg.runSelector);
      if (n) return n;
    }
    for (const sel of RUN_SELECTORS) {
      try {
        const n = document.querySelector(sel);
        if (n && isVisible(n)) return n;
      } catch { /* :has có thể chưa hỗ trợ ở vài bản cũ */ }
    }
    // dò theo nhãn nút (innerText kiểu "Run Ctrl keyboard_return")
    return findButtonByText([/(^|\s)run(\s|$)/i, /generate/i, /^create$/i]);
  }

  // Selector "biết trước" theo markup thực tế của nút Download
  const DOWNLOAD_SELECTORS = [
    "button.download-button[aria-label='Download']",
    "button.download-button",
    "button[aria-label='Download']",
    "button[mattooltip='Download']",
  ];

  function findDownloadButton() {
    if (cfg.downloadSelector) {
      const n = document.querySelector(cfg.downloadSelector);
      if (n) return n;
    }
    for (const sel of DOWNLOAD_SELECTORS) {
      try {
        const n = document.querySelector(sel);
        if (n && isVisible(n)) return n;
      } catch {}
    }
    // material icon ligature thường là chữ "download"; cũng thử aria/title
    return findButtonByText([/^download$/i, /download/i, /^tải/i, /tải xuống/i, /save audio/i]);
  }

  // Liệt kê các nút Download đang hiển thị và bấm được
  function listDownloadButtons() {
    const out = [];
    const seen = new Set();
    for (const sel of DOWNLOAD_SELECTORS) {
      let nodes = [];
      try { nodes = [...document.querySelectorAll(sel)]; } catch {}
      for (const n of nodes) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (isVisible(n) && n.getAttribute("aria-disabled") !== "true" && !n.disabled) out.push(n);
      }
    }
    return out;
  }

  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const r = fn();
      if (r) return r;
      await new Promise((res) => setTimeout(res, 200));
    }
    return null;
  }

  // ---------- Điền giá trị vào textarea/contenteditable (dùng chung) ----------
  function applyValue(node, text) {
    node.focus();
    const tag = node.tagName.toLowerCase();
    if (tag === "textarea" || tag === "input") {
      const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(node, "");
      node.dispatchEvent(new Event("input", { bubbles: true }));
      setter.call(node, text);
      node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand("delete", false); } catch {}
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, text); } catch {}
      if (!inserted) {
        node.textContent = text;
        node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      }
    }
  }

  // ---------- Chọn giọng (theo DOM thực: .voice-card[data-voice-name]) ----------
  function findVoiceChip() {
    let chip = document.querySelector("button.voice-chip");
    if (chip && isVisible(chip)) return chip;
    return findButtonByText([/speaker\s*\d/i, /\bvoice\b/i]);
  }
  function findVoiceCard(name) {
    try {
      const card = document.querySelector(`.voice-card[data-voice-name="${CSS.escape(name)}"]`);
      if (card) return card;
    } catch {}
    // fallback theo aria-label/nội dung nút
    const btns = [...document.querySelectorAll(".voice-card .voice-card-content, .voice-card button")];
    return btns.find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(name))?.closest(".voice-card") || null;
  }
  function isDialogOpen() {
    return !!document.querySelector("ms-speaker-settings-panel, .voice-list");
  }
  function closeVoiceDialog() {
    const close = document.querySelector(
      "button[mat-dialog-close], button[data-test-close-button], button[aria-label='Close panel']"
    );
    if (close) { close.click(); return; }
    const bd = document.querySelector(".cdk-overlay-backdrop");
    if (bd) { try { bd.click(); } catch {} }
  }
  async function openVoiceDialog() {
    if (isDialogOpen()) return true;
    const chip = findVoiceChip();
    if (!chip) { log("✗ Không thấy chip chọn giọng (Speaker).", "err"); return false; }
    chip.click();
    return !!(await waitFor(isDialogOpen, 3000));
  }
  function fillPersona() {
    if (!cfg.persona) return;
    const ta = document.querySelector(
      "ms-speaker-settings-panel .audio-profile-section textarea, textarea[placeholder*='voice persona']"
    );
    if (ta) {
      applyValue(ta, cfg.persona);
      log(`✓ Đã đặt phong cách (persona): "${cfg.persona.slice(0, 40)}..."`, "ok");
    } else {
      log("Không thấy ô Audio Profile để đặt persona.", "warn");
    }
  }
  async function selectVoice(name) {
    if (!name && !cfg.persona) return true;
    // Bỏ qua nếu chip đã đúng giọng và không cần đặt persona
    const chip = findVoiceChip();
    const cur = chip ? (chip.innerText || chip.textContent || "").trim() : "";
    const already = name && new RegExp("(^|[^a-z])" + name + "([^a-z]|$)", "i").test(cur);
    if (already && !cfg.persona) { log(`Giọng đã là ${name}, bỏ qua.`); return true; }

    const opened = await openVoiceDialog();
    if (!opened) return false;
    await delay(250);

    if (cfg.persona) fillPersona();

    if (name && !already) {
      const card = await waitFor(() => findVoiceCard(name), 3000);
      if (!card) {
        log(`✗ Không tìm thấy giọng "${name}" trong bảng.`, "err");
        closeVoiceDialog();
        return false;
      }
      const btn = card.querySelector(".voice-card-content") || card.querySelector("button") || card;
      btn.click();
      await delay(300);
      log(`✓ Đã chọn giọng ${name}.`, "ok");
    }

    await delay(200);
    closeVoiceDialog();
    await delay(200);
    return true;
  }

  // ---------- Điền lời ----------
  function fillSpeech(text) {
    const node = findSpeechInput();
    if (!node) { log("✗ Không tìm thấy ô nhập lời.", "err"); return false; }
    applyValue(node, text);
    log(`✓ Đã điền đoạn (${text.length} ký tự) vào: ${describe(node)}`, "ok");
    return true;
  }
  function describe(n) {
    if (!n) return "(null)";
    const ph = n.getAttribute("placeholder") || n.getAttribute("aria-label") || "";
    return `${n.tagName.toLowerCase()}${ph ? ` "${ph.slice(0, 24)}"` : ""}`;
  }

  // ---------- Click Run ----------
  function clickRun() {
    const btn = findRunButton();
    if (btn) {
      btn.click();
      log(`▶ Đã bấm Run: ${describe(btn)}`, "ok");
      return true;
    }
    // fallback: Ctrl+Enter trên ô lời
    const node = findSpeechInput();
    if (node) {
      node.focus();
      const ev = (type) => node.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13,
        ctrlKey: true, bubbles: true, cancelable: true,
      }));
      ev("keydown"); ev("keyup");
      log("▶ Không thấy nút Run — đã thử Ctrl+Enter.", "warn");
      return true;
    }
    log("✗ Không tìm thấy nút Run lẫn ô lời.", "err");
    return false;
  }

  // ---------- Liệt kê audio hiện có ----------
  function listAudioSrcs() {
    const set = new Set();
    document.querySelectorAll("audio").forEach((a) => {
      const s = a.currentSrc || a.src;
      if (s) set.add(s);
      a.querySelectorAll("source").forEach((src) => { if (src.src) set.add(src.src); });
    });
    return set;
  }

  function isRunBusy() {
    const btn = findRunButton();
    if (!btn) return false;
    const label = (btn.innerText || btn.textContent || "").toLowerCase();
    // khi đang tạo, nút thường đổi thành Stop / hoặc bị disable
    if (btn.getAttribute("aria-disabled") === "true" || btn.disabled) return true;
    if (/stop|cancel|dừng/.test(label)) return true;
    if (btn.querySelector(".stoppable, .spinner, mat-progress-spinner, mat-spinner")) return true;
    return false;
  }

  // Trạng thái trước khi bấm Run
  function snapshotBefore() {
    return { audio: listAudioSrcs(), dlCount: listDownloadButtons().length };
  }

  // ---------- Chờ tạo xong (đa tín hiệu) ----------
  function waitForGeneration(before) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const start = Date.now();
    return (async () => {
      const deadline = start + cfg.maxWaitSec * 1000;
      let sawBusy = false;
      let stableCount = 0, lastSignal = "";
      let lastLog = -5;
      while (Date.now() < deadline) {
        if (!S.running) return null;
        const elapsed = Math.round((Date.now() - start) / 1000);
        const audioNow = listAudioSrcs();
        const freshAudio = [...audioNow].filter((s) => !before.audio.has(s));
        const dlNow = listDownloadButtons();
        const busy = isRunBusy();
        if (busy) sawBusy = true;

        // tín hiệu hoàn thành
        let signal = "";
        if (freshAudio.length) signal = "audio:" + freshAudio[freshAudio.length - 1];
        else if (dlNow.length > before.dlCount) signal = "dl+";
        else if (sawBusy && !busy && dlNow.length > 0) signal = "run-idle";

        if (signal) {
          if (signal === lastSignal) {
            stableCount++;
            if (stableCount >= 2) {
              return { audio: freshAudio[freshAudio.length - 1] || null, dl: dlNow[dlNow.length - 1] || findDownloadButton() };
            }
          } else { lastSignal = signal; stableCount = 0; }
        }

        if (elapsed - lastLog >= 5) {
          log(`⏳ chờ tạo... ${elapsed}s (audio:${audioNow.size}, nút tải:${dlNow.length}, đang chạy:${busy ? "có" : "không"})`);
          lastLog = elapsed;
        }
        await sleep(1000);
      }
      return null;
    })();
  }

  // ---------- Tải audio ----------
  async function downloadCurrent(name) {
    if (cfg.useNativeDownload) {
      const btn = findDownloadButton();
      if (btn) {
        btn.click();
        log(`⬇ Đã bấm nút Download của AI Studio (${describe(btn)}). File vào thư mục Tải xuống.`, "ok");
        return true;
      }
      log("Không thấy nút Download — chuyển sang tự fetch blob.", "warn");
    }
    // tự fetch blob từ <audio>
    const audios = [...document.querySelectorAll("audio")].filter((a) => a.currentSrc || a.src);
    if (!audios.length) {
      // không có <audio> -> dùng nút Download của trang (tên file do trang đặt)
      const btn = findDownloadButton();
      if (btn) {
        btn.click();
        log("⬇ Không thấy <audio> để đặt tên số — đã bấm nút Download của AI Studio (tên file do trang đặt).", "warn");
        return true;
      }
      log("✗ Không thấy <audio> lẫn nút Download để tải.", "err");
      return false;
    }
    const a = audios[audios.length - 1];
    const src = a.currentSrc || a.src;
    try {
      const resp = await fetch(src);
      const blob = await resp.blob();
      const ext = blob.type.includes("mpeg") ? "mp3"
        : blob.type.includes("wav") ? "wav"
        : blob.type.includes("ogg") ? "ogg"
        : blob.type.includes("mp4") || blob.type.includes("aac") ? "m4a"
        : "wav";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name}.${ext}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      log(`⬇ Đã tải ${name}.${ext} (${Math.round(blob.size / 1024)} KB).`, "ok");
      return true;
    } catch (e) {
      log(`Lỗi fetch blob (${e.message}) — thử bấm nút Download của AI Studio.`, "warn");
      const btn = findDownloadButton();
      if (btn) {
        btn.click();
        log("⬇ Đã bấm nút Download của AI Studio (tên file do trang đặt).", "ok");
        return true;
      }
      log("✗ Không tải được audio: vừa fetch lỗi vừa không thấy nút Download.", "err");
      return false;
    }
  }

  // Tên file tải về: chỉ số thứ tự tăng dần (1, 2, 3...). Có tiền tố thì "tiente_1".
  function makeName(i) {
    const n = String(i + 1);
    return cfg.filePrefix ? `${cfg.filePrefix}_${n}` : n;
  }

  // ---------- Vòng xử lý 1 đoạn ----------
  async function processSegment() {
    if (!S.running) return;
    const text = el.current.value.trim();
    if (!text) { log("Đoạn rỗng, bỏ qua.", "warn"); return advance(); }

    setStatus("running");
    log(`=== ĐOẠN ${S.index + 1}/${S.segments.length} ===`);
    if (cfg.reapplyVoice && (cfg.voice || cfg.persona)) {
      await selectVoice(cfg.voice);
      await delay(300);
    }
    const before = snapshotBefore();
    if (!fillSpeech(text)) return haltError();
    await delay(500);
    if (!S.running) return;
    if (!clickRun()) return haltError();

    setStatus("waiting");
    log("⏳ Đã bấm Run, đang chờ tạo audio...");
    const result = await waitForGeneration(before);
    if (!S.running) return;
    if (!result) {
      // hết thời gian: vẫn thử tải nếu có nút Download/audio, rồi quyết định
      log(`⚠ Quá ${cfg.maxWaitSec}s chưa chắc chắn tạo xong. Thử tải bằng nút Download hiện có...`, "warn");
      const ok = await downloadCurrent(makeName(S.index));
      if (!ok) {
        log("✗ Không tải được. Tạm dừng — kiểm tra trang, rồi bấm 'Tải audio' & 'Tiếp', hoặc tăng thời gian chờ ở Nâng cao.", "err");
        setStatus("waiting");
        S.awaitingConfirm = true;
        el.next.disabled = false;
        return;
      }
      await delay(800);
    } else {
      log("✓ Đã tạo xong audio.", "ok");
      await delay(400);
      await downloadCurrent(makeName(S.index));
      await delay(800); // chờ tải xong rồi sang đoạn kế
    }

    if (cfg.autoConfirm) {
      S.awaitingConfirm = true;
      setStatus("waiting");
      log(`⏸ Đoạn ${S.index + 1} xong. Bấm 'Tiếp' để sang đoạn kế.`, "warn");
      el.next.disabled = false;
    } else {
      advance();
    }
  }

  function advance() {
    S.awaitingConfirm = false;
    el.next.disabled = true;
    if (S.index + 1 >= S.segments.length) {
      log("🎉 Đã xong tất cả các đoạn!", "ok");
      stopRun(true);
      return;
    }
    S.index++;
    showCurrent();
    if (S.running && !S.paused) {
      delay(500).then(processSegment);
    }
  }

  function haltError() {
    log("Dừng do lỗi. Kiểm tra selector ở mục Nâng cao.", "err");
    stopRun(false);
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- Điều khiển ----------
  async function startRun() {
    if (!S.segments.length) { log("Chưa có đoạn nào. Hãy chọn file .txt.", "warn"); return; }
    saveCfg();
    S.running = true;
    S.paused = false;
    el.start.disabled = true;
    el.stop.disabled = false;
    el.pick.disabled = true;
    log(`Bắt đầu từ đoạn ${S.index + 1}. Auto xác nhận: ${cfg.autoConfirm ? "BẬT" : "TẮT"}.`);
    if (cfg.voice || cfg.persona) {
      log(`Đặt giọng${cfg.voice ? " " + cfg.voice : ""}${cfg.persona ? " + persona" : ""}...`);
      await selectVoice(cfg.voice);
      await delay(400);
    }
    if (S.running) processSegment();
  }

  function stopRun(done) {
    S.running = false;
    S.awaitingConfirm = false;
    el.start.disabled = false;
    el.stop.disabled = true;
    el.next.disabled = true;
    el.pick.disabled = false;
    setStatus(done ? "done" : "idle");
    el.start.textContent = done ? "▶ Chạy lại" : "▶ Bắt đầu";
  }

  function showCurrent() {
    if (!S.segments.length) {
      el.current.value = "";
      el.counter.textContent = "0 / 0";
      return;
    }
    el.current.value = S.segments[S.index] || "";
    el.counter.textContent = `${S.index + 1} / ${S.segments.length}`;
  }

  function setStatus(state) {
    panel.classList.remove("ttsb-running", "ttsb-waiting", "ttsb-done");
    if (state === "running") panel.classList.add("ttsb-running");
    else if (state === "waiting") panel.classList.add("ttsb-waiting");
    else if (state === "done") panel.classList.add("ttsb-done");
  }

  // ---------- Sự kiện UI ----------
  el.pick.addEventListener("click", () => el.file.click());
  el.file.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      S.segments = parseSegments(String(reader.result));
      S.index = 0;
      S.fileName = f.name;
      el.filename.textContent = f.name;
      showCurrent();
      stopRun(false);
      el.start.textContent = "▶ Bắt đầu";
      log(`Đã nạp "${f.name}": ${S.segments.length} đoạn.`, "ok");
    };
    reader.onerror = () => log("✗ Không đọc được file.", "err");
    reader.readAsText(f, "utf-8");
  });

  el.applyvoice.addEventListener("click", async () => {
    saveCfg();
    if (!cfg.voice && !cfg.persona) { log("Chưa chọn giọng/persona.", "warn"); return; }
    await selectVoice(cfg.voice);
  });

  el.start.addEventListener("click", startRun);
  el.stop.addEventListener("click", () => { stopRun(false); log("⏹ Đã dừng.", "warn"); });
  el.next.addEventListener("click", () => {
    if (S.awaitingConfirm) advance();
  });
  el.prev.addEventListener("click", () => {
    if (S.index > 0) { S.index--; showCurrent(); }
  });
  el.fillonly.addEventListener("click", () => { saveCfg(); fillSpeech(el.current.value.trim()); });
  el.run.addEventListener("click", () => { saveCfg(); clickRun(); });
  el.dl.addEventListener("click", () => { saveCfg(); downloadCurrent(makeName(S.index)); });

  el.testSpeech.addEventListener("click", () => {
    saveCfg();
    const n = findSpeechInput();
    flash(n); log(n ? `Ô lời: ${describe(n)}` : "Không tìm thấy ô lời.", n ? "ok" : "err");
  });
  el.testRun.addEventListener("click", () => {
    saveCfg();
    const n = findRunButton();
    flash(n); log(n ? `Nút Run: ${describe(n)}` : "Không tìm thấy nút Run.", n ? "ok" : "err");
  });
  el.testDl.addEventListener("click", () => {
    saveCfg();
    const n = findDownloadButton();
    flash(n); log(n ? `Nút Download: ${describe(n)}` : "Không tìm thấy nút Download.", n ? "ok" : "err");
  });

  function flash(node) {
    if (!node) return;
    const old = node.style.outline;
    node.style.outline = "3px solid #ff4081";
    node.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => { node.style.outline = old; }, 1500);
  }

  // Thu gọn panel
  el.min.addEventListener("click", () => panel.classList.toggle("ttsb-collapsed"));

  // Kéo thả panel
  (function makeDraggable() {
    let dragging = false, ox = 0, oy = 0;
    el.header.addEventListener("mousedown", (e) => {
      if (e.target === el.min) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      panel.style.right = "auto";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, e.clientX - ox) + "px";
      panel.style.top = Math.max(0, e.clientY - oy) + "px";
    });
    document.addEventListener("mouseup", () => { dragging = false; });
  })();

  el.current.addEventListener("input", () => {
    if (S.segments.length) S.segments[S.index] = el.current.value;
  });

  log("Sẵn sàng. Chọn file .txt để bắt đầu.", "ok");
})();
