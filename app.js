// app.js — Trang khách đặt in. Cấu hình nằm trong config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, onValue, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  FIREBASE_CONFIG, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET,
  BANK, SHOP_NAME, MAX_FILE_MB, PRICING,
} from "./config.js";
import {
  formatVND, loadPdf, canPrint, analyzeInk, summarizeCoverage,
  scanCopyright, isCopyrightWarning, calcPrice, renderPageToCanvas,
} from "./shared.js";

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const state = {
  file: null, pdf: null, analysis: null, coverage: [],
  copyright: { matched: false, keywords: [] }, flags: [],
  page: 1, ready: false, unsubscribe: null,
};

// ---------- Khởi tạo giao diện ----------
$("shopName").textContent = SHOP_NAME + " — Đặt in online";
$("maxMb").textContent = MAX_FILE_MB;
for (const [key, label] of Object.entries(PRICING.bindingLabel)) {
  const o = document.createElement("option");
  o.value = key;
  const price = PRICING.binding[key];
  o.textContent = price ? `${label} (+${formatVND(price)}/bộ)` : label;
  $("binding").appendChild(o);
}
signInAnonymously(auth).catch((e) => {
  showSubmitError("Không kết nối được máy chủ: " + e.message);
});

// ---------- Tiện ích UI ----------
function showFileError(msg) {
  $("fileError").textContent = msg || "";
  $("fileError").hidden = !msg;
}
function showSubmitError(msg) {
  $("submitError").textContent = msg || "";
  $("submitError").hidden = !msg;
}
function setProgress(label, pct) {
  $("progressBox").hidden = false;
  $("progressLabel").textContent = label;
  $("progressPct").textContent = Math.round(pct) + "%";
  $("progressBar").style.width = pct + "%";
}
function getOptions() {
  const f = new FormData($("orderForm"));
  return {
    paper: f.get("paper"),
    duplex: f.get("duplex"),
    color: f.get("color"),
    copies: Math.min(200, Math.max(1, parseInt(f.get("copies"), 10) || 1)),
    binding: f.get("binding") || "none",
  };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function resetAnalysis() {
  state.pdf = null; state.analysis = null; state.coverage = []; state.flags = [];
  state.ready = false; state.page = 1;
  $("previewCard").hidden = true;
  $("copyrightBox").hidden = true;
  $("progressBox").hidden = true;
  renderSummary();
}

// ---------- Xử lý file ----------
$("fileInput").addEventListener("change", (e) => handleFile(e.target.files[0]));
const dz = $("dropzone");
["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("border-cyan-print"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("border-cyan-print"); }));
dz.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

async function handleFile(file) {
  showFileError("");
  showSubmitError("");
  resetAnalysis();
  if (!file) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return showFileError("Chỉ nhận file PDF. Hãy lưu tài liệu của bạn sang PDF rồi tải lại.");
  if (file.size > MAX_FILE_MB * 1024 * 1024) return showFileError(`File lớn hơn ${MAX_FILE_MB} MB. Hãy nén file hoặc tách thành nhiều phần.`);

  try {
    setProgress("Đang đọc file...", 3);
    const buffer = await file.arrayBuffer();
    const pdf = await loadPdf(new Uint8Array(buffer));

    if (!(await canPrint(pdf))) {
      showFileError("File này đã bị khóa quyền in, nên không thể đặt in. Hãy dùng bản PDF không bị khóa.");
      $("progressBox").hidden = true;
      return;
    }
    if (pdf.numPages < 1) return showFileError("File PDF không có trang nào.");

    state.file = file;
    state.pdf = pdf;
    $("fileName").textContent = file.name;
    $("previewCard").hidden = false;
    await showPage(1);

    setProgress("Đang đo độ phủ mực...", 5);
    state.coverage = await analyzeInk(pdf, (i, n) => setProgress(`Đo độ phủ mực: trang ${i}/${n}`, 5 + (i / n) * 85));
    state.analysis = summarizeCoverage(state.coverage);

    setProgress("Đang kiểm tra bản quyền...", 92);
    state.copyright = await scanCopyright(pdf);
    state.flags = [];
    if (isCopyrightWarning(state.copyright, state.analysis.totalPages)) {
      state.flags.push("COPYRIGHT_WARNING");
      $("copyrightKeywords").textContent = state.copyright.keywords.join(", ");
      $("copyrightBox").hidden = false;
    }
    if (state.analysis.densePages > 0) state.flags.push("DENSE_INK");

    setProgress("Hoàn tất", 100);
    setTimeout(() => ($("progressBox").hidden = true), 600);
    state.ready = true;
    renderSummary();
    updatePageInk();
  } catch (err) {
    console.error(err);
    showFileError(err.message || "Không xử lý được file này.");
    resetAnalysis();
  }
}

// ---------- Xem trước ----------
async function showPage(n) {
  if (!state.pdf) return;
  state.page = Math.min(Math.max(1, n), state.pdf.numPages);
  $("pageInfo").textContent = `${state.page} / ${state.pdf.numPages}`;
  await renderPageToCanvas(state.pdf, state.page, $("previewCanvas"), Math.min(640, $("previewCard").clientWidth - 40));
  updatePageInk();
}
function updatePageInk() {
  const c = state.coverage[state.page - 1];
  if (c === undefined) return ($("pageInk").textContent = "");
  const pct = (c * 100).toFixed(1);
  $("pageInk").textContent = c > 0.15
    ? `Trang ${state.page}: mực phủ ${pct}%, tính giá nền đậm.`
    : `Trang ${state.page}: mực phủ ${pct}%, tính giá thường.`;
}
$("prevPage").addEventListener("click", () => showPage(state.page - 1));
$("nextPage").addEventListener("click", () => showPage(state.page + 1));

// ---------- Tính tiền & bảng kê ----------
function renderSummary() {
  const list = $("summaryList");
  if (!state.analysis) {
    list.hidden = true; $("summaryEmpty").hidden = false;
    $("totalPrice").textContent = "0đ";
    $("submitBtn").disabled = true;
    return;
  }
  const o = getOptions();
  const p = calcPrice(state.analysis, o);
  const a = state.analysis;
  const rows = [
    [`${a.normalPages} trang thường × ${formatVND(p.unitNormal)}`, formatVND(p.normalCost)],
    [`${a.densePages} trang nền đậm × ${formatVND(p.unitDense)}`, formatVND(p.denseCost)],
    [PRICING.bindingLabel[o.binding], formatVND(p.bindingCost)],
    [`Số bản`, `× ${p.copies}`],
  ];
  list.innerHTML = rows.map(([k, v]) =>
    `<div class="flex justify-between gap-3"><dt>${escapeHtml(k)}</dt><dd class="tabular-nums font-medium">${escapeHtml(v)}</dd></div>`).join("") +
    `<p class="text-slate-500 pt-1">Tổng ${a.totalPages} trang: ${a.normalPages} trang thường + ${a.densePages} trang nền đậm. ${o.duplex === "duplex" ? "In 2 mặt." : "In 1 mặt."}</p>`;
  list.hidden = false;
  $("summaryEmpty").hidden = true;
  $("totalPrice").textContent = formatVND(p.total);
  $("submitBtn").disabled = !state.ready;
}
$("orderForm").addEventListener("input", renderSummary);
$("orderForm").addEventListener("change", renderSummary);
$("orderForm").addEventListener("submit", (e) => e.preventDefault());

// ---------- Tạo đơn ----------
async function generateOrderId() {
  for (let i = 0; i < 20; i++) {
    const id = "IN" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const snap = await get(ref(db, `orders/${id}`));
    if (!snap.exists()) return id;
  }
  throw new Error("Không tạo được mã đơn. Vui lòng thử lại.");
}

async function uploadToSupabase(orderId, file) {
  const path = `uploads/${orderId}.pdf`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      // Khóa mới sb_publishable_... không phải JWT nên không gửi trong Authorization
      ...(SUPABASE_ANON_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SUPABASE_ANON_KEY}` }),
      "Content-Type": "application/pdf",
      "x-upsert": "false",
    },
    body: file,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Tải file lên thất bại (" + res.status + "). " + t.slice(0, 120));
  }
  return { path, url: `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${path}` };
}

$("submitBtn").addEventListener("click", async () => {
  showSubmitError("");
  const name = $("customerName").value.trim();
  const phone = $("phoneLast4").value.trim();
  if (!state.ready || !state.file) return showSubmitError("Hãy tải file PDF lên trước.");
  if (name.length < 2) return showSubmitError("Vui lòng nhập tên của bạn.");
  if (!/^\d{4}$/.test(phone)) return showSubmitError("Vui lòng nhập đúng 4 số cuối điện thoại.");
  if (!auth.currentUser) return showSubmitError("Đang kết nối máy chủ, thử lại sau vài giây.");

  const btn = $("submitBtn");
  btn.disabled = true;
  btn.textContent = "Đang tạo đơn...";
  try {
    const options = getOptions();
    const price = calcPrice(state.analysis, options);
    const orderId = await generateOrderId();
    const fileInfo = await uploadToSupabase(orderId, state.file);

    const order = {
      orderId,
      status: "PENDING_PAYMENT",
      createdAt: serverTimestamp(),
      customer: { name, phoneLast4: phone },
      options,
      analysis: {
        totalPages: state.analysis.totalPages,
        normalPages: state.analysis.normalPages,
        densePages: state.analysis.densePages,
        avgCoverage: Number(state.analysis.avgCoverage.toFixed(4)),
      },
      flags: state.flags,
      copyrightKeywords: state.copyright.keywords,
      file: { name: state.file.name, size: state.file.size, path: fileInfo.path, url: fileInfo.url },
      totalAmount: price.total,
    };
    await set(ref(db, `orders/${orderId}`), order);
    showPayment(orderId, price.total);
  } catch (err) {
    console.error(err);
    showSubmitError(err.message || "Không tạo được đơn. Vui lòng thử lại.");
    btn.disabled = false;
    btn.textContent = "Xác nhận & thanh toán";
  }
});

// ---------- Thanh toán VietQR + realtime ----------
const STATUS_TEXT = {
  PENDING_PAYMENT: ["Đang chờ thanh toán...", "bg-slate-100 text-slate-700"],
  PAID: ["Đã nhận tiền. Đang chờ chủ quán duyệt in.", "bg-emerald-100 text-emerald-900"],
  READY_TO_PRINT: ["Chủ quán đã duyệt. Đang xếp hàng in.", "bg-sky-100 text-sky-900"],
  PRINTING: ["Đang in tài liệu của bạn...", "bg-sky-100 text-sky-900"],
  COMPLETED: ["Đã in xong. Mời bạn đến quầy nhận tài liệu và đọc mã đơn.", "bg-emerald-100 text-emerald-900"],
  REJECTED: ["Đơn bị từ chối.", "bg-red-100 text-red-900"],
};

function buildQrUrl(orderId, amount) {
  const q = new URLSearchParams({ amount: String(amount), addInfo: orderId, accountName: BANK.ACCOUNT_NAME });
  return `https://img.vietqr.io/image/${BANK.BANK_ID}-${BANK.ACCOUNT_NO}-compact2.png?${q}`;
}

function showPayment(orderId, amount) {
  $("orderIdText").textContent = orderId;
  $("qrImage").src = buildQrUrl(orderId, amount);
  $("payInfo").textContent = `${formatVND(amount)} — nội dung: ${orderId}`;
  $("paymentCard").hidden = false;
  $("orderForm").querySelectorAll("input,select").forEach((el) => (el.disabled = true));
  $("submitBtn").hidden = true;
  $("fileInput").disabled = true;
  $("paymentCard").scrollIntoView({ behavior: "smooth", block: "start" });

  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = onValue(ref(db, `orders/${orderId}`), (snap) => {
    const o = snap.val();
    if (!o) return;
    const [text, cls] = STATUS_TEXT[o.status] || [o.status, "bg-slate-100"];
    const box = $("statusBox");
    box.className = "mt-3 rounded-lg p-3 text-sm font-medium " + cls;
    box.textContent = o.status === "REJECTED" && o.rejectReason
      ? `Đơn bị từ chối: ${o.rejectReason}. Vui lòng liên hệ quán để được hoàn tiền.` : text;
    if (o.status !== "PENDING_PAYMENT") $("qrBox").hidden = true;
    if (["COMPLETED", "REJECTED"].includes(o.status)) $("newOrderBtn").hidden = false;
  });
}

$("newOrderBtn").addEventListener("click", () => location.reload());
