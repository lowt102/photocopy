// shared.js — Logic dùng chung cho khách (app.js) và chủ quán (admin.js)
// Yêu cầu: trang HTML đã nạp PDF.js bản UMD => window.pdfjsLib
import { PRICING, DENSE_THRESHOLD, COPYRIGHT_PAGE_LIMIT } from "./config.js";

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export const formatVND = (n) => Number(n || 0).toLocaleString("vi-VN") + "đ";

/** Mở PDF từ ArrayBuffer | Uint8Array | URL. Ném lỗi có code: PASSWORD / INVALID. */
export async function loadPdf(source) {
  const params = typeof source === "string" ? { url: source } : { data: source };
  try {
    return await pdfjsLib.getDocument(params).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      const err = new Error("File PDF đang đặt mật khẩu. Hãy gỡ mật khẩu rồi tải lại.");
      err.code = "PASSWORD";
      throw err;
    }
    const err = new Error("Không đọc được file PDF. File có thể bị hỏng.");
    err.code = "INVALID";
    throw err;
  }
}

/** true nếu file cho phép in. PDF.js trả null khi không bị hạn chế. */
export async function canPrint(pdf) {
  const perms = await pdf.getPermissions();
  if (!perms) return true;
  return perms.includes(pdfjsLib.PermissionFlag.PRINT);
}

/** Đo độ phủ mực từng trang. Trả về mảng tỷ lệ 0..1 (pixel tối / tổng pixel). */
export async function analyzeInk(pdf, onProgress) {
  const coverage = [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const TARGET_WIDTH = 240; // độ phân giải thấp để chạy nhanh
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    const total = data.length / 4;
    for (let p = 0; p < data.length; p += 4) {
      const gray = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
      if (gray < 128) dark++;
    }
    coverage.push(dark / total);
    page.cleanup();
    if (onProgress) onProgress(i, pdf.numPages);
  }
  canvas.width = canvas.height = 0;
  return coverage;
}

/** Tổng hợp số trang thường / đậm từ mảng độ phủ. */
export function summarizeCoverage(coverage) {
  const densePages = coverage.filter((c) => c > DENSE_THRESHOLD).length;
  return {
    totalPages: coverage.length,
    normalPages: coverage.length - densePages,
    densePages,
    avgCoverage: coverage.length ? coverage.reduce((a, b) => a + b, 0) / coverage.length : 0,
  };
}

const COPYRIGHT_REGEX =
  /ISBN|978-604|nhà\s+xuất\s+bản|\bNXB\b|bản\s+quyền\s+thuộc\s+về|nghiêm\s+cấm\s+sao\s+chép/i;

/** Quét chữ 5 trang đầu + 5 trang cuối. Trả { matched, keywords[] }. */
export async function scanCopyright(pdf) {
  const n = pdf.numPages;
  const idx = new Set();
  for (let i = 1; i <= Math.min(5, n); i++) idx.add(i);
  for (let i = Math.max(1, n - 4); i <= n; i++) idx.add(i);
  const found = new Set();
  const globalRe = new RegExp(COPYRIGHT_REGEX.source, "gi");
  for (const i of idx) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => it.str).join(" ");
    const m = text.match(globalRe);
    if (m) m.forEach((k) => found.add(k.trim().toUpperCase().replace(/\s+/g, " ")));
    page.cleanup();
  }
  return { matched: found.size > 0, keywords: [...found] };
}

/** Quyết định có gắn cờ COPYRIGHT_WARNING không. */
export function isCopyrightWarning(scan, totalPages) {
  return scan.matched && totalPages > COPYRIGHT_PAGE_LIMIT;
}

/**
 * Tính tiền. analysis = { normalPages, densePages }.
 * options = { paper, color, copies, binding }.
 * Hàm này được admin.js gọi lại để đối soát chống sửa giá bằng F12.
 */
export function calcPrice(analysis, options) {
  const tier = PRICING[options.color === "color" ? "color" : "bw"];
  const mult = PRICING.paperMultiplier[options.paper] || 1;
  const normalCost = analysis.normalPages * tier.normal * mult;
  const denseCost = analysis.densePages * tier.dense * mult;
  const copies = Math.max(1, parseInt(options.copies, 10) || 1);
  const bindingCost = PRICING.binding[options.binding] || 0;
  const perSet = normalCost + denseCost + bindingCost;
  return {
    normalCost, denseCost, bindingCost, copies,
    unitNormal: tier.normal * mult,
    unitDense: tier.dense * mult,
    total: perSet * copies,
  };
}

/** Vẽ 1 trang PDF vào canvas hiển thị (preview). */
export async function renderPageToCanvas(pdf, pageNum, canvas, maxWidth = 640) {
  const page = await pdf.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, 2);
  const viewport = page.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = Math.floor(viewport.width) + "px";
  canvas.style.height = Math.floor(viewport.height) + "px";
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx,
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
    background: "#ffffff",
  }).promise;
  page.cleanup();
}
