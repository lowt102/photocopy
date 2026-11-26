// ============================================================
// config.js — NƠI DUY NHẤT CẦN SỬA CẤU HÌNH (dùng chung index + admin)
// ------------------------------------------------------------
// HƯỚNG DẪN NHANH:
// 1. Firebase: console.firebase.google.com > Project settings > Your apps > Web app > copy firebaseConfig.
//    Bật "Realtime Database" (chọn chế độ locked) và "Authentication > Anonymous" (cho khách) + "Email/Password" (cho admin).
//    Dán rules trong file database.rules.json vào tab Rules của Realtime Database.
// 2. Supabase: tạo project > Storage > tạo bucket tên "print-files" (tick PUBLIC).
//    SQL Editor chạy: create policy "anon upload" on storage.objects for insert to anon with check (bucket_id = 'print-files');
//    Lấy URL + anon key ở Project settings > API.
// 3. VietQR: BANK_ID là mã ngân hàng (vd: MB, VCB, TCB, ACB, BIDV, VPB...), ACCOUNT_NO là số tài khoản nhận tiền.
//    SePay/PayOS phải liên kết đúng tài khoản này.
// ============================================================

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDpMIEoHPJJxi5W8qwHGg1ha1lh4uFPWMI",
  authDomain: "photocopy-cc271.firebaseapp.com",,
  databaseURL: "https://photocopy-cc271-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "photocopy-cc271",
  storageBucket: "photocopy-cc271.firebasestorage.app",
  messagingSenderId: "903224510472",
  appId: "1:903224510472:web:e601607f44a8e159a829bd"
};

export const SUPABASE_URL = "https://lyenmrhtykgsuuerwzkr.supabase.co";
export const SUPABASE_ANON_KEY = sb_publishable_flqoVpi1cooByVeWRCbCwg_7xEEldC5";
export const SUPABASE_BUCKET = "print-files";

export const BANK = {
  BANK_ID: "VCB",
  ACCOUNT_NO: "9829060858",
  ACCOUNT_NAME: "PHAN VAN LONG",
};

export const SHOP_NAME = "Tiệm Photocopy";
export const MAX_FILE_MB = 50;          // giới hạn file của Supabase gói Free
export const DENSE_THRESHOLD = 0.15;    // > 15% diện tích mực đậm => giá phủ mực đậm
export const COPYRIGHT_PAGE_LIMIT = 30; // > 30 trang + có từ khóa bản quyền => cảnh báo

// Bảng giá (đồng / 1 trang mặt in). A3 nhân hệ số paperMultiplier.
export const PRICING = {
  bw:    { normal: 300,  dense: 900 },
  color: { normal: 1500, dense: 2500 },
  paperMultiplier: { A4: 1, A3: 2 },
  binding: {            // đồng / 1 bộ
    none: 0,
    staple: 1000,
    spiral: 12000,
  },
  bindingLabel: {
    none: "Không gia công",
    staple: "Đóng kim",
    spiral: "Đóng gáy xoắn + bìa kiếng",
  },
};
