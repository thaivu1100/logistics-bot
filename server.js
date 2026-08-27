// server.js
const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json());
// FIX LỖI "1 SỐ USER BỊ KẸT PHIÊN BẢN CŨ/DEMO": trước đây express.static dùng cache mặc định của trình
// duyệt/Telegram WebView cho file index.html, khiến sau khi deploy bản mới, một số thiết bị vẫn tiếp tục
// đọc bản HTML/JS đã lưu cache cục bộ trước đó thay vì tải lại. Ép index.html luôn "no-store" (không lưu
// cache) để MỌI thiết bị luôn nhận đúng 1 phiên bản mới nhất ngay khi mở lại Mini App, không cần xoá cache
// thủ công nữa. Các file tĩnh khác (nếu có) vẫn cache bình thường để không tốn băng thông.
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// ==================== CẦN CHẠY 1 LẦN TRÊN SUPABASE (SQL Editor) TRƯỚC KHI DEPLOY ====================
// 1) Bảng quản lý admin phụ:
//    create table if not exists admins (id text primary key, addedBy text, createdAt timestamptz default now());
// 2) Thêm cột "phạm vi" + "người tạo" cho bảng giftcodes:
//    alter table giftcodes add column if not exists scope text default 'nguoidung';
//    alter table giftcodes add column if not exists createdBy text;
// 3) Thêm cột snapshot phần thưởng + thời gian + tên cho bảng giftcode_redemptions
//    (để hiển thị lịch sử nhập code riêng tư của từng user và cho /thuhoi, /listnguoinhapcode hoạt động):
//    alter table giftcode_redemptions add column if not exists rewardCoin integer default 0;
//    alter table giftcode_redemptions add column if not exists rewardOrders integer default 0;
//    alter table giftcode_redemptions add column if not exists rewardSpins integer default 0;
//    alter table giftcode_redemptions add column if not exists userName text;
//    alter table giftcode_redemptions add column if not exists createdAt timestamptz default now();
// =======================================================================================================

// --- CẤU HÌNH ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ==================== TƯƠNG THÍCH SCHEMA SUPABASE (CHỐNG MẤT DỮ LIỆU) ====================
// NGUYÊN NHÂN LỖI 42703 ("column users.quizDate does not exist", "users.weeklyAdsCount does not exist"...):
// code ghi/đọc một số cột mà bảng "users" trên Supabase thật KHÔNG có. Postgres từ chối TOÀN BỘ câu lệnh
// đó, nên chỉ cần 1 cột thiếu là mất luôn cả lần lưu coin/đơn hàng/nhiệm vụ -> chính là lỗi "mất dữ liệu".
// CÁCH SỬA: lúc chạy, đọc danh sách cột THẬT của bảng users; cột nào có thật thì ghi thẳng vào users,
// cột nào chưa có thì lưu an toàn vào bảng app_settings (khóa user_extra_state) và ghép lại khi đọc user.
// Nhờ vậy KHÔNG mất bất kỳ dữ liệu nào và KHÔNG cần chạy migration SQL nào trên Supabase.
// ==================== MỐC NGÀY THEO GIỜ VIỆT NAM (0h00) ====================
// Mọi giới hạn theo ngày (nhiệm vụ, câu hỏi, SmartLink, rút tiền) đều tính theo 0h00 giờ Việt Nam,
// KHÔNG phụ thuộc giờ máy chủ hay giờ điện thoại (trước đây dùng giờ thiết bị nên chỉnh giờ máy
// hoặc tải lại app là có thêm lượt).
function vietnamDayKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}
function isCurrentVietnamDay(value) {
    if (!value) return false;
    const today = vietnamDayKey();
    if (value === today) return true;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && vietnamDayKey(parsed) === today;
}
function vietnamDayStartIso(date = new Date()) {
    return `${vietnamDayKey(date)}T00:00:00+07:00`;
}
function vietnamTimeText(date = new Date()) {
    const dayPart = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date);
    const timePart = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
    return `${dayPart} ${timePart}`;
}
// Các field được đưa về 0 khi sang ngày mới (0h00 giờ Việt Nam)
function dailyResetFields() {
    return {
        adsToday: 0, smartlinksToday: 0, bonusAdsToday: 0, rewardedAdsToday: 0, extraDeliveryAdsToday: 0, extraDeliveryCount: 0,
        dailyValidInvites: 0,
        deliveryCount: 0, smartlinkCount: 0, usedSmartlinks: [],
        spinAdCount: 0, spinAdProgress: 0, chestOpensToday: 0,
        quizDate: vietnamDayKey(), quizFreeUsed: false, quizAdUnlocked: 0, quizUsedIds: [],
        dailyTasks: null, allTasksClaimed: false, withdrawRemain: 1,
        lastResetDate: vietnamDayKey()
    };
}

const USER_EXTRA_KEY = 'user_extra_state';
const CORE_USER_COLUMNS = ['id', 'name', 'coins', 'orders', 'spins', 'truckLevel', 'isBanned', 'walletUpdatedAt'];
let userColumnsCache = null;
let userColumnsAt = 0;
async function getUserColumns(forceRefresh = false) {
    if (!forceRefresh && userColumnsCache && Date.now() - userColumnsAt < 5 * 60 * 1000) return userColumnsCache;
    try {
        const { data, error } = await supabase.from('users').select('*').limit(1);
        if (error) throw error;
        if (Array.isArray(data) && data.length > 0) {
            userColumnsCache = new Set(Object.keys(data[0]));
            userColumnsAt = Date.now();
            return userColumnsCache;
        }
    } catch (e) {
        console.error('Không đọc được danh sách cột bảng users:', e.message);
    }
    if (!userColumnsCache) { userColumnsCache = new Set(CORE_USER_COLUMNS); userColumnsAt = Date.now(); }
    return userColumnsCache;
}

// Bộ nhớ đệm cho phần dữ liệu lưu ngoài bảng users: đọc tức thì, ghi gộp mỗi 3 giây để không
// nặng database và không có 2 request nào ghi đè mất dữ liệu của nhau.
let userExtraCache = null;
let userExtraDirty = false;
let userExtraFlushTimer = null;
async function loadUserExtraAll() {
    try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', USER_EXTRA_KEY).maybeSingle();
        if (error) throw error;
        const value = data?.value;
        if (!value) return {};
        if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return {}; } }
        return (typeof value === 'object' && !Array.isArray(value)) ? value : {};
    } catch (e) {
        console.error('Không đọc được user_extra_state:', e.message);
        return {};
    }
}
async function getUserExtraAll() {
    if (!userExtraCache) userExtraCache = await loadUserExtraAll();
    return userExtraCache;
}
async function flushUserExtra() {
    if (!userExtraDirty || !userExtraCache) return;
    userExtraDirty = false;
    const { error } = await supabase.from('app_settings')
        .upsert({ key: USER_EXTRA_KEY, value: userExtraCache }, { onConflict: 'key' });
    if (error) {
        userExtraDirty = true; // Giữ lại cờ để lần ghi sau thử lại, không mất dữ liệu
        console.error('Không lưu được user_extra_state:', error.message);
    }
}
function scheduleUserExtraFlush() {
    if (userExtraFlushTimer) return;
    userExtraFlushTimer = setTimeout(() => {
        userExtraFlushTimer = null;
        flushUserExtra().catch(() => {});
    }, 3000);
}
async function getUserExtra(userId) {
    const all = await getUserExtraAll();
    return all[String(userId)] || {};
}
async function saveUserExtra(userId, values) {
    const all = await getUserExtraAll();
    const key = String(userId);
    all[key] = { ...(all[key] || {}), ...values };
    userExtraDirty = true;
    scheduleUserExtraFlush();
}
async function saveUserExtraAll(all) {
    userExtraCache = all || {};
    userExtraDirty = true;
    return flushUserExtra();
}
// Nếu một field đã được ghi vào cột thật thì xoá bản sao cũ trong kho lưu tạm, tránh trường hợp
// sau này thêm cột vào Supabase mà vẫn đọc nhầm giá trị cũ.
async function pruneUserExtra(userId, keys) {
    if (!keys || keys.length === 0) return;
    const all = await getUserExtraAll();
    const entry = all[String(userId)];
    if (!entry) return;
    let changed = false;
    keys.forEach(k => { if (k in entry) { delete entry[k]; changed = true; } });
    if (changed) { userExtraDirty = true; scheduleUserExtraFlush(); }
}
async function clearUserExtra(userId) {
    if (userId === null) return saveUserExtraAll({});
    const all = await getUserExtraAll();
    delete all[String(userId)];
    userExtraDirty = true;
    return flushUserExtra();
}
setInterval(() => { flushUserExtra().catch(() => {}); }, 15000);
// Render gửi SIGTERM trước khi tắt instance cũ -> ghi nốt dữ liệu còn trong bộ đệm để không mất.
process.on('SIGTERM', () => { flushUserExtra().catch(() => {}); });

// Lấy tên cột bị thiếu từ thông báo lỗi của Postgres/PostgREST (42703 hoặc PGRST204)
function extractMissingColumn(error) {
    const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    const m = text.match(/find the ['"]([A-Za-z_][A-Za-z0-9_]*)['"] column/i)
        || text.match(/column ['"]?(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)['"]? (?:of|does)/i);
    return m ? m[1] : null;
}
// Ghi 1 dòng vào bảng bất kỳ: nếu bảng thật thiếu cột nào thì bỏ cột đó rồi ghi lại, để 1 cột thiếu
// không làm mất TOÀN BỘ bản ghi (đơn rút tiền, lịch sử giao dịch...).
async function insertRowSafe(table, row) {
    const payload = { ...row };
    for (let i = 0; i < 12; i++) {
        const { error } = await supabase.from(table).insert(payload);
        if (!error) return { error: null };
        const missing = extractMissingColumn(error);
        if (!missing || !(missing in payload)) return { error };
        console.warn(`Bảng ${table} chưa có cột "${missing}" -> bỏ qua cột này khi ghi.`);
        delete payload[missing];
    }
    return { error: { message: `Không ghi được dữ liệu vào bảng ${table}` } };
}
async function splitUserFields(values = {}) {
    const cols = await getUserColumns();
    const known = {}, extra = {};
    Object.entries(values || {}).forEach(([k, v]) => { (cols.has(k) ? known : extra)[k] = v; });
    return { known, extra };
}
// Lưu dữ liệu user an toàn với mọi schema: cột có thật -> bảng users, cột chưa có -> app_settings.
async function saveUserFields(userId, values = {}) {
    let { known, extra } = await splitUserFields(values);
    if (Object.keys(known).length > 0) {
        let { error } = await supabase.from('users').update(known).eq('id', userId);
        if (error && error.code === '42703') {
            // Schema vừa thay đổi (hoặc cache đã cũ) -> đọc lại danh sách cột rồi thử lại 1 lần
            await getUserColumns(true);
            ({ known, extra } = await splitUserFields(values));
            error = Object.keys(known).length > 0
                ? (await supabase.from('users').update(known).eq('id', userId)).error
                : null;
        }
        if (error) return { error };
        await pruneUserExtra(userId, Object.keys(known));
    }
    if (Object.keys(extra).length > 0) await saveUserExtra(userId, extra);
    return { error: null };
}
// Đọc user đầy đủ = dữ liệu bảng users + các field đang lưu tạm trong app_settings
async function readUserRow(userId) {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (error || !data) return { data: null, error: error || null };
    const extra = await getUserExtra(userId);
    return { data: { ...extra, ...data }, error: null };
}
getUserColumns().then(cols => console.log(`✅ Đã đọc schema bảng users: ${cols.size} cột`)).catch(() => {});

const BOT_TOKEN = process.env.BOT_TOKEN;

function verifyTelegramInitData(initData) {
    try {
        if (!initData || !BOT_TOKEN) return null;
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        const authDate = Number(params.get('auth_date') || 0);
        if (!hash || !authDate || Date.now() - authDate * 1000 > 24 * 60 * 60 * 1000) return null;
        const pairs = [];
        for (const [k,v] of params.entries()) if (k !== 'hash') pairs.push(`${k}=${v}`);
        pairs.sort();
        const dataCheckString = pairs.join('\n');
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
        const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (expected.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
        const userRaw = params.get('user');
        const user = userRaw ? JSON.parse(userRaw) : null;
        return user && user.id ? String(user.id) : null;
    } catch (_) { return null; }
}
function assertTelegramUser(req, userId) {
    const initData = req.get('x-telegram-init-data') || req.body?.initData || '';
    const verified = verifyTelegramInitData(initData);
    return verified && String(verified) === String(userId);
}

const GROUP_1_ID = parseInt(process.env.GROUP_1_ID); // Kênh thông báo
const GROUP_2_ID = parseInt(process.env.GROUP_2_ID); // Nhóm chat
// Nhóm dành riêng cho nhiệm vụ "Tham gia nhóm" (mục Nhiệm Vụ) - KHÁC 2 nhóm bắt buộc GROUP_1_ID/GROUP_2_ID
// ở trên (điều kiện referral/vào Mini App không đổi). Dùng username public nên không cần thêm ID số.
const TASK_GROUP_USERNAME = process.env.TASK_GROUP_USERNAME || '@sharekeotonghop';
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://logistics-bot-vyxa.onrender.com';

const bot = new Telegraf(BOT_TOKEN);

// ==================== HỆ THỐNG CẤP ĐỘ VÀ CÔNG THỨC (LEVEL 1-500) ====================
/**
 * Tính toán tất cả thống kê xe theo cấp độ (công thức LOCKED)
 * Level 1-500 tuân theo công thức chính xác:
 * - Thời gian: 30 phút ở cấp 1, giảm đều xuống đúng 2 phút ở cấp 500
 * - Sản phẩm/lần: tăng đều từ 100, tối đa đúng 5.000 đơn ở cấp 500
 * - Kho max: bằng đúng 1 mẻ hàng
 * - Chi phí nâng cấp: 300 + (level-1)*300 coin (tổng ~37,4 triệu coin để đạt cấp 500)
 * - Lần giao/ngày: floor(1440 / thời gian)
 * - Đơn hàng/ngày: lần_giao * sản_phẩm
 */
const MAX_TRUCK_LEVEL = 500;
function calculateLevelStats(level) {
    level = Math.max(1, Math.min(MAX_TRUCK_LEVEL, parseInt(level) || 1));

    // Thời gian sản xuất giảm đều từ 30 phút (cấp 1) xuống ĐÚNG 2 phút ở cấp 500, không thấp hơn 2 phút.
    const productionMinutes = level >= MAX_TRUCK_LEVEL
        ? 2
        : Math.max(2, 30 * Math.pow(2 / 30, (level - 1) / (MAX_TRUCK_LEVEL - 1)));
    const productsPerDelivery = Math.round(100 + (level - 1) * (4900 / (MAX_TRUCK_LEVEL - 1))); // Cấp 500: đúng 5.000 đơn
    const maxWarehouse = productsPerDelivery;             // Kho chứa đúng 1 mẻ hàng
    // Chi phí nâng cấp tăng đều: cấp 1->2 hết 300 coin, cấp 499->500 hết 149.700 coin
    // (tổng ~37 triệu coin) -> lên cấp 500 khá khó, phải chơi lâu dài chứ không đạt trong vài ngày.
    const upgradeCost = level < MAX_TRUCK_LEVEL ? 300 + (level - 1) * 300 : 0;
    const deliveriesPerDay = Math.floor(1440 / productionMinutes);
    const ordersPerDay = deliveriesPerDay * productsPerDelivery;
    
    return {
        level,
        maxLevel: MAX_TRUCK_LEVEL,
        productionTime: Math.round(productionMinutes * 100) / 100,
        productionMs: Math.round(productionMinutes * 60 * 1000),
        productsPerDelivery,
        maxWarehouse,
        upgradeCost,
        deliveriesPerDay,
        ordersPerDay
    };
}

// ==================== HỆ THỐNG ADMIN PHỤ (SUB-ADMIN) ====================
// ADMIN_ID (hardcode) luôn là "Admin chính" - có toàn quyền, không ai xoá được.
// Admin chính có thể phong thêm "admin phụ" bằng /addadmin <ID>, admin phụ dùng được TẤT CẢ lệnh admin
// (trừ /addadmin và /xoaadmin - 2 lệnh này CHỈ Admin chính mới dùng được, để tránh admin phụ tự phong
// thêm admin khác hoặc xoá quyền lẫn nhau). Danh sách admin phụ lưu ở bảng "admins" trên Supabase để
// không bị mất khi Render restart, đồng thời cache vào bộ nhớ (Set) để kiểm tra quyền cực nhanh mỗi lệnh.
// CẦN TẠO BẢNG NÀY 1 LẦN TRÊN SUPABASE (SQL Editor):
//   create table if not exists admins (id text primary key, addedBy text, createdAt timestamptz default now());
let subAdminIds = new Set();

async function loadAdmins() {
    try {
        const { data, error } = await supabase.from('admins').select('id');
        if (error) throw error;
        subAdminIds = new Set((data || []).map(r => String(r.id)));
    } catch (e) {
        console.error('Lỗi tải danh sách admin phụ (bảng "admins" có thể chưa tồn tại):', e.message);
        subAdminIds = new Set();
    }
}
loadAdmins();

// Admin chính: chỉ đúng 1 ID hardcode, không thể bị xoá quyền.
const isMainAdmin = (ctx) => String(ctx.from?.id || '') === String(ADMIN_ID);
// Admin (chính hoặc phụ): dùng cho hầu hết lệnh quản trị.
const isAdmin = (ctx) => String(ctx.from?.id || '') === String(ADMIN_ID) || subAdminIds.has(String(ctx.from?.id || ''));

// ==================== KHOÁ BOT / MINI APP (BẢO TRÌ) ====================
// Trạng thái khoá được lưu ở bảng "app_settings" (key/value) để KHÔNG bị mất khi Render restart/deploy lại
// server (khác với biến in-memory thông thường sẽ tự reset về false mỗi lần khởi động lại).
// CẦN TẠO BẢNG NÀY 1 LẦN TRÊN SUPABASE (SQL Editor):
//   create table if not exists app_settings (key text primary key, value jsonb);
let BOT_LOCKED = false;
const MAINTENANCE_MESSAGE = "🔒 Bot Đang Bị Khoá Để Bảo Trì. Vui Lòng Thử Lại Sau!!";

async function loadBotLockState() {
    try {
        const { data } = await supabase.from('app_settings').select('value').eq('key', 'bot_locked').single();
        BOT_LOCKED = data?.value === true;
    } catch (e) {
        BOT_LOCKED = false; // Bảng chưa tồn tại hoặc chưa có dòng nào -> mặc định KHÔNG khoá
    }
}
loadBotLockState();

async function setBotLocked(locked) {
    BOT_LOCKED = locked;
    try {
        await supabase.from('app_settings').upsert({ key: 'bot_locked', value: locked });
    } catch (e) {
        console.error('Lỗi lưu trạng thái khoá bot (đã áp dụng tạm thời trong bộ nhớ):', e.message);
    }
}

// Tăng 1 field số nguyên trên bảng "users" 1 cách AN TOÀN (atomic) bằng compare-and-swap có thử lại.
// FIX LỖI "SỐ BẠN ĐÃ MỜI THẤP HƠN SỐ BẠN HỢP LỆ": trước đây invitedCount được tăng bằng cách ĐỌC rồi GHI
// (đọc invitedCount hiện tại, +1, rồi update) — nếu 2 người được mời cùng bấm /start gần như đồng thời cho
// CÙNG 1 người mời, cả 2 lệnh gọi có thể cùng đọc được giá trị invitedCount CŨ trước khi lệnh kia kịp ghi
// xong, khiến 1 trong 2 lượt mời bị "mất" (invitedCount chỉ tăng 1 thay vì 2) trong khi validInvites (số
// bạn hợp lệ) vẫn được tính đúng cho cả 2 người ở bước xác nhận sau này -> dẫn đến invitedCount < validInvites
// (vô lý vì phải mời được thì mới có thể trở thành hợp lệ). Cách fix: dùng UPDATE có điều kiện
// WHERE field = giá_trị_vừa_đọc, nếu 0 dòng bị ảnh hưởng (do có lượt ghi khác xen vào) thì đọc lại và thử
// lại, đảm bảo không lượt tăng nào bị mất dù có nhiều request chạy đồng thời.
async function atomicIncrement(userId, field, amount = 1, maxRetries = 6) {
    const cols = await getUserColumns();
    if (!cols.has(field)) {
        // Cột này chưa có trong bảng users -> cộng dồn trong app_settings, tuyệt đối không mất lượt
        const extra = await getUserExtra(userId);
        const newVal = Number(extra[field] || 0) + amount;
        await saveUserExtra(userId, { [field]: newVal });
        return newVal;
    }
    for (let i = 0; i < maxRetries; i++) {
        const { data: cur, error: readErr } = await supabase.from('users').select(field).eq('id', userId).single();
        if (readErr || !cur) return null;
        const oldVal = cur[field] || 0;
        const newVal = oldVal + amount;
        const { data: updated, error: updErr } = await supabase.from('users')
            .update({ [field]: newVal })
            .eq('id', userId).eq(field, oldVal)
            .select(field);
        if (!updErr && updated && updated.length > 0) return newVal;
        // Có request khác vừa ghi đè giữa lúc đọc và ghi -> thử lại với giá trị mới nhất
    }
    console.error(`atomicIncrement: hết số lần thử cho ${userId}.${field}`);
    return null;
}

// FIX LỖI "BOT KHÔNG PHẢN HỒI GÌ CẢ": trước đây bot KHÔNG có bot.catch() toàn cục, nên bất kỳ lỗi nào
// xảy ra bên trong /start hoặc các lệnh admin (vd: Supabase timeout, Telegram API rate-limit khi kiểm
// tra thành viên nhóm, dữ liệu JSON hỏng...) đều khiến Telegraf âm thầm nuốt lỗi, chỉ log ra console mà
// KHÔNG trả lời gì cho người dùng -> nhìn như bot bị "im lặng"/"treo". bot.catch() đảm bảo mọi lỗi đều
// được ghi log VÀ luôn có phản hồi báo lỗi cho người dùng thay vì im lặng.
bot.catch((err, ctx) => {
    console.error(`⚠️ Lỗi khi xử lý update (${ctx.updateType}) từ user ${ctx.from?.id}:`, err);
    ctx.reply('❌ Đã có lỗi xảy ra, vui lòng thử lại sau ít giây. Nếu lỗi tiếp diễn hãy liên hệ Admin.').catch(() => {});
});

// Hàm gửi tin nhắn Telegram an toàn
async function safeSendMessage(chatId, text, options = {}) {
    try {
        await bot.telegram.sendMessage(chatId, text, options);
        return true;
    } catch (e) {
        console.error(`Lỗi gửi tin nhắn tới ${chatId}:`, e.message);
        return false;
    }
}

// Hàm kiểm tra thành viên nhóm
async function checkUserMembership(userId) {
    try {
        // Sử dụng Promise.all để kiểm tra song song, tiết kiệm thời gian
        const [m1, m2] = await Promise.all([
            bot.telegram.getChatMember(GROUP_1_ID, userId).catch(() => ({ status: 'left' })),
            bot.telegram.getChatMember(GROUP_2_ID, userId).catch(() => ({ status: 'left' }))
        ]);
        const validStatuses = ['member', 'administrator', 'creator'];
        return validStatuses.includes(m1.status) && validStatuses.includes(m2.status);
    } catch (e) {
        console.error(`Lỗi check member ${userId}:`, e.message);
        return false;
    }
}

// Hàm kiểm tra IP trùng
async function checkDuplicateIP(userId, ip) {
    if (!ip) return [];
    const { data } = await supabase.from('users').select('id, name').eq('ip', ip).neq('id', userId);
    return data || [];
}


// Frontend sẽ so sánh mốc này với mốc nó biết để tránh việc tự lưu game đè mất thay đổi của admin.
async function touchWallet(userId, extraFields = {}) {
    const { error } = await saveUserFields(userId, {
        ...extraFields,
        walletUpdatedAt: new Date().toISOString()
    });
    if (error) console.error(`Lỗi touchWallet ${userId}:`, error);
    return !error;
}

// ==================== ANTI-FRAUD / ANTI-FARM / SESSION RISK ====================
// Chỉ phát hiện hành vi bất thường; KHÔNG auto-ban. Risk được tính từ nhiều tín hiệu kết hợp.
const ANTI_FRAUD_CONFIG = {
    heartbeatMs: 60 * 1000,
    alertCooldownMs: 30 * 60 * 1000,
    stateDays: 30,
    maxIntervals: 60,
    maxReactionTimes: 40,
    thresholds: { monitor: 40, challenge: 60, hold: 80, critical: 90 }
};
const antiFraudDeviceIndexKey = 'anti_fraud_device_index';
let antiFraudDeviceIndexCache = null;
const antiFraudAlertLocks = new Set();

function requestIp(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || '';
}

function hashDeviceFingerprint(signals = {}) {
    const canonical = {
        installId: String(signals.installId || ''),
        platform: String(signals.platform || ''),
        webView: String(signals.webView || ''),
        browser: String(signals.browser || ''),
        language: String(signals.language || ''),
        timezone: String(signals.timezone || ''),
        screen: String(signals.screen || ''),
        colorDepth: Number(signals.colorDepth || 0),
        pixelRatio: Number(signals.pixelRatio || 0),
        hardwareConcurrency: Number(signals.hardwareConcurrency || 0),
        deviceMemory: Number(signals.deviceMemory || 0),
        maxTouchPoints: Number(signals.maxTouchPoints || 0),
        hasTouch: !!signals.hasTouch
    };
    return crypto.createHmac('sha256', String(BOT_TOKEN || process.env.SUPABASE_ANON_KEY || 'anti-fraud'))
        .update(JSON.stringify(canonical))
        .digest('hex')
        .slice(0, 32);
}

function emptyFraudState() {
    return {
        version: 1,
        firstActivityAt: null,
        lastActivityAt: null,
        lastActiveDay: null,
        consecutiveActiveDays: 0,
        session: { id: null, startedAt: null, lastHeartbeat: null },
        deviceHash: '',
        platform: '',
        webView: '',
        browser: '',
        language: '',
        timezone: '',
        ip: '',
        riskScore: 0,
        riskLevel: 'LOW',
        suspiciousSignals: [],
        lastAlertAt: 0,
        lastAlertScore: 0,
        retryCount: 0,
        actionTimes: [],
        actionIntervals: [],
        reactionTimes: [],
        days: {}
    };
}

function normalizeFraudState(raw) {
    const st = { ...emptyFraudState(), ...(raw && typeof raw === 'object' ? raw : {}) };
    st.session = { ...emptyFraudState().session, ...(raw?.session || {}) };
    st.days = raw?.days && typeof raw.days === 'object' ? { ...raw.days } : {};
    st.actionTimes = Array.isArray(raw?.actionTimes) ? raw.actionTimes.slice(-ANTI_FRAUD_CONFIG.maxIntervals) : [];
    st.actionIntervals = Array.isArray(raw?.actionIntervals) ? raw.actionIntervals.slice(-ANTI_FRAUD_CONFIG.maxIntervals) : [];
    st.reactionTimes = Array.isArray(raw?.reactionTimes) ? raw.reactionTimes.slice(-ANTI_FRAUD_CONFIG.maxReactionTimes) : [];
    return st;
}

function stddev(values) {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
}

function fraudTimingStats(values) {
    const nums = values.filter(v => Number.isFinite(Number(v))).map(Number);
    if (!nums.length) return { count: 0, average: 0, variance: 0, cv: 0, min: 0, max: 0 };
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const sd = stddev(nums);
    return {
        count: nums.length,
        average: avg,
        variance: sd * sd,
        cv: avg > 0 ? sd / avg : 0,
        min: Math.min(...nums),
        max: Math.max(...nums)
    };
}

function ensureFraudDay(state, day) {
    if (!state.days[day]) {
        state.days[day] = {
            activeMs: 0, rewardEvents: 0, qc: 0, smartlink: 0, delivery: 0,
            quiz: 0, task: 0, coins: 0, orders: 0, spins: 0
        };
    }
    return state.days[day];
}

function pruneFraudDays(state, keepDays = ANTI_FRAUD_CONFIG.stateDays) {
    const keys = Object.keys(state.days).sort();
    if (keys.length <= keepDays) return;
    for (const key of keys.slice(0, keys.length - keepDays)) delete state.days[key];
}

function fraudLevel(score) {
    if (score >= ANTI_FRAUD_CONFIG.thresholds.critical) return 'CRITICAL';
    if (score >= ANTI_FRAUD_CONFIG.thresholds.hold) return 'HIGH';
    if (score >= ANTI_FRAUD_CONFIG.thresholds.challenge) return 'MEDIUM';
    if (score >= ANTI_FRAUD_CONFIG.thresholds.monitor) return 'LOW-MEDIUM';
    return 'LOW';
}

function recommendedFraudAction(score) {
    if (score >= ANTI_FRAUD_CONFIG.thresholds.critical) return 'BLOCK REWARD + ADMIN REVIEW';
    if (score >= ANTI_FRAUD_CONFIG.thresholds.hold) return 'HOLD WITHDRAWAL / SENSITIVE REWARD REVIEW';
    if (score >= ANTI_FRAUD_CONFIG.thresholds.challenge) return 'CHALLENGE / VERIFICATION';
    if (score >= ANTI_FRAUD_CONFIG.thresholds.monitor) return 'MONITOR';
    return 'NORMAL';
}

function calculateFraudRisk(state, duplicateIpAccounts = 0, duplicateDeviceAccounts = 0) {
    const reasons = [];
    let score = 0;
    const today = vietnamDayKey();
    const day = ensureFraudDay(state, today);
    const hours = Number(day.activeMs || 0) / 3600000;
    const timing = fraudTimingStats(state.actionIntervals);
    const reactions = fraudTimingStats(state.reactionTimes);
    const velocity = hours > 0.25 ? Number(day.rewardEvents || 0) / hours : Number(day.rewardEvents || 0);

    if (timing.count >= 8 && timing.average >= 4000 && timing.average <= 60000 && timing.cv <= 0.03) {
        score += 14;
        reasons.push(`Timing action gần như đều nhau (CV ${(timing.cv * 100).toFixed(2)}%)`);
    } else if (timing.count >= 12 && timing.cv <= 0.06) {
        score += 8;
        reasons.push(`Timing action biến thiên thấp (CV ${(timing.cv * 100).toFixed(2)}%)`);
    }

    if (reactions.count >= 6 && reactions.average >= 5000 && reactions.cv <= 0.04) {
        score += 12;
        reasons.push(`Reaction time QC rất ổn định (CV ${(reactions.cv * 100).toFixed(2)}%)`);
    } else if (reactions.count >= 10 && reactions.cv <= 0.08) {
        score += 7;
        reasons.push(`Reaction time lặp lại bất thường`);
    }

    if (hours >= 18) {
        score += 20;
        reasons.push(`Hoạt động khoảng ${hours.toFixed(1)} giờ/ngày`);
    } else if (hours >= 14) {
        score += 13;
        reasons.push(`Hoạt động khoảng ${hours.toFixed(1)} giờ/ngày`);
    } else if (hours >= 10) {
        score += 5;
        reasons.push(`Hoạt động kéo dài ${hours.toFixed(1)} giờ/ngày`);
    }

    if (Number(state.consecutiveActiveDays || 0) >= 7 && hours >= 12) {
        score += 15;
        reasons.push(`${state.consecutiveActiveDays} ngày hoạt động liên tiếp`);
    } else if (Number(state.consecutiveActiveDays || 0) >= 3 && hours >= 12) {
        score += 8;
        reasons.push(`Hoạt động kéo dài ${state.consecutiveActiveDays} ngày liên tiếp`);
    }

    if (velocity >= 30) {
        score += 18;
        reasons.push(`Reward velocity cao: ${velocity.toFixed(1)} action/giờ`);
    } else if (velocity >= 20) {
        score += 10;
        reasons.push(`Reward velocity bất thường: ${velocity.toFixed(1)} action/giờ`);
    }

    if (Number(state.retryCount || 0) >= 20) {
        score += 14;
        reasons.push(`Retry/request bất thường: ${state.retryCount}`);
    } else if (Number(state.retryCount || 0) >= 10) {
        score += 7;
        reasons.push(`Nhiều retry: ${state.retryCount}`);
    }

    if (duplicateDeviceAccounts >= 2) {
        score += 14;
        reasons.push(`DeviceHash dùng bởi ${duplicateDeviceAccounts + 1} tài khoản`);
    } else if (duplicateDeviceAccounts === 1) {
        score += 7;
        reasons.push('DeviceHash trùng thêm 1 tài khoản');
    }

    if (duplicateIpAccounts >= 4) {
        score += 10;
        reasons.push(`IP trùng ${duplicateIpAccounts + 1} tài khoản`);
    } else if (duplicateIpAccounts >= 2) {
        score += 5;
        reasons.push(`IP trùng ${duplicateIpAccounts + 1} tài khoản`);
    }

    // Chỉ là tín hiệu môi trường, không kết luận emulator từ một thuộc tính.
    const envSignals = [
        state.hardwareConcurrency <= 2 ? 'CPU concurrency thấp' : '',
        state.maxTouchPoints === 0 && /android|iphone|ipad|mobile/i.test(`${state.platform} ${state.browser}`) ? 'Mobile environment không có touch point' : '',
        Number(state.deviceMemory || 0) === 1 ? 'Device memory rất thấp' : ''
    ].filter(Boolean);
    if (envSignals.length) {
        score += Math.min(8, envSignals.length * 3);
        envSignals.forEach(s => reasons.push(`Môi trường bất thường: ${s}`));
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
        score,
        level: fraudLevel(score),
        reasons,
        timing,
        reactions,
        activeHoursToday: hours,
        rewardVelocity: velocity
    };
}

async function loadAntiFraudDeviceIndex() {
    if (antiFraudDeviceIndexCache) return antiFraudDeviceIndexCache;
    try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', antiFraudDeviceIndexKey).maybeSingle();
        if (error) throw error;
        let value = data?.value || {};
        if (typeof value === 'string') {
            try { value = JSON.parse(value); } catch (_) { value = {}; }
        }
        antiFraudDeviceIndexCache = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) {
        console.error('Không đọc được anti-fraud device index:', e.message);
        antiFraudDeviceIndexCache = {};
    }
    return antiFraudDeviceIndexCache;
}

async function updateAntiFraudDeviceIndex(deviceHash, userId) {
    if (!deviceHash) return [];
    const index = await loadAntiFraudDeviceIndex();
    const key = String(deviceHash);
    const ids = Array.isArray(index[key]) ? index[key].map(String) : [];
    if (!ids.includes(String(userId))) ids.push(String(userId));
    index[key] = ids.slice(-20);
    await supabase.from('app_settings').upsert({ key: antiFraudDeviceIndexKey, value: index }, { onConflict: 'key' });
    return index[key].filter(id => id !== String(userId));
}

async function getWithdrawalSummary(userId) {
    try {
        const { data, error } = await supabase.from('withdrawals')
            .select('amount,status,createdAt')
            .eq('userId', userId)
            .order('createdAt', { ascending: false })
            .limit(10);
        if (error) throw error;
        const rows = data || [];
        return {
            total: rows.length,
            pending: rows.filter(w => w.status === 'pending').length,
            success: rows.filter(w => w.status === 'success').length,
            rejected: rows.filter(w => ['rejected', 'refunded'].includes(w.status)).length,
            recent: rows.slice(0, 5).map(w => `${w.status}:${Number(w.amount || 0).toLocaleString()} VNĐ`).join(', ') || 'Không có'
        };
    } catch (_) {
        return { total: 0, pending: 0, success: 0, rejected: 0, recent: 'Không đọc được' };
    }
}

async function maybeSendAntiFraudAlert(userId, state, duplicateIpAccounts, duplicateDeviceAccounts, stats) {
    const score = Number(stats.score || 0);
    if (score < ANTI_FRAUD_CONFIG.thresholds.challenge) return;
    const now = Date.now();
    const severityChanged = score >= ANTI_FRAUD_CONFIG.thresholds.critical && Number(state.lastAlertScore || 0) < ANTI_FRAUD_CONFIG.thresholds.critical;
    if (!severityChanged && now - Number(state.lastAlertAt || 0) < ANTI_FRAUD_CONFIG.alertCooldownMs) return;
    const lockKey = String(userId);
    if (antiFraudAlertLocks.has(lockKey)) return;
    antiFraudAlertLocks.add(lockKey);
    try {
        const user = await readUserRow(userId);
        const withdrawal = await getWithdrawalSummary(userId);
        const ageSource = user?.data?.accountCreatedAt || user?.data?.createdAt || user?.data?.joinDate || null;
        const ageMs = ageSource ? Math.max(0, now - new Date(ageSource).getTime()) : 0;
        const currentDay = ensureFraudDay(state, vietnamDayKey());
        const msg =
`⚠️ ANTI-FRAUD ALERT

User ID: ${userId}
Tên: ${user?.data?.name || 'N/A'}

Risk Score: ${score}/100

Mức độ: ${stats.level}

IP: ${state.ip || 'N/A'}
Device Hash: ${state.deviceHash || 'N/A'}

Platform: ${state.platform || 'N/A'}
WebView / Browser: ${state.webView || 'N/A'} / ${state.browser || 'N/A'}

Account Age: ${ageMs > 0 ? `${(ageMs / 86400000).toFixed(1)} ngày` : 'N/A'}

Session Duration: ${state.session?.startedAt ? `${((now - Number(state.session.startedAt)) / 3600000).toFixed(2)} giờ` : 'N/A'}
Active Hours Today: ${stats.activeHoursToday.toFixed(2)}
Consecutive Active Days: ${state.consecutiveActiveDays || 0}

QC Today: ${currentDay.qc || 0}
SmartLink Today: ${currentDay.smartlink || 0}
Delivery Today: ${currentDay.delivery || 0}
Quiz Today: ${currentDay.quiz || 0}

Reward Velocity: ${stats.rewardVelocity.toFixed(2)} action/hour
Coins / hour: ${stats.activeHoursToday > 0 ? ((currentDay.coins || 0) / stats.activeHoursToday).toFixed(1) : '0'}
Orders / hour: ${stats.activeHoursToday > 0 ? ((currentDay.orders || 0) / stats.activeHoursToday).toFixed(1) : '0'}

Average Action Interval: ${stats.timing.average > 0 ? `${(stats.timing.average / 1000).toFixed(2)}s` : 'N/A'}
Timing Variance: ${stats.timing.variance.toFixed(2)}
Reaction Time Variance: ${stats.reactions.variance.toFixed(2)}

Retry Count: ${state.retryCount || 0}

Duplicate IP Accounts: ${duplicateIpAccounts}
Duplicate Device Accounts: ${duplicateDeviceAccounts}

Withdrawal History: total=${withdrawal.total}, pending=${withdrawal.pending}, success=${withdrawal.success}, rejected/refunded=${withdrawal.rejected}
Recent Withdrawals: ${withdrawal.recent}

Suspicious Signals:
${stats.reasons.length ? stats.reasons.map(s => `- ${s}`).join('\n') : '- Không có'}

Recommended Action:
${recommendedFraudAction(score)}

Detected At: ${vietnamTimeText(new Date(now))}`;
        await safeSendMessage(ADMIN_ID, msg);
        state.lastAlertAt = now;
        state.lastAlertScore = score;
        await saveUserExtra(userId, { antiFraud: state });
    } finally {
        antiFraudAlertLocks.delete(lockKey);
    }
}

async function recordAntiFraudEvent(userId, eventType, meta = {}) {
    try {
        const id = String(userId || '');
        if (!id) return { score: 0, level: 'LOW', blocked: false };
        const state = normalizeFraudState(await getUserExtra(id).then(x => x?.antiFraud));
        const now = Date.now();
        const today = vietnamDayKey(new Date(now));
        const day = ensureFraudDay(state, today);

        if (!state.firstActivityAt) state.firstActivityAt = now;
        if (state.lastActiveDay !== today) {
            const previous = state.lastActiveDay;
            if (previous) {
                const prevDate = new Date(`${previous}T00:00:00+07:00`);
                const currDate = new Date(`${today}T00:00:00+07:00`);
                const dayDiff = Math.round((currDate - prevDate) / 86400000);
                state.consecutiveActiveDays = dayDiff === 1 ? Number(state.consecutiveActiveDays || 0) + 1 : 1;
            } else {
                state.consecutiveActiveDays = 1;
            }
            state.lastActiveDay = today;
        }

        const previousActivity = Number(state.lastActivityAt || 0);
        if (previousActivity > 0 && now > previousActivity) {
            const gap = now - previousActivity;
            if (gap <= 5 * 60 * 1000) {
                day.activeMs += gap;
                const actionGap = now - previousActivity;
                if (eventType !== 'heartbeat') {
                    state.actionIntervals.push(actionGap);
                    state.actionIntervals = state.actionIntervals.slice(-ANTI_FRAUD_CONFIG.maxIntervals);
                }
            }
        }
        state.lastActivityAt = now;

        if (meta.isHeartbeat && state.session.id !== String(meta.sessionId || '')) {
            state.session = { id: String(meta.sessionId || ''), startedAt: now, lastHeartbeat: now };
        } else if (meta.isHeartbeat) {
            state.session.lastHeartbeat = now;
        } else if (!state.session.startedAt) {
            state.session = { id: String(meta.sessionId || ''), startedAt: now, lastHeartbeat: now };
        }

        const payload = meta.device || {};
        if (payload.platform || payload.webView || payload.browser || payload.language || payload.timezone) {
            state.platform = String(payload.platform || state.platform || '');
            state.webView = String(payload.webView || state.webView || '');
            state.browser = String(payload.browser || state.browser || '');
            state.language = String(payload.language || state.language || '');
            state.timezone = String(payload.timezone || state.timezone || '');
            state.hardwareConcurrency = Number(payload.hardwareConcurrency || state.hardwareConcurrency || 0);
            state.deviceMemory = Number(payload.deviceMemory || state.deviceMemory || 0);
            state.maxTouchPoints = Number(payload.maxTouchPoints ?? state.maxTouchPoints ?? 0);
            const newDeviceHash = hashDeviceFingerprint(payload);
            const shouldRefreshDeviceIndex = !state.deviceHash || state.deviceHash !== newDeviceHash;
            state.deviceHash = newDeviceHash;
            state.ip = String(meta.ip || state.ip || '');
            if (shouldRefreshDeviceIndex) {
                const duplicates = await updateAntiFraudDeviceIndex(state.deviceHash, id);
                state.duplicateDeviceAccounts = duplicates.length;
            }
        }

        if (meta.clickIntervals && Array.isArray(meta.clickIntervals)) {
            for (const value of meta.clickIntervals) {
                const n = Number(value);
                if (Number.isFinite(n) && n > 0 && n < 10 * 60 * 1000) state.actionIntervals.push(n);
            }
            state.actionIntervals = state.actionIntervals.slice(-ANTI_FRAUD_CONFIG.maxIntervals);
        }

        if (Number.isFinite(Number(meta.reactionTime)) && Number(meta.reactionTime) > 0) {
            state.reactionTimes.push(Number(meta.reactionTime));
            state.reactionTimes = state.reactionTimes.slice(-ANTI_FRAUD_CONFIG.maxReactionTimes);
        }

        if (meta.retry) state.retryCount = Number(state.retryCount || 0) + 1;

        if (eventType !== 'heartbeat' && meta.countAction !== false) {
            day.rewardEvents += meta.rewardEvent ? 1 : 0;
            if (eventType === 'ad') day.qc += 1;
            if (eventType === 'smartlink') day.smartlink += 1;
            if (eventType === 'delivery') day.delivery += 1;
            if (eventType === 'quiz') day.quiz += 1;
            if (eventType === 'task') day.task += 1;
            day.coins += Number(meta.coins || 0);
            day.orders += Number(meta.orders || 0);
            day.spins += Number(meta.spins || 0);
        }

        pruneFraudDays(state);
        const duplicateIpCheckedAt = Number(state.duplicateIpCheckedAt || 0);
        const shouldCheckIp = Boolean(meta.ip) && (
            meta.checkDuplicateIp === true ||
            String(state.ip || '') !== String(meta.ip) ||
            !Number.isFinite(Number(state.duplicateIpAccounts)) ||
            now - duplicateIpCheckedAt > 30 * 60 * 1000
        );
        const duplicateIpRows = shouldCheckIp ? await checkDuplicateIP(id, meta.ip) : [];
        if (shouldCheckIp) {
            state.duplicateIpAccounts = duplicateIpRows.length;
            state.duplicateIpCheckedAt = now;
        }
        const stats = calculateFraudRisk(state, duplicateIpRows.length, Number(state.duplicateDeviceAccounts || 0));
        state.riskScore = stats.score;
        state.riskLevel = stats.level;
        state.suspiciousSignals = stats.reasons;

        await saveUserExtra(id, { antiFraud: state });
        maybeSendAntiFraudAlert(id, state, Number(state.duplicateIpAccounts || duplicateIpRows.length || 0), Number(state.duplicateDeviceAccounts || 0), stats).catch(e => console.error('Anti-fraud alert:', e.message));

        return {
            ...stats,
            blockedReward: stats.score >= ANTI_FRAUD_CONFIG.thresholds.critical,
            holdWithdrawal: stats.score >= ANTI_FRAUD_CONFIG.thresholds.hold
        };
    } catch (e) {
        console.error(`Anti-fraud event ${eventType} ${userId}:`, e.message);
        return { score: 0, level: 'LOW', reasons: [], blockedReward: false, holdWithdrawal: false };
    }
}

async function getAntiFraudState(userId) {
    const extra = await getUserExtra(String(userId));
    const state = normalizeFraudState(extra?.antiFraud);
    const day = ensureFraudDay(state, vietnamDayKey());
    const stats = calculateFraudRisk(state, 0, Number(state.duplicateDeviceAccounts || 0));
    state.riskScore = stats.score;
    state.riskLevel = stats.level;
    state.suspiciousSignals = stats.reasons;
    return { state, stats, day };
}

async function antiFraudRewardGate(userId) {
    const { state, stats } = await getAntiFraudState(userId);
    if (stats.score >= ANTI_FRAUD_CONFIG.thresholds.critical) {
        void maybeSendAntiFraudAlert(userId, state, 0, Number(state.duplicateDeviceAccounts || 0), stats);
        return { allowed: false, status: 429, reason: 'Hệ thống đang tạm giữ reward để kiểm tra bảo mật.', riskScore: stats.score, riskLevel: stats.level };
    }
    return { allowed: true, riskScore: stats.score, riskLevel: stats.level };
}

async function atomicWalletMutation(userId, { deltaCoins = 0, deltaOrders = 0, deltaSpins = 0, setFields = {}, maxRetries = 6 } = {}) {
    const id = String(userId);
    const numericDeltas = {
        coins: Number(deltaCoins || 0),
        orders: Number(deltaOrders || 0),
        spins: Number(deltaSpins || 0)
    };
    const allSetFields = { ...(setFields || {}) };

    // Chia field theo schema thực tế: field có thật -> users (CAS), field thiếu -> user_extra_state.
    // Không bao giờ gửi trực tiếp cột giả vào PostgREST vì 1 cột thiếu có thể làm hỏng toàn bộ reward.
    const { known: knownSetFields, extra: extraSetFields } = await splitUserFields(allSetFields);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { data: current, error: readError } = await readUserRow(id);
        if (readError || !current) return { error: readError || new Error('Không tìm thấy user.') };

        const update = { ...knownSetFields, walletUpdatedAt: new Date().toISOString() };
        if (numericDeltas.coins !== 0) update.coins = Number(current.coins || 0) + numericDeltas.coins;
        if (numericDeltas.orders !== 0) update.orders = Number(current.orders || 0) + numericDeltas.orders;
        if (numericDeltas.spins !== 0) update.spins = Number(current.spins || 0) + numericDeltas.spins;

        let query = supabase.from('users').update(update).eq('id', id);
        if (numericDeltas.coins !== 0) query = query.eq('coins', Number(current.coins || 0));
        if (numericDeltas.orders !== 0) query = query.eq('orders', Number(current.orders || 0));
        if (numericDeltas.spins !== 0) query = query.eq('spins', Number(current.spins || 0));

        for (const [field] of Object.entries(knownSetFields)) {
            if (Object.prototype.hasOwnProperty.call(current, field)) {
                query = query.eq(field, current[field] ?? null);
            }
        }

        const { data: updated, error } = await query.select('id,coins,orders,spins,walletUpdatedAt');
        if (error) {
            // Schema có thể đổi giữa chừng; split lại ở vòng kế tiếp.
            if (error.code === '42703' || error.code === 'PGRST204') {
                await getUserColumns(true);
                continue;
            }
            return { error };
        }

        if (updated && updated.length > 0) {
            // Extra-state được ghi qua cơ chế merge/cache hiện hữu để không làm mất field khác.
            // Không coi lỗi flush tạm thời là reward failure: dirty flag sẽ retry tự động.
            if (Object.keys(extraSetFields).length) {
                await saveUserExtra(id, extraSetFields);
                scheduleUserExtraFlush();
            }
            return { error: null, data: updated[0] };
        }
    }

    return { error: new Error('Ví vừa thay đổi đồng thời, vui lòng thử lại.') };
}
// Che 1 phần tên để đăng công khai lên banner toàn server mà không lộ danh tính đầy đủ (vd top 3 BXH tuần)
function maskName(name) {
    if (!name || typeof name !== 'string') return 'Người dùng';
    const clean = name.trim();
    if (clean.length <= 2) return clean + '***';
    return clean.slice(0, 2) + '***';
}

// Ghi 1 sự kiện công khai (top 3 BXH tuần...) lên banner chạy chữ toàn server. Không chặn luồng chính nếu lỗi
// (vd bảng activity_log chưa tồn tại trên DB thật do chưa chạy migration cũ).
async function logActivity(message) {
    try {
        await insertRowSafe('activity_log', { message });
    } catch (e) {
        console.error('Lỗi ghi activity_log:', e.message);
    }
}

// Ghi 1 dòng lịch sử biến động coin/đơn hàng của user (dùng cho lệnh /saoke). type: 'coin' | 'orders'.
// amount có thể âm (bị trừ) hoặc dương (được cộng). Chỉ ghi được cho các thao tác SERVER BIẾT được lý do
// cụ thể (lệnh admin, nhập code, mời bạn, rút tiền, thưởng BXH tuần, /thuhoi...) - các khoản coin/đơn hàng
// người dùng tự kiếm trong game (giao hàng, nhiệm vụ, mở rương...) được tính hoàn toàn ở CLIENT và chỉ
// đồng bộ TỔNG số cuối cùng lên server mỗi ~30s, nên server KHÔNG biết chính xác lý do riêng của khoản đó.
async function logTransaction(userId, type, amount, reason) {
    try {
        await insertRowSafe('transactions', { userId, type, amount, reason });
    } catch (e) {
        console.error('Lỗi ghi transactions:', e.message);
    }
}

// Xây dựng nội dung thông báo "lượt mời chưa thành công" gửi cho người mời, CHỈ liệt kê đúng những điều
// kiện người được mời CÒN THIẾU tại thời điểm gửi (không hiển thị điều kiện đã hoàn thành) - phản ánh đúng
// 5 điều kiện thực tế mà tryFinalizeReferral() đang xét ở trên, không tự bịa hay đổi điều kiện referral.
function buildReferralPendingConditionsText(userRow, isMemberNow) {
    const missing = [];
    if (!isMemberNow) missing.push('✅ Tham gia đầy đủ nhóm Telegram bắt buộc');
    if ((userRow?.lifetimeAdsWatched || 0) < 3) missing.push('✅ Xem ít nhất 3 quảng cáo hợp lệ');
    if ((userRow?.lifetimeSmartlinks || 0) < 2) missing.push('✅ Hoàn thành ít nhất 2 SmartLink');
    if ((userRow?.deliveryCountLifetime || 0) < 1) missing.push('✅ Giao hàng ít nhất 1 lần');
    if (userRow?.isBanned) missing.push('✅ Tài khoản không bị khóa/ban');
    return missing.length > 0
        ? missing.join('\n')
        : '✅ Đã hoàn tất các điều kiện, hệ thống sẽ tự động xác nhận trong ít phút.';
}

// Thử xác nhận 1 lượt mời bạn hợp lệ. Điều kiện đầy đủ:
// 1) Người được mời đã tham gia đủ nhóm Telegram bắt buộc
// 2) Người được mời đã xem tối thiểu 3 quảng cáo (lifetimeAdsWatched >= 3)
// 3) Người được mời đã bấm tối thiểu 2 SmartLink (lifetimeSmartlinks >= 2)
// 3b) Người được mời đã giao hàng tối thiểu 1 lần (deliveryCountLifetime >= 1)
// 4) Chưa từng được tính hợp lệ trước đó (referrerCounted = false)
// Có thể được gọi từ nhiều nơi (bot /start, callback_query, API xem QC) nên hàm tự kiểm tra lại từ DB,
// không tin tưởng dữ liệu client gửi lên.
async function tryFinalizeReferral(userId, precomputedIsMember = null) {
    const { data: userRecord, error: userError } = await readUserRow(userId);
    if (userError || !userRecord) return { ok: false, reason: 'user_not_found' };
    if (!userRecord.referrerId || userRecord.referrerId === userId) return { ok: false, reason: 'no_referrer' };
    if (userRecord.referrerCounted) return { ok: false, reason: 'already_counted' };
    if (userRecord.isBanned) return { ok: false, reason: 'banned' };

    const isMember = precomputedIsMember !== null ? precomputedIsMember : await checkUserMembership(userId);
    if (!isMember) return { ok: false, reason: 'not_member' };

    if ((userRecord.lifetimeAdsWatched || 0) < 3) return { ok: false, reason: 'not_enough_ads' };
    if ((userRecord.lifetimeSmartlinks || 0) < 2) return { ok: false, reason: 'not_enough_smartlinks' };
    if ((userRecord.deliveryCountLifetime || 0) < 1) return { ok: false, reason: 'not_enough_delivery' };

    // FIX LỖI "MỜI 1 BẠN NHƯNG BÁO 2 HỢP LỆ" (race condition): hàm này có thể bị gọi gần như đồng thời từ
    // nhiều nơi (bot /start, nút "Xác Nhận" callback_query, và API /api/check-referral gọi mỗi lần user
    // xem xong 1 QC). Trước đây, TẤT CẢ các lệnh gọi đều đọc referrerCounted=false rồi mới ghi true ở CUỐI
    // cùng -> nếu 2 lệnh gọi trùng thời điểm, cả 2 đều "lọt qua" điều kiện referrerCounted=false phía trên
    // và đều cộng thưởng cho người mời -> user thấy 2 tin nhắn xác nhận hợp lệ dù chỉ mời đúng 1 bạn.
    // Cách fix: "khóa" (claim) NGAY LÚC NÀY bằng 1 lệnh UPDATE có điều kiện WHERE referrerCounted = false.
    // Do Postgres xử lý UPDATE tuần tự cho từng dòng, chỉ DUY NHẤT 1 lệnh gọi trúng điều kiện và nhận được
    // dòng trả về; các lệnh gọi thua cuộc (dù đọc thấy referrerCounted=false trước đó) sẽ nhận mảng RỖNG ở
    // đây và dừng lại ngay, không cộng thưởng lần 2.
    const { data: claimRows, error: claimError } = await supabase.from('users')
        .update({ referrerCounted: true })
        .eq('id', userId)
        .eq('referrerCounted', false)
        .select('id');
    if (claimError) {
        console.error(`Lỗi claim referral cho ${userId}:`, claimError);
        return { ok: false, reason: 'claim_error' };
    }
    if (!claimRows || claimRows.length === 0) {
        // Một lệnh gọi khác đã claim và xử lý xong trong lúc hàm này đang chạy các bước kiểm tra ở trên
        return { ok: false, reason: 'already_counted' };
    }

    const { data: refUser, error: refError } = await readUserRow(userRecord.referrerId);
    if (refError || !refUser) {
        // Đã claim (referrerCounted=true) nhưng không cộng thưởng được -> hoàn tác claim để không mất
        // vĩnh viễn lượt hợp lệ này, cho phép hệ thống tự thử lại ở lần gọi tiếp theo.
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId);
        return { ok: false, reason: 'referrer_not_found' };
    }

    const INSTANT_REF_COINS = 500;
    const INSTANT_REF_ORDERS = 1000;

    // FIX LỖI "SỐ BẠN HỢP LỆ CAO HƠN SỐ BẠN ĐÃ MỜI": tăng validInvites bằng atomicIncrement (thay vì
    // đọc-rồi-ghi) để không bị mất lượt tăng khi nhiều referral của CÙNG 1 người mời hoàn tất gần như
    // đồng thời. Đồng thời chốt chặn an toàn: validInvites không bao giờ được vượt quá invitedCount
    // (về logic không thể có nhiều bạn "hợp lệ" hơn số bạn thực tế đã mời).
    const newValid = await atomicIncrement(userRecord.referrerId, 'validInvites', 1);
    if (newValid === null) {
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId);
        return { ok: false, reason: 'update_failed' };
    }
    // Đếm riêng cho BXH TUẦN (được reset về 0 mỗi tuần bởi weeklyLeaderboardReset(), khác với validInvites
    // là tổng trọn đời dùng cho mốc thưởng mời bạn, không bao giờ reset).
    await atomicIncrement(userRecord.referrerId, 'weeklyValidInvites', 1);
    await atomicIncrement(userRecord.referrerId, 'dailyValidInvites', 1);
    if (newValid > (refUser.invitedCount || 0)) {
        // Dữ liệu invitedCount cũ (trước khi vá lỗi) có thể vẫn còn thấp hơn thực tế -> tự sửa lại cho khớp
        await saveUserFields(userRecord.referrerId, { invitedCount: newValid });
    }

    const referralWalletMutation = await atomicWalletMutation(userRecord.referrerId, {
        deltaCoins: INSTANT_REF_COINS,
        deltaOrders: INSTANT_REF_ORDERS
    });
    if (referralWalletMutation.error) {
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId).eq('referrerCounted', true);
        return { ok: false, reason: 'wallet_update_failed' };
    }
    await recordAntiFraudEvent(userRecord.referrerId, 'task', {
        rewardEvent: true, coins: INSTANT_REF_COINS, orders: INSTANT_REF_ORDERS
    });
    logTransaction(userRecord.referrerId, 'coin', INSTANT_REF_COINS, `Mời bạn thành công: ${userRecord.name}`);
    logTransaction(userRecord.referrerId, 'orders', INSTANT_REF_ORDERS, `Mời bạn thành công: ${userRecord.name}`);

    // FIX: referralMilestones có thể đã là mảng (Supabase trả về jsonb dạng object) thay vì chuỗi JSON,
    // JSON.parse(object) sẽ ném lỗi và làm hỏng cả luồng cộng thưởng mời bạn -> chỉ parse khi là chuỗi.
    let milestonesData = [];
    if (Array.isArray(refUser.referralMilestones)) milestonesData = refUser.referralMilestones;
    else if (typeof refUser.referralMilestones === 'string' && refUser.referralMilestones) {
        try { milestonesData = JSON.parse(refUser.referralMilestones); } catch (_) { milestonesData = []; }
    }
    const nextMilestone = milestonesData.find(m => m.friends > newValid);
    const progressText = nextMilestone
        ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn (Phần thưởng mốc: ${nextMilestone.reward})`
        : '🏆 Đã đạt tất cả các mốc!';

    await safeSendMessage(userRecord.referrerId,
        `✅ *Xác nhận hợp lệ!* ${userRecord.name} đã tham gia đủ nhóm và xem đủ QC.\n🎁 Nhận ngay: *+${INSTANT_REF_COINS.toLocaleString()} Coin + ${INSTANT_REF_ORDERS.toLocaleString()} Đơn Hàng*\n📊 Tổng hợp lệ: *${newValid}*\n${progressText}`,
        { parse_mode: 'Markdown' }
    );

    return { ok: true, validInvites: newValid };
}

// ==================== BOT LOGIC ====================

// FIX LỖI GỐC "ADMIN DÙNG LỆNH BOT KHÔNG PHẢN HỒI" (VÀ CẢ BOT IM LẶNG VỚI MỌI NGƯỜI DÙNG):
// Telegraf mặc định xử lý TUẦN TỰ - nó CHỜ XONG hoàn toàn 1 update (1 lệnh/tin nhắn) rồi mới poll lấy
// update tiếp theo từ Telegram. Vì vậy, nếu MỘT lệnh bất kỳ (không nhất thiết của admin, có thể là 1 lệnh
// của user thường chạy TRƯỚC đó) bị "treo" quá lâu hoặc vô thời hạn (vd Supabase phản hồi chậm/mất mạng,
// Telegram API rate-limit khi getChatMember...) mà không có giới hạn thời gian, request đó sẽ không bao
// giờ resolve/reject -> bot.catch() KHÔNG BAO GIỜ được kích hoạt (vì nó chỉ bắt lỗi khi promise reject,
// không bắt được khi promise "treo" không phản hồi) -> TOÀN BỘ vòng lặp polling bị nghẽn vĩnh viễn, khiến
// bot ngừng phản hồi với TẤT CẢ mọi người kể cả Admin, đúng hiện tượng đã gặp phải. Middleware dưới đây
// đặt giới hạn tối đa 20 giây cho MỖI update: nếu xử lý quá lâu, coi như "hết giờ", báo lỗi cho người dùng
// và cho phép vòng lặp polling CHẠY TIẾP ngay lập tức (không đợi tác vụ treo phía sau), đảm bảo 1 lệnh bị
// treo không bao giờ làm nghẽn toàn bộ bot nữa.
const BOT_UPDATE_TIMEOUT_MS = 20000;
bot.use(async (ctx, next) => {
    const nextPromise = next(); // Bắt đầu chạy handler thật ngay lập tức, không chờ
    const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => resolve('__timeout__'), BOT_UPDATE_TIMEOUT_MS);
    });
    const winner = await Promise.race([nextPromise, timeoutPromise]);
    if (winner === '__timeout__') {
        console.error(`⏱️ Update (${ctx.updateType}) từ user ${ctx.from?.id} xử lý quá ${BOT_UPDATE_TIMEOUT_MS / 1000}s -> đã bỏ qua để không làm treo toàn bộ bot.`);
        ctx.reply('⏱️ Yêu cầu đang xử lý quá lâu (có thể do máy chủ dữ liệu phản hồi chậm). Vui lòng thử lại sau ít giây.').catch(() => {});
        // handler thật vẫn tiếp tục chạy ngầm phía sau (không huỷ được vì Supabase/Telegram API không hỗ
        // trợ abort) - vẫn lắng nghe để LOG lỗi thật nếu có, tránh mất dấu debug và tránh cảnh báo
        // "unhandled rejection" thừa cho promise này.
        nextPromise.catch((err) => {
            console.error(`⚠️ Lỗi xử lý update (${ctx.updateType}) từ user ${ctx.from?.id} (xảy ra SAU khi đã hết giờ 20s):`, err);
        });
        return;
    }
    // next() đã xử lý xong TRONG thời hạn cho phép (kể cả trường hợp lỗi) -> nếu next() reject,
    // Promise.race ở trên đã reject và ném lỗi ra ngoài hàm này như bình thường, để bot.catch() phía trên
    // xử lý đúng như trước khi có middleware này (không thay đổi hành vi báo lỗi hiện có).
});

// Middleware chặn TOÀN BỘ tương tác của user thường khi bot đang bị khoá bảo trì (admin vẫn dùng được
// bình thường để có thể tự /mokhoabot mở lại). Đặt TRƯỚC mọi lệnh/handler khác để chặn sớm nhất.
bot.use(async (ctx, next) => {
    if (BOT_LOCKED && !isMainAdmin(ctx)) {
        const chatType = ctx.chat?.type;
        const isGroupOrChannel = chatType === 'group' || chatType === 'supergroup' || chatType === 'channel';
        if (isGroupOrChannel) {
            // Im lặng hoàn toàn trong group/supergroup/channel khi bot bị khoá - không reply, không cảnh báo.
            return;
        }
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(MAINTENANCE_MESSAGE, { show_alert: true }).catch(() => {});
        }
        return ctx.reply(MAINTENANCE_MESSAGE).catch(() => {});
    }
    return next();
});

// /khoabot - Khoá Bot & Mini App để bảo trì (chỉ Admin)
bot.command('khoabot', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await setBotLocked(true);
    ctx.reply("🔒 Đã khoá Bot & Mini App để bảo trì.\nNgười dùng sẽ nhận thông báo: \"" + MAINTENANCE_MESSAGE + "\"\nDùng /mokhoabot để mở khoá lại.");
});

// /mokhoabot - Mở khoá Bot & Mini App (chỉ Admin)
bot.command('mokhoabot', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await setBotLocked(false);
    ctx.reply("🔓 Đã mở khoá Bot & Mini App. Người dùng có thể sử dụng bình thường trở lại.");
});

// /addadmin <ID> - Phong 1 user làm admin phụ (CHỈ Admin chính được dùng lệnh này)
// Admin phụ dùng được tất cả lệnh admin khác nhưng KHÔNG thể tự thêm/xoá admin (vẫn dưới quyền Admin chính).
bot.command('addadmin', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /addadmin <ID>");
    if (targetId === String(ADMIN_ID)) return ctx.reply("⚠️ ID này đã là Admin chính.");
    if (subAdminIds.has(targetId)) return ctx.reply("⚠️ User này đã là admin phụ rồi.");

    const { error } = await supabase.from('admins').upsert({ id: targetId, addedBy: String(ctx.from.id) });
    if (error) {
        console.error('Lỗi thêm admin phụ:', error);
        return ctx.reply("❌ Lỗi khi thêm admin (kiểm tra đã tạo bảng \"admins\" trên Supabase chưa).");
    }
    await loadAdmins(); // Nạp lại cache ngay để có hiệu lực tức thì
    ctx.reply(`✅ Đã phong user ${targetId} làm *Admin phụ*.\nUser này giờ dùng được tất cả lệnh admin (trừ /addadmin, /xoaadmin).`, { parse_mode: 'Markdown' });
    safeSendMessage(targetId, "🎉 Bạn vừa được phong làm *Admin phụ*! Giờ bạn có thể dùng các lệnh quản trị của bot.", { parse_mode: 'Markdown' });
});

// /xoaadmin <ID> - Hạ 1 admin phụ xuống lại thành user thường (CHỈ Admin chính được dùng lệnh này)
bot.command('xoaadmin', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /xoaadmin <ID>");
    if (targetId === String(ADMIN_ID)) return ctx.reply("❌ Không thể xoá quyền Admin chính.");
    if (!subAdminIds.has(targetId)) return ctx.reply("⚠️ User này không phải admin phụ.");

    const { error } = await supabase.from('admins').delete().eq('id', targetId);
    if (error) {
        console.error('Lỗi xoá admin phụ:', error);
        return ctx.reply("❌ Lỗi khi xoá admin.");
    }
    await loadAdmins();
    ctx.reply(`✅ Đã hạ user ${targetId} xuống lại thành người dùng thường.`);
    safeSendMessage(targetId, "ℹ️ Bạn đã bị gỡ quyền *Admin phụ*.", { parse_mode: 'Markdown' });
});

// /listadmins - Xem danh sách admin hiện tại
bot.command('listadmin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    let msg = `👑 *Admin chính:* \`${ADMIN_ID}\`\n\n`;
    if (subAdminIds.size === 0) {
        msg += "📭 Chưa có admin phụ nào.";
    } else {
        msg += `🛡️ *Admin phụ (${subAdminIds.size}):*\n` + [...subAdminIds].map(id => `\`${id}\``).join('\n');
    }
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /start - Kiểm tra tham gia nhóm BẮT BUỘC TRƯỚC khi cho vào miniapp
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    const referrerId = ctx.startPayload;

    try {
        let userRecord;
        const { data: existingUser } = await supabase.from('users').select('*').eq('id', userId).single();
        
        if (!existingUser) {
            const newUser = {
                id: userId,
                name: userName,
                referrerId: referrerId || null,
                coins: 0,
                orders: 0,
                spins: 1,
                truckLevel: 1,
                adsToday: 0,
                smartlinksToday: 0,
                invitedCount: 0,
                validInvites: 0,
                referralMilestones: JSON.stringify([ // Default milestones
                    { friends: 5, reward: '1,000 Coin + 2,000 Đơn Hàng', coins: 1000, orders: 2000, spins: 0, claimed: false },
                    { friends: 10, reward: '1,000 Coin + 1 Lượt Mở Rương + 1,000 Đơn Hàng', coins: 1000, orders: 1000, spins: 1, claimed: false },
                    { friends: 20, reward: '1,500 Coin + 1,000 Đơn Hàng', coins: 1500, orders: 1000, spins: 0, claimed: false },
                    { friends: 30, reward: '3,000 Đơn Hàng + 1 Lượt Mở Rương', coins: 0, orders: 3000, spins: 1, claimed: false },
                    { friends: 50, reward: '3,000 Coin + 5,000 Đơn Hàng', coins: 3000, orders: 5000, spins: 0, claimed: false },
                    { friends: 75, reward: '7,000 Đơn Hàng + 3 Lượt Mở Rương', coins: 0, orders: 7000, spins: 3, claimed: false },
                    { friends: 100, reward: '20,000 Đơn Hàng + 7 Lượt Mở Rương', coins: 0, orders: 20000, spins: 7, claimed: false }
                ]),
                isBanned: false,
                referrerCounted: false, // Thêm trường này để kiểm soát việc đã đếm hợp lệ cho người mời hay chưa
                lifetimeAdsWatched: 0, // Tổng số QC đã xem trọn đời (không reset theo ngày) - điều kiện xét mời bạn hợp lệ
                accountCreatedAt: new Date().toISOString(),
                deliveryCountLifetime: 0,
                dailyValidInvites: 0,
                bonusAdsToday: 0, // Số lượt QC Rewarded nhiệm vụ hôm nay
                quizDate: '',
                quizFreeUsed: false,
                quizAdUnlocked: 0,
                quizUsedIds: [],
                chestOpensTotal: 0, // Tổng số lượt đã mở rương (trọn đời) - dùng cho /checkID
                chestOpensToday: 0, // Số lượt đã mở rương hôm nay - dùng cho /checkID, reset mỗi ngày
                walletUpdatedAt: new Date().toISOString() // Mốc thời gian admin sửa ví gần nhất, dùng để chống ghi đè dữ liệu
            };
            const { known: newUserRow, extra: newUserExtra } = await splitUserFields(newUser);
            const { data: insertedUser, error: insertError } = await supabase.from('users').insert(newUserRow).select().single();
            if (insertError) {
                console.error("Lỗi tạo user mới:", insertError);
                return ctx.reply("⚠️ Có lỗi xảy ra khi tạo tài khoản, vui lòng thử lại sau!");
            }
            if (Object.keys(newUserExtra).length > 0) await saveUserExtra(userId, newUserExtra);
            userRecord = { ...newUserExtra, ...insertedUser };
            
            // Tăng invitedCount cho người mời (chưa tính hợp lệ)
            // Dùng atomicIncrement thay vì đọc-rồi-ghi để không bị "mất lượt mời" khi nhiều người cùng
            // vào bằng chung 1 link giới thiệu gần như đồng thời (xem giải thích chi tiết ở atomicIncrement).
            if (referrerId && referrerId !== userId) { // Đảm bảo người mời không phải chính mình
                const newCount = await atomicIncrement(referrerId, 'invitedCount', 1);
                if (newCount !== null) {
                    // FIX: trước đây thông báo ghi "🎉 Bạn vừa mời thành công" ngay khi bạn bè chỉ mới BẤM
                    // VÀO LINK (chưa tham gia đủ nhóm, chưa xem QC nào) khiến người mời hiểu lầm là đã nhận
                    // thưởng. Đổi thành thông báo trung thực: chỉ báo có người vào bằng link, CHƯA thành
                    // công, kèm nhắc nhở ĐÚNG các điều kiện còn thiếu thực tế (không hiển thị điều kiện đã
                    // đủ). Thưởng + thông báo "thành công" thật sự chỉ được gửi trong tryFinalizeReferral()
                    // khi bạn bè ĐÃ đủ điều kiện.
                    const isMemberAtInvite = await checkUserMembership(userId).catch(() => false);
                    const conditionsText = buildReferralPendingConditionsText(userRecord, isMemberAtInvite);
                    await safeSendMessage(referrerId, 
                        `👋 *${userName}* vừa tham gia Mini App bằng link giới thiệu của bạn!\n⚠️ Lượt mời này *chưa được tính thành công*.\n\nĐể được tính hợp lệ, bạn ấy cần hoàn tất:\n${conditionsText}\n\n🎁 Khi đủ điều kiện, hệ thống sẽ tự động xác nhận lượt mời và cộng thưởng cho bạn.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        } else {
            userRecord = existingUser;
            if (userRecord.isBanned) {
                return ctx.reply("❌ Tài khoản của bạn đã bị khóa. Liên hệ admin để được hỗ trợ.");
            }
            // FIX LỖI TÊN BỊ GHI ĐÈ SAI (vd hiện "🚫 BANNED - RESET 🚫" thay vì tên thật): trường "name"
            // trước đây chỉ được ghi 1 LẦN DUY NHẤT lúc tạo tài khoản, không bao giờ tự làm mới lại từ
            // Telegram. Nếu dữ liệu "name" từng bị chỉnh sai (vd admin sửa tay trong Supabase làm dấu
            // ghi chú nội bộ rồi quên đổi lại) thì tên sai đó tồn tại vĩnh viễn. Giờ mỗi lần user gõ
            // /start, tự đồng bộ lại đúng tên thật hiện tại từ Telegram (ctx.from.first_name) nếu khác
            // với tên đang lưu, giúp tự "chữa lành" mọi trường hợp tên bị sai mà không cần admin sửa tay.
            if (userName && userRecord.name !== userName) {
                await supabase.from('users').update({ name: userName }).eq('id', userId);
                userRecord.name = userName;
            }
        }

        // Kiểm tra tham gia nhóm
        const isMember = await checkUserMembership(userId);

        if (isMember) {
            // Nếu có referrer và chưa được đếm hợp lệ -> thử xác nhận (cần đủ nhóm + đủ 3 QC đã xem)
            await tryFinalizeReferral(userId, true);

            // Gửi nút mở Mini App
            ctx.reply(`Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`, {
                reply_markup: { 
                    inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] 
                }
            });
        } else {
            // Yêu cầu tham gia nhóm TRƯỚC khi cho vào miniapp
            ctx.reply(
                "⚠️ *Bạn chưa tham gia đủ 2 nhóm bắt buộc!*\n\n" +
                "Vui lòng tham gia 2 nhóm dưới đây:\n" +
                "1️⃣ https://t.me/khohangkiemtien (Kênh thông báo)\n" +
                "2️⃣ https://t.me/khohangchatkiemtien (Nhóm chat)\n\n" +
                "Sau khi tham gia xong, nhấn nút *Xác Nhận* bên dưới để bot kiểm tra.",
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "1️⃣ Tham gia Kênh", url: "https://t.me/khohangkiemtien" }],
                            [{ text: "2️⃣ Tham gia Nhóm Chat", url: "https://t.me/khohangchatkiemtien" }],
                            [{ text: "✅ Xác Nhận Bot Kiểm Tra", callback_data: "check_groups" }]
                        ]
                    }
                }
            );
        }
    } catch (err) {
        console.error("Lỗi /start:", err);
        ctx.reply("⚠️ Có lỗi xảy ra, vui lòng thử lại sau!");
    }
});

// Xử lý nút "Xác Nhận Bot Kiểm Tra"
// FIX LỖI "BẤM NÚT KHÔNG THẤY PHẢN HỒI GÌ": trước đây handler này không có try/catch. Nếu có lỗi xảy ra
// giữa chừng (Supabase timeout, Telegram API lỗi...) thì ctx.answerCbQuery() ở nhánh thành công không bao
// giờ được gọi -> nút bấm bị kẹt ở trạng thái "đang tải" (vòng xoay loading) trên Telegram cho tới khi hết
// hạn, giống hệt hiện tượng "bot không phản hồi". Giờ mọi lỗi đều được bắt và LUÔN trả lời (answerCbQuery)
// để tắt vòng xoay loading, đồng thời báo lỗi rõ ràng cho người dùng.
bot.on('callback_query', async (ctx) => {
    if (ctx.callbackQuery.data === 'check_groups') {
        const userId = ctx.from.id.toString();
        const userName = ctx.from.first_name || 'User';

        try {
            await ctx.answerCbQuery("🔍 Đang kiểm tra...");

            const isMember = await checkUserMembership(userId);

            if (isMember) {
                const { data: userRecord, error: userError } = await supabase.from('users').select('*').eq('id', userId).single();
                if (userError) {
                    console.error("Lỗi lấy user trong callback:", userError);
                    return ctx.editMessageText("⚠️ Có lỗi xảy ra, vui lòng thử lại sau!").catch(() => {});
                }

                // Nếu có referrer và chưa được đếm hợp lệ -> thử xác nhận (cần đủ nhóm + đủ 3 QC đã xem)
                await tryFinalizeReferral(userId, true);

                await ctx.editMessageText(
                    `Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`,
                    {
                        reply_markup: {
                            inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]]
                        }
                    }
                );
            } else {
                await ctx.answerCbQuery("❌ Bạn vẫn chưa tham gia đủ 2 nhóm! Vui lòng tham gia cả Kênh và Nhóm Chat rồi nhấn lại.");
            }
        } catch (err) {
            console.error("Lỗi xử lý callback check_groups:", err);
            // Luôn cố gắng tắt vòng xoay loading trên nút, kể cả khi answerCbQuery ở trên đã lỡ chưa chạy tới
            await ctx.answerCbQuery("⚠️ Đã có lỗi xảy ra, vui lòng thử lại sau ít giây.").catch(() => {});
        }
    }
});

// ==================== LỆNH ADMIN ====================

// /thongke
bot.command('thongke', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: usersStats } = await supabase.from('users').select('adsToday, smartlinksToday');
    const { data: pendingWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'pending');
    const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
    const { data: rejectedWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'rejected');
    const { data: refundedWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'refunded'); // Thêm thống kê hoàn trả
    
    const totalAds = usersStats ? usersStats.reduce((sum, u) => sum + (u.adsToday || 0), 0) : 0;
    const totalSmartlinks = usersStats ? usersStats.reduce((sum, u) => sum + (u.smartlinksToday || 0), 0) : 0;
    const totalPending = pendingWithdraws ? pendingWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalSuccess = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalRejected = rejectedWithdraws ? rejectedWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalRefunded = refundedWithdraws ? refundedWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    
    ctx.reply(
        `📊 *THỐNG KÊ CHI TIẾT*\n\n` +
        `👥 Tổng User: *${totalUsers || 0}*\n` +
        `📺 Tổng QC đã xem (hôm nay): *${totalAds}*\n` +
        `🔗 Tổng Smartlink đã ấn (hôm nay): *${totalSmartlinks}*\n\n` +
        `💰 *TÀI CHÍNH:*\n` +
        `⏳ Chờ duyệt: *${totalPending.toLocaleString()} VNĐ*\n` +
        `✅ Đã duyệt: *${totalSuccess.toLocaleString()} VNĐ*\n` +
        `❌ Đã từ chối: *${totalRejected.toLocaleString()} VNĐ*\n` +
        `🔄 Đã hoàn trả: *${totalRefunded.toLocaleString()} VNĐ*`,
        { parse_mode: 'Markdown' }
    );
});

// /quantri - thống kê nhanh
bot.command('quantri', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
    const totalWithdrawn = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    ctx.reply(`📊 *Thống kê nhanh:*\n👥 Tổng User: *${totalUsers || 0}*\n💰 Tổng tiền đã duyệt: *${totalWithdrawn.toLocaleString()} VNĐ*`, { parse_mode: 'Markdown' });
});

// /ban
bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /ban <userId>");
    await touchWallet(targetId, { isBanned: true });
    ctx.reply(`✅ Đã ban user ${targetId}`);
});

// /unban
bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /unban <userId>");
    await touchWallet(targetId, { isBanned: false });
    ctx.reply(`✅ Đã unban user ${targetId}`);
});

// /congcoin
bot.command('congcoin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /congcoin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('coins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    await touchWallet(targetId, { coins: (data.coins || 0) + amount });
    logTransaction(targetId, 'coin', amount, `Admin ${ctx.from.id} cộng coin (/congcoin)`);
    ctx.reply(`✅ Đã cộng ${amount} coin cho ${targetId}. Số dư mới: ${(data.coins || 0) + amount}`);
});

// /trucoin
bot.command('trucoin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /trucoin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('coins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    const newCoins = Math.max(0, (data.coins || 0) - amount);
    await touchWallet(targetId, { coins: newCoins });
    logTransaction(targetId, 'coin', -amount, `Admin ${ctx.from.id} trừ coin (/trucoin)`);
    ctx.reply(`✅ Đã trừ ${amount} coin của ${targetId}. Số dư mới: ${newCoins}`);
});

// /addspin
bot.command('addspin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /addspin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('spins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    await touchWallet(targetId, { spins: (data.spins || 0) + amount });
    ctx.reply(`✅ Đã cộng ${amount} lượt mở rương cho ${targetId}`);
});

// /adddonhang
bot.command('adddonhang', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /adddonhang <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('orders').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    await touchWallet(targetId, { orders: (data.orders || 0) + amount });
    logTransaction(targetId, 'orders', amount, `Admin ${ctx.from.id} cộng đơn hàng (/adddonhang)`);
    ctx.reply(`✅ Đã cộng ${amount} đơn hàng cho ${targetId}`);
});

// /trudonhang - Trừ đơn hàng của 1 user (không cho âm)
bot.command('trudonhang', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /trudonhang <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('orders').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    const newOrders = Math.max(0, (data.orders || 0) - amount);
    await touchWallet(targetId, { orders: newOrders });
    logTransaction(targetId, 'orders', -amount, `Admin ${ctx.from.id} trừ đơn hàng (/trudonhang)`);
    ctx.reply(`✅ Đã trừ ${amount} đơn hàng của ${targetId}. Số dư mới: ${newOrders}`);
});

// /truspin - Trừ lượt mở rương của 1 user (không cho âm)
bot.command('truspin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /truspin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('spins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    const newSpins = Math.max(0, (data.spins || 0) - amount);
    await touchWallet(targetId, { spins: newSpins });
    ctx.reply(`✅ Đã trừ ${amount} lượt mở rương của ${targetId}. Số dư mới: ${newSpins}`);
});

// /addref <userId> <số_ref> - Cộng thêm N lượt mời BẠN HỢP LỆ cho user (dùng khi cần bù thủ công, vd bạn
// bè lỡ không tự xác nhận được, hoặc tri ân sự kiện...). Cộng validInvites VÀ invitedCount (đảm bảo
// invitedCount luôn >= validInvites, đúng bất biến của hệ thống mời bạn), đồng thời cộng thẳng vào ví TOÀN
// BỘ phần thưởng "hợp lệ tức thì" mà user sẽ nhận được TỰ ĐỘNG cho mỗi lượt mời hợp lệ thật (1.000 Coin +
// 2.000 Đơn Hàng / bạn) nhân với N. Các mốc thưởng lớn hơn (5/10/20/30/50/75/100 bạn) vẫn do chính user tự
// bấm "Nhận" trong Mini App như bình thường khi validInvites chạm mốc, không tự phát ở đây để không phá vỡ
// luồng nhận mốc thưởng đã có sẵn.
bot.command('addref', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /addref <userId> <số_ref>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    if (!amount || amount <= 0) return ctx.reply("❌ Số ref phải là số nguyên dương.");

    const { data, error } = await supabase.from('users')
        .select('validInvites, invitedCount, coins, orders').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");

    const INSTANT_REF_COINS = 500;
    const INSTANT_REF_ORDERS = 1000;
    const newValid = (data.validInvites || 0) + amount;
    const newInvited = Math.max(data.invitedCount || 0, newValid);
    const bonusCoins = INSTANT_REF_COINS * amount;
    const bonusOrders = INSTANT_REF_ORDERS * amount;

    const ok = await touchWallet(targetId, {
        validInvites: newValid,
        invitedCount: newInvited,
        coins: (data.coins || 0) + bonusCoins,
        orders: (data.orders || 0) + bonusOrders
    });
    if (!ok) return ctx.reply("❌ Lỗi khi cập nhật dữ liệu user.");

    ctx.reply(`✅ Đã cộng ${amount} lượt mời hợp lệ cho ${targetId}.\n📊 Tổng hợp lệ mới: ${newValid}\n🎁 Đã cộng thưởng: +${bonusCoins.toLocaleString()} Coin + ${bonusOrders.toLocaleString()} Đơn Hàng`);
    safeSendMessage(targetId, `🎉 Admin vừa cộng thêm *${amount}* lượt mời bạn hợp lệ cho bạn!\n🎁 Nhận thêm: *+${bonusCoins.toLocaleString()} Coin + ${bonusOrders.toLocaleString()} Đơn Hàng*\n📊 Tổng hợp lệ hiện tại: *${newValid}*`, { parse_mode: 'Markdown' });
});

// /setlevel
bot.command('setlevel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /setlevel <userId> <cấp_độ>");
    const targetId = parts[1];
    const level = parseInt(parts[2]);
    if (level < 1 || level > MAX_TRUCK_LEVEL) return ctx.reply(`❌ Cấp độ phải từ 1-${MAX_TRUCK_LEVEL}`);
    await touchWallet(targetId, { truckLevel: level });
    ctx.reply(`✅ Đã đặt cấp độ xe của ${targetId} lên ${level}`);
});

// /resetdaily
bot.command('resetdaily', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /resetdaily <userId>");
    await touchWallet(targetId, { 
        adsToday: 0, 
        smartlinksToday: 0,
        bonusAdsToday: 0,
        deliveryCount: 0,
        smartlinkCount: 0,
        spinAdCount: 0,
        spinFree: 1,
        chestOpensToday: 0,
        lastResetDate: addVietnamDays(vietnamDayKey(), -1) // Đặt ngày reset về hôm qua để kích hoạt reset khi mini app load
    });
    ctx.reply(`✅ Đã reset nhiệm vụ hàng ngày cho ${targetId}`);
});

// Toàn bộ field cần đưa về 0 / trạng thái khởi đầu khi reset 1 user hoặc tất cả user
// (đơn hàng, coin, lượt mở rương, số bạn mời được, số qc đã xem, số smartlink đã ấn, số lv xe)
function fullResetFields() {
    return {
        coins: 0,
        orders: 0,
        spins: 0,
        truckLevel: 1, // Cấp xe thấp nhất hệ thống hỗ trợ (không có cấp 0)
        currentProducts: 0,
        lastProducedAt: Date.now(),
        productionInterval: 30 * 60 * 1000,
        adsToday: 0,
        smartlinksToday: 0,
        smartlinkCount: 0,
        usedSmartlinks: [],
        spinAdCount: 0,
        spinAdProgress: 0,
        bonusAdsToday: 0,
        rewardedAdsToday: 0,
        extraDeliveryAdsToday: 0,
        extraDeliveryCount: 0,
        quizDate: '',
        quizFreeUsed: false,
        quizAdUnlocked: 0,
        quizUsedIds: [],
        chestOpensTotal: 0,
        chestOpensToday: 0,
        lifetimeAdsWatched: 0,
        accountCreatedAt: new Date().toISOString(),
        deliveryCountLifetime: 0,
        dailyValidInvites: 0,
        invitedCount: 0,
        validInvites: 0,
        deliveryCount: 0,
        referralMilestones: JSON.stringify([
            { friends: 5, reward: '1,000 Coin + 2,000 Đơn Hàng', coins: 1000, orders: 2000, spins: 0, claimed: false },
            { friends: 10, reward: '1,000 Coin + 1 Lượt Mở Rương + 1,000 Đơn Hàng', coins: 1000, orders: 1000, spins: 1, claimed: false },
            { friends: 20, reward: '1,500 Coin + 1,000 Đơn Hàng', coins: 1500, orders: 1000, spins: 0, claimed: false },
            { friends: 30, reward: '3,000 Đơn Hàng + 1 Lượt Mở Rương', coins: 0, orders: 3000, spins: 1, claimed: false },
            { friends: 50, reward: '3,000 Coin + 5,000 Đơn Hàng', coins: 3000, orders: 5000, spins: 0, claimed: false },
            { friends: 75, reward: '7,000 Đơn Hàng + 3 Lượt Mở Rương', coins: 0, orders: 7000, spins: 3, claimed: false },
            { friends: 100, reward: '20,000 Đơn Hàng + 7 Lượt Mở Rương', coins: 0, orders: 20000, spins: 7, claimed: false }
        ]),
        lastResetDate: addVietnamDays(vietnamDayKey(), -1)
    };
}

// Xóa lịch sử nhập giftcode để (các) user có thể NHẬP LẠI những code đã từng nhập trước khi bị admin
// reset (theo yêu cầu). Đồng thời hoàn trả lại đúng số lượt đã dùng (usedCount) cho từng code tương ứng,
// tránh việc quỹ lượt nhập của code bị hao hụt oan khi cho phép nhập lại.
// userId = null -> áp dụng cho TẤT CẢ user (dùng cho /resetall). userId cụ thể -> chỉ 1 user (dùng cho /reset).
async function resetGiftcodeRedemptions(userId = null) {
    let query = supabase.from('giftcode_redemptions').select('code, userId');
    if (userId) query = query.eq('userId', userId);
    const { data: redemptions, error } = await query;
    if (error) {
        console.error('Lỗi lấy giftcode_redemptions để reset:', error);
        return;
    }
    if (!redemptions || redemptions.length === 0) return;

    // Gộp số lượt cần hoàn trả theo từng code
    const refundByCode = {};
    redemptions.forEach(r => { refundByCode[r.code] = (refundByCode[r.code] || 0) + 1; });

    for (const [code, refundCount] of Object.entries(refundByCode)) {
        const { data: gcRow } = await supabase.from('giftcodes').select('usedCount').eq('code', code).single();
        if (gcRow) {
            await supabase.from('giftcodes').update({ usedCount: Math.max(0, (gcRow.usedCount || 0) - refundCount) }).eq('code', code);
        }
    }

    let delQuery = supabase.from('giftcode_redemptions').delete();
    delQuery = userId ? delQuery.eq('userId', userId) : delQuery.not('userId', 'is', null);
    const { error: delError } = await delQuery;
    if (delError) console.error('Lỗi xóa giftcode_redemptions:', delError);
}


// /reset <userId> - Reset TOÀN BỘ dữ liệu của 1 user về 0
bot.command('reset', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /reset <userId>");
    const ok = await touchWallet(targetId, fullResetFields());
    await saveWeeklyAdsCounts({ ...(await getWeeklyAdsCounts()), [String(targetId)]: 0 });
    await resetGiftcodeRedemptions(targetId); // Cho phép user nhập lại các code đã nhập trước khi reset
    if (ok) ctx.reply(`✅ Đã reset toàn bộ dữ liệu của user ${targetId} về 0 (kể cả lịch sử nhập code).`);
    else ctx.reply(`❌ Lỗi khi reset dữ liệu user ${targetId}.`);
});

// /resetall - Reset TOÀN BỘ dữ liệu bot về trạng thái ban đầu. CHỈ Admin CHÍNH (ADMIN_ID) được dùng,
// Admin phụ KHÔNG được dùng lệnh này (dùng isMainAdmin thay vì isAdmin). Vì đây là thao tác PHÁ HUỶ
// KHÔNG THỂ HOÀN TÁC (xoá sạch dữ liệu mọi user), bắt buộc phải xác nhận lại bằng /confirmreset trong
// vòng RESETALL_CONFIRM_TTL_MS trước khi thực sự thực thi, tránh trường hợp admin gõ nhầm lệnh.
const pendingResetAllConfirm = new Map(); // adminId -> mốc thời gian hết hạn xác nhận
const RESETALL_CONFIRM_TTL_MS = 60 * 1000;
bot.command('resetall', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    pendingResetAllConfirm.set(String(ctx.from.id), Date.now() + RESETALL_CONFIRM_TTL_MS);
    ctx.reply("⚠️ Xác nhận reset toàn bộ dữ liệu? Gõ /confirmreset để tiếp tục.");
});

// /confirmreset - Bước xác nhận bắt buộc của /resetall. Chỉ thực thi nếu ĐÚNG Admin chính vừa gõ
// /resetall trước đó và còn trong thời hạn xác nhận, nếu không sẽ không làm gì cả (an toàn).
bot.command('confirmreset', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    const adminId = String(ctx.from.id);
    const expireAt = pendingResetAllConfirm.get(adminId);
    pendingResetAllConfirm.delete(adminId);
    if (!expireAt || Date.now() > expireAt) {
        return ctx.reply("⚠️ Chưa có yêu cầu /resetall nào đang chờ xác nhận (hoặc đã hết hạn 60s). Vui lòng gõ /resetall trước.");
    }

    try {
        // 1) Users: coin/đơn hàng/lượt mở rương/level xe/nhiệm vụ/QC/ref... về 0, và MỞ BAN toàn bộ user
        // (yêu cầu "Danh sách ban" cũng phải được reset về trạng thái ban đầu).
        const { known: resetRow } = await splitUserFields({
            ...fullResetFields(),
            isBanned: false,
            walletUpdatedAt: new Date().toISOString()
        });
        const { error } = await supabase.from('users').update(resetRow).not('id', 'is', null);
        if (error) {
            console.error("Lỗi /confirmreset:", error);
            return ctx.reply("❌ Lỗi khi reset toàn bộ dữ liệu: " + error.message);
        }

        // 2) Dữ liệu phụ ngoài bảng users (app_settings: user_extra_state) - gồm cả Anti-fraud/Session per-user
        await clearUserExtra(null);

        // 3) BXH Xem QC tuần
        await saveWeeklyAdsCounts({});

        // 4) Lịch sử nhập Giftcode (đồng thời hoàn trả lượt dùng cho từng code)
        await resetGiftcodeRedemptions(null);

        // 5) Giftcode: xoá sạch các mã đã tạo (KHÔNG xoá cấu trúc bảng, chỉ xoá dữ liệu)
        const { error: gcError } = await supabase.from('giftcodes').delete().not('code', 'is', null);
        if (gcError) console.error('Lỗi xoá bảng giftcodes khi /confirmreset:', gcError.message);

        // 6) Lịch sử rút tiền
        const { error: wdError } = await supabase.from('withdrawals').delete().not('id', 'is', null);
        if (wdError) console.error('Lỗi xoá bảng withdrawals khi /confirmreset:', wdError.message);

        // 7) Anti-fraud: xoá index thiết bị dùng chung + cache liên quan trong bộ nhớ
        const { error: afError } = await supabase.from('app_settings').delete().eq('key', antiFraudDeviceIndexKey);
        if (afError) console.error('Lỗi xoá anti_fraud_device_index khi /confirmreset:', afError.message);
        antiFraudDeviceIndexCache = {};

        ctx.reply("✅ Đã reset toàn bộ dữ liệu bot về 0.");
    } catch (e) {
        console.error("Lỗi /confirmreset:", e);
        ctx.reply("❌ Lỗi khi reset toàn bộ dữ liệu: " + e.message);
    }
});

// /deleteuser
bot.command('deleteuser', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /deleteuser <userId>");
    await supabase.from('users').delete().eq('id', targetId);
    ctx.reply(`✅ Đã xóa vĩnh viễn user ${targetId}`);
});

// /doiten - Sửa tên hiển thị của 1 user thủ công (dùng khi tên bị lỗi/ghi sai, không cần chờ user gõ lại /start)
bot.command('doiten', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /doiten <userId> <tên mới>");
    const targetId = parts[1];
    const newName = parts.slice(2).join(' ');
    const { error } = await supabase.from('users').update({ name: newName }).eq('id', targetId);
    if (error) return ctx.reply("❌ Lỗi: " + error.message);
    ctx.reply(`✅ Đã đổi tên user ${targetId} thành: ${newName}`);
});

// /taocode - Tạo code (số đơn hàng + coin + mở rương + số lượt nhập + phạm vi áp dụng)
// Cú pháp: /taocode <mã> <coin> <orders> <spins> <giới_hạn> <phạm_vi>
// <phạm_vi> = "admin" (chỉ Admin chính/phụ mới nhập được, dùng để test code nội bộ)
//           hoặc "nguoidung" (ai cũng nhập được - mặc định dùng cho sự kiện public)
bot.command('taocode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 7) return ctx.reply("❌ Sử dụng: /taocode <mã> <coin> <orders> <spins> <giới_hạn> <phạm_vi>\nPhạm vi: admin hoặc nguoidung\nVí dụ: /taocode TET2024 500 1000 2 100 nguoidung");

    const [, code, coin, orders, spins, limit, scopeRaw] = parts;
    const scope = scopeRaw.toLowerCase() === 'admin' ? 'admin' : 'nguoidung';
    const baseRow = {
        code: code,
        rewardType: 'multi',
        rewardAmount: parseInt(coin) || 0,
        orders: parseInt(orders) || 0,
        spins: parseInt(spins) || 0,
        limitUses: parseInt(limit) || 0,
        usedCount: 0
    };

    // Thử insert đầy đủ (kèm scope/createdBy) trước. Nếu bảng "giftcodes" trên Supabase CHƯA được thêm 2
    // cột này (chưa chạy SQL migration), Postgres sẽ báo lỗi "column does not exist" (mã 42703 hoặc
    // PGRST204) -> tự động fallback insert KHÔNG kèm scope/createdBy để code vẫn được tạo bình thường
    // (khi đó phạm vi sẽ mặc định là "Người dùng" cho tới khi admin chạy SQL migration để bật được tính
    // năng phạm vi "Chỉ Admin"). Nhờ vậy lệnh /taocode KHÔNG BAO GIỜ bị lỗi vì thiếu cột nữa.
    let { error } = await supabase.from('giftcodes').insert({ ...baseRow, scope, createdBy: String(ctx.from.id) });
    let scopeSaved = true;

    if (error && (error.code === '42703' || error.code === 'PGRST204' || /column|scope|createdBy/i.test(error.message || ''))) {
        scopeSaved = false;
        const retry = await supabase.from('giftcodes').insert(baseRow);
        error = retry.error;
    }

    if (error) {
        console.error("Lỗi tạo code:", error);
        return ctx.reply(`❌ Lỗi: Mã code \`${code}\` đã tồn tại hoặc dữ liệu không hợp lệ.\n${error.message ? 'Chi tiết: ' + error.message : ''}`, { parse_mode: 'Markdown' });
    }
    let msg = `✅ Đã tạo code: \`${code}\`\n🪙 Coin: ${coin}\n📦 Đơn hàng: ${orders}\n🎡 Lượt mở rương: ${spins}\n🔢 Giới hạn: ${limit} lần\n🔒 Phạm vi: *${scope === 'admin' ? 'Chỉ Admin' : 'Người dùng'}*`;
    if (!scopeSaved) {
        msg += `\n\n⚠️ *Lưu ý:* chưa lưu được phạm vi (bảng \`giftcodes\` thiếu cột \`scope\`/\`createdBy\`) nên code này tạm thời áp dụng cho *Người dùng*. Chạy SQL migration ở đầu file server.js rồi tạo lại code để bật đúng phạm vi *Chỉ Admin*.`;
    }
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /listcodes
bot.command('listcodes', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { data, error } = await supabase.from('giftcodes').select('*');
    if (error) {
        console.error("Lỗi lấy danh sách code:", error);
        return ctx.reply("❌ Lỗi lấy danh sách code.");
    }
    if (!data || data.length === 0) return ctx.reply("📭 Chưa có giftcode nào.");
    
    let msg = "📜 *Danh sách Giftcode:*\n";
    data.forEach(row => {
        msg += `\n🔹 Mã: \`${row.code}\`\n`;
        msg += `   Loại: ${row.rewardType}\n`;
        if (row.rewardType === 'multi') {
            msg += `   🪙 ${row.rewardAmount || 0} Coin | 📦 ${row.orders || 0} ĐH | 🎡 ${row.spins || 0} lượt\n`;
        } else { // Fallback if rewardType is not multi (e.g., just coin, orders, spins)
            msg += `   SL: ${row.rewardAmount}\n`;
        }
        msg += `   Đã dùng: ${row.usedCount}/${row.limitUses}\n`;
        msg += `   🔒 Phạm vi: ${row.scope === 'admin' ? 'Chỉ Admin' : 'Người dùng'}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /delcode
bot.command('delcode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("❌ Sử dụng: /delcode <mã_code>");
    const { error } = await supabase.from('giftcodes').delete().eq('code', code);
    if (error) {
        console.error("Lỗi xóa code:", error);
        return ctx.reply("❌ Lỗi: Không tìm thấy code hoặc lỗi database.");
    }
    ctx.reply(`✅ Đã xóa code: ${code}`);
});

// /listnguoinhapcode <mã> - Xem TẤT CẢ người dùng đã từng nhập 1 mã code cụ thể (ID, tên, phần thưởng
// nhận, thời gian) - hoạt động ĐƯỢC kể cả khi admin đã /delcode xoá mã đó rồi, vì lệnh này đọc từ lịch sử
// nhập (giftcode_redemptions) chứ không phụ thuộc mã code còn tồn tại trong bảng giftcodes hay không.
bot.command('listnguoinhapcode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("❌ Sử dụng: /listnguoinhapcode <mã_code>");

    let { data: redemptions, error } = await supabase.from('giftcode_redemptions')
        .select('*').eq('code', code).order('createdAt', { ascending: false });
    if (error) {
        // Bảng chưa có cột "createdAt" (chưa chạy SQL migration) -> thử lại KHÔNG sắp xếp theo thời gian
        const retry = await supabase.from('giftcode_redemptions').select('*').eq('code', code);
        redemptions = retry.data;
        error = retry.error;
    }
    if (error) {
        console.error("Lỗi lấy danh sách người nhập code:", error);
        return ctx.reply("❌ Lỗi khi lấy dữ liệu từ database.");
    }
    if (!redemptions || redemptions.length === 0) return ctx.reply(`📭 Chưa có ai nhập mã \`${code}\`.`, { parse_mode: 'Markdown' });

    let msg = `📜 *Danh sách người đã nhập code \`${code}\`* (${redemptions.length} lượt)\n`;
    redemptions.slice(0, 50).forEach(r => {
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString('vi-VN') : 'N/A';
        msg += `\n👤 ID: \`${r.userId}\`${r.userName ? ` (${r.userName})` : ''}\n`;
        msg += `   🪙 +${r.rewardCoin || 0} Coin | 📦 +${r.rewardOrders || 0} ĐH | 🎡 +${r.rewardSpins || 0} lượt\n`;
        msg += `   🕒 ${time}\n`;
    });
    if (redemptions.length > 50) msg += `\n... và ${redemptions.length - 50} lượt khác (đã ẩn bớt để tránh tin nhắn quá dài).`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /thuhoi <mã> - Thu hồi TOÀN BỘ phần thưởng mà mã code này đã phát cho người dùng (Coin, Đơn hàng, Lượt mở rương)
// Cách hoạt động: trừ lại đúng số Coin/Đơn hàng/Lượt mở rương mà code đã cộng cho từng user, giới hạn không
// cho âm (vì Coin/Đơn hàng là 1 quỹ chung dùng chung cho nhiều hoạt động khác nhau, không thể tách riêng
// "đồng nào đến từ code" một khi đã tiêu - nên nếu user đã tiêu hết, số dư sẽ về 0 thay vì âm). Nếu user
// không còn đủ Lượt mở rương để trừ (đã dùng để mở rương rồi) thì lượt mở rương cũng chỉ về tối thiểu 0 -
// tương đương thu hồi lại các lượt mở rương CHƯA DÙNG; những phần thưởng đã nhận được TỪ các lượt mở rương
// đó (ví dụ vật phẩm ngẫu nhiên, hay đơn hàng dùng để nâng cấp xe) không thể truy ngược chính xác 100% vì
// hệ thống không lưu "phả hệ" của từng đồng Coin/Đơn hàng - đây là giới hạn chung của mọi hệ thống có quỹ
// tiền tệ dùng chung (fungible), không riêng gì bot này. Sau khi thu hồi, xoá lịch sử nhập code để user có
// thể nhập lại từ đầu nếu admin mở lại mã, và trả lại đúng usedCount cho code.
bot.command('thuhoi', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("❌ Sử dụng: /thuhoi <mã_code>");

    const { data: redemptions, error: redErr } = await supabase.from('giftcode_redemptions').select('*').eq('code', code);
    if (redErr) {
        console.error("Lỗi lấy redemptions để thu hồi:", redErr);
        return ctx.reply("❌ Lỗi khi lấy dữ liệu người đã nhập code.");
    }
    if (!redemptions || redemptions.length === 0) return ctx.reply(`📭 Chưa có ai nhập mã \`${code}\`, không có gì để thu hồi.`, { parse_mode: 'Markdown' });

    ctx.reply(`⏳ Đang thu hồi mã \`${code}\` từ ${redemptions.length} người dùng, vui lòng đợi...`, { parse_mode: 'Markdown' });

    let successCount = 0, failCount = 0;
    for (const r of redemptions) {
        const { data: u } = await supabase.from('users').select('coins, orders, spins, name').eq('id', r.userId).single();
        if (!u) { failCount++; continue; }
        const newCoins = Math.max(0, (u.coins || 0) - (r.rewardCoin || 0));
        const newOrders = Math.max(0, (u.orders || 0) - (r.rewardOrders || 0));
        const newSpins = Math.max(0, (u.spins || 0) - (r.rewardSpins || 0));
        const ok = await touchWallet(r.userId, { coins: newCoins, orders: newOrders, spins: newSpins });
        if (ok) {
            successCount++;
            if (r.rewardCoin) logTransaction(r.userId, 'coin', -(r.rewardCoin || 0), `Admin thu hồi code "${code}" (/thuhoi)`);
            if (r.rewardOrders) logTransaction(r.userId, 'orders', -(r.rewardOrders || 0), `Admin thu hồi code "${code}" (/thuhoi)`);
            safeSendMessage(r.userId,
                `⚠️ Mã code \`${code}\` bạn đã nhập trước đây vừa bị *Admin thu hồi*.\n🪙 -${r.rewardCoin || 0} Coin | 📦 -${r.rewardOrders || 0} Đơn hàng | 🎡 -${r.rewardSpins || 0} Lượt mở rương\n(Số dư không thể âm nên nếu bạn đã tiêu hết, phần đã tiêu không thể trừ thêm).`,
                { parse_mode: 'Markdown' }
            );
        } else {
            failCount++;
        }
    }

    // Xoá lịch sử nhập + trả usedCount về 0 để mã có thể được nhập lại từ đầu nếu admin muốn mở lại
    await supabase.from('giftcode_redemptions').delete().eq('code', code);
    await supabase.from('giftcodes').update({ usedCount: 0 }).eq('code', code);

    ctx.reply(`✅ Đã thu hồi mã \`${code}\`.\n👥 Thành công: ${successCount} user\n❌ Lỗi: ${failCount} user\n📋 Đã xoá lịch sử nhập, mã có thể được nhập lại từ đầu.`, { parse_mode: 'Markdown' });
});

// /saoke <userId> <coin|donhang> - Xem lịch sử biến động coin/đơn hàng của 1 user, từ những việc nào.
// LƯU Ý: chỉ hiển thị các khoản mà SERVER biết rõ lý do (lệnh admin, nhập code, mời bạn, rút tiền, thưởng
// BXH tuần, /thuhoi...). Các khoản user tự kiếm trong game (giao hàng, nhiệm vụ, mở rương, xem QC...) được
// tính hoàn toàn ở CLIENT, server chỉ nhận tổng số cuối cùng mỗi ~30s nên KHÔNG có lý do chi tiết để hiển thị.
bot.command('saoke', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3 || !['coin', 'donhang'].includes(parts[2])) {
        return ctx.reply("❌ Sử dụng: /saoke <userId> <coin|donhang>");
    }
    const targetId = parts[1];
    const type = parts[2] === 'donhang' ? 'orders' : 'coin';
    const typeLabel = type === 'orders' ? 'Đơn Hàng' : 'Coin';

    const { data: user } = await supabase.from('users').select('name, coins, orders').eq('id', targetId).single();
    if (!user) return ctx.reply("❌ Không tìm thấy user.");

    const { data: rows, error } = await supabase.from('transactions')
        .select('amount, reason, createdAt').eq('userId', targetId).eq('type', type)
        .order('createdAt', { ascending: false }).limit(100);
    if (error) {
        console.error('Lỗi lấy transactions cho /saoke:', error.message);
        return ctx.reply("❌ Lỗi lấy sao kê (có thể DB chưa chạy migration bảng transactions).");
    }
    if (!rows || rows.length === 0) {
        return ctx.reply(`📭 Không có lịch sử biến động ${typeLabel} nào được ghi nhận cho user ${targetId} (${user.name || 'N/A'}).\n\nLưu ý: chỉ các khoản admin/hệ thống biết rõ lý do (lệnh admin, nhập code, mời bạn, rút tiền, thưởng tuần...) mới được ghi lại - các khoản tự kiếm trong game (giao hàng, nhiệm vụ, mở rương) không có chi tiết riêng.`);
    }

    const currentBalance = type === 'orders' ? (user.orders || 0) : (user.coins || 0);
    const header = `📊 *Sao kê ${typeLabel} của ${user.name || 'N/A'} (${targetId})*\n💰 Số dư hiện tại: *${currentBalance.toLocaleString()}*\n📋 ${rows.length} biến động gần nhất (mới nhất trước):\n\n`;

    const entries = rows.map(r => {
        const sign = r.amount >= 0 ? '➕' : '➖';
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'N/A';
        return `${sign} ${Math.abs(r.amount).toLocaleString()} - ${r.reason || 'Không rõ'}\n🕒 ${time}\n---\n`;
    });

    // Chia thành nhiều tin nhắn nhỏ (dùng lại cách xử lý đã sửa ở /donrutall) để không bao giờ bị cắt cụt dữ liệu
    const chunks = [];
    let current = header;
    for (const entry of entries) {
        if ((current + entry).length > 3500) {
            chunks.push(current);
            current = entry;
        } else {
            current += entry;
        }
    }
    if (current.trim()) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
        const pageInfo = chunks.length > 1 ? `\n📄 (Trang ${i + 1}/${chunks.length})` : '';
        await ctx.reply(chunks[i] + pageInfo, { parse_mode: 'Markdown' }).catch(async () => {
            await ctx.reply(chunks[i] + pageInfo).catch(() => {});
        });
    }
});

// /checkID
bot.command('checkID', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /checkID <userId>");
    
    const { data, error } = await supabase.from('users').select('*').eq('id', targetId).single();
    if (error || !data) return ctx.reply("❌ Không tìm thấy user hoặc lỗi database.");
    
    const { data: withdraws } = await supabase.from('withdrawals').select('amount').eq('userId', targetId).eq('status', 'success');
    const totalWithdrawn = withdraws ? withdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    
    // Check IP trùng
    const duplicates = await checkDuplicateIP(targetId, data.ip);
    const dupText = duplicates.length > 0 
        ? `\n⚠️ *IP TRÙNG VỚI:*\n${duplicates.map(d => `- ${d.name} (${d.id})`).join('\n')}`
        : '';
    
    ctx.reply(
        `👤 *Thông tin user:*\n` +
        `🆔 ID: ${data.id}\n` +
        `👤 Tên: ${data.name}\n` +
        `📦 Đơn hàng: ${data.orders}\n` +
        `🪙 Coin: ${data.coins}\n` +
        `🚛 Level xe: ${data.truckLevel}\n` +
        `🎁 Lượt mở rương còn lại: ${data.spins || 0}\n` +
        `🎁 Tổng số lượt đã mở rương: ${(data.chestOpensTotal || 0).toLocaleString()}\n` +
        `🎁 Số lượt mở rương hôm nay: ${(data.chestOpensToday || 0).toLocaleString()}\n` +
        `🌐 IP: ${data.ip || 'Chưa có'}\n` +
        `💰 Tổng tiền đã rút: ${totalWithdrawn.toLocaleString()} VNĐ\n` +
        `👥 Đã mời: ${data.invitedCount} (Hợp lệ: ${data.validInvites})` +
        dupText,
        { parse_mode: 'Markdown' }
    );
});

// /hoantra - Hoàn trả đơn rút tiền chưa duyệt
bot.command('hoantra', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply("❌ Sử dụng: /hoantra <userId> (hoàn trả tất cả đơn chưa duyệt của user)");
    const targetId = parts[1];
    
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (withdrawError) {
        console.error("Lỗi lấy đơn rút để hoàn trả:", withdrawError);
        return ctx.reply("❌ Lỗi database khi lấy đơn rút.");
    }
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có đơn chờ duyệt của user này.");
    
    let totalRefundedOrdersValue = 0;
    for (const w of withdrawals) {
        // Tính lại số đơn hàng đã bị trừ khi user yêu cầu rút (1000 VNĐ = 10000 đơn hàng)
        const ordersToRefund = Math.floor((w.amount || 0) / 1000) * 10000; 
        
        await supabase.from('withdrawals').update({ status: 'refunded', reason: 'Hoàn trả bởi admin' }).eq('id', w.id);
        
        const { data: userData, error: userError } = await supabase.from('users').select('orders').eq('id', targetId).single();
        if (userError) {
            console.error("Lỗi lấy user để hoàn trả đơn hàng:", userError);
            continue; // Bỏ qua nếu lỗi, cố gắng xử lý các yêu cầu rút khác
        }
        const newOrders = (userData?.orders || 0) + ordersToRefund;
        await touchWallet(targetId, { orders: newOrders });
        
        totalRefundedOrdersValue += ordersToRefund; // Đây là giá trị đơn hàng, không phải số tiền
        await safeSendMessage(targetId, `🔄 Yêu cầu rút tiền của bạn đã được HOÀN TRẢ.\n📦 Số đơn hàng được hoàn: ${ordersToRefund.toLocaleString()}`);
    }
    
    ctx.reply(`✅ Đã hoàn trả ${withdrawals.length} đơn của ${targetId}.\n📦 Tổng giá trị đơn hàng hoàn trả: ${totalRefundedOrdersValue.toLocaleString()}`);
});

// /duyet + ID
bot.command('duyet', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /duyet <userId>");
    
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (withdrawError) {
        console.error("Lỗi lấy đơn rút để duyệt:", withdrawError);
        return ctx.reply("❌ Lỗi database khi lấy đơn rút.");
    }
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt cho user này.");
    
    let totalApprovedAmount = 0;
    for (const w of withdrawals) {
        await supabase.from('withdrawals').update({ status: 'success', reason: 'Đã duyệt bởi admin' }).eq('id', w.id);
        totalApprovedAmount += w.amount;
    }
    
    await safeSendMessage(targetId, `✅ Yêu cầu rút tiền của bạn đã được *DUYỆT*!\n💰 Tổng số tiền: ${totalApprovedAmount.toLocaleString()} VNĐ\nTiền sẽ sớm được chuyển vào tài khoản.`, { parse_mode: 'Markdown' });
    ctx.reply(`✅ Đã duyệt ${withdrawals.length} yêu cầu rút của ${targetId}. Tổng: ${totalApprovedAmount.toLocaleString()} VNĐ`);
});

// /huy + ID + lý do
bot.command('huy', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /huy <userId> <lý do>");
    const targetId = parts[1];
    const reason = parts.slice(2).join(' ');
    
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (withdrawError) {
        console.error("Lỗi lấy đơn rút để hủy:", withdrawError);
        return ctx.reply("❌ Lỗi database khi lấy đơn rút.");
    }
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt.");
    
    let totalRefundedOrdersValue = 0;
    for (const w of withdrawals) {
        // Tính lại số đơn hàng đã bị trừ khi user yêu cầu rút (1000 VNĐ = 10000 đơn hàng)
        const ordersToRefund = Math.floor((w.amount || 0) / 1000) * 10000; 

        await supabase.from('withdrawals').update({ status: 'rejected', reason: reason }).eq('id', w.id);
        
        const { data: userData, error: userError } = await supabase.from('users').select('orders').eq('id', targetId).single();
        if (userError) {
            console.error("Lỗi lấy user để hoàn trả đơn hàng khi hủy:", userError);
            continue;
        }
        const newOrders = (userData?.orders || 0) + ordersToRefund;
        await touchWallet(targetId, { orders: newOrders });
        
        totalRefundedOrdersValue += ordersToRefund;
        await safeSendMessage(targetId, `❌ Yêu cầu rút tiền của bạn đã bị *HỦY*.\n📝 Lý do: ${reason}\n📦 Số đơn hàng đã được hoàn trả: ${ordersToRefund.toLocaleString()}`, { parse_mode: 'Markdown' });
    }
    
    ctx.reply(`✅ Đã hủy yêu cầu rút tiền của ${targetId}.\n📝 Lý do: ${reason}\n📦 Tổng giá trị đơn hàng hoàn trả: ${totalRefundedOrdersValue.toLocaleString()}`);
});

// /donrutall - Thống kê đơn rút chưa duyệt + check IP trùng
bot.command('donrutall', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const { data, error } = await supabase.from('withdrawals').select('id, userId, amount, ordersAmount, method, accountInfo, bankName, accountName, accountNumber, status, createdAt').eq('status', 'pending').order('createdAt', { ascending: true });
    if (error) {
        console.error("Lỗi lấy danh sách đơn rút:", error);
        return ctx.reply("❌ Lỗi lấy danh sách đơn rút.");
    }
    if (!data || data.length === 0) return ctx.reply("📭 Không có đơn rút tiền nào đang chờ duyệt.");
    
    let msg = `📋 *Danh sách ${data.length} đơn rút CHỜ DUYỆT:*\n`;
    
    for (const w of data) {
        const { data: userData, error: userError } = await supabase.from('users').select('ip, name').eq('id', w.userId).single();
        if (userError) {
            console.error("Lỗi lấy user data cho donrutall:", userError);
            continue;
        }

        const ip = userData?.ip || 'Chưa có';
        const ordersDeducted = w.ordersAmount || (Math.floor((w.amount || 0) / 1000) * 10000);
        const stkSdt = w.accountNumber || w.accountInfo || 'N/A';
        const chuTK = w.accountName || 'Không có';
        const thoiGian = w.createdAt ? new Date(w.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'N/A';
        
        // Check IP trùng
        const duplicates = await checkDuplicateIP(w.userId, userData?.ip);
        const dupText = duplicates.length > 0 ? `\n⚠️ *IP TRÙNG:* ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}` : '';
        
        msg += `\n🆔 ID: ${w.userId}\n👤 Tên: ${userData?.name || 'N/A'}\n💳 Phương Thức: ${w.method}\n📱 STK/SĐT: ${stkSdt}\n👤 Chủ TK: ${chuTK}\n💰 Số Tiền: ${w.amount.toLocaleString()} VNĐ\n📦 Đơn Hàng Đã Trừ: ${ordersDeducted.toLocaleString()}\n🌐 IP: ${ip}\n🕒 Thời Gian Rút Tiền: ${thoiGian}${dupText}\n---\n`;
        
        // Gửi tin nhắn riêng cho admin nếu IP trùng
        if (duplicates.length > 0) {
            await safeSendMessage(ADMIN_ID, 
                `⚠️ *CẢNH BÁO IP TRÙNG TRONG ĐƠN RÚT!*\n` +
                `👤 User: ${userData?.name} (${w.userId})\n` +
                `🌐 IP: ${ip}\n` +
                `⚠️ Trùng với: ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}\n` +
                `💰 Yêu cầu rút: ${w.amount.toLocaleString()} VNĐ\n` +
                `📝 TTKH: ${w.accountInfo || 'N/A'}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
    
    // FIX LỖI: trước đây khi tin nhắn > 4000 ký tự thì CẮT BỎ toàn bộ phần còn lại (mất dữ liệu các đơn
    // rút phía sau), chỉ báo "quá dài, kiểm tra web admin" - trong khi không có web admin thật để xem chi
    // tiết, nghĩa là các đơn đó không thể xem được nữa. Giờ chia thành NHIỀU tin nhắn nhỏ (mỗi tin ≤ 3500
    // ký tự, luôn cắt đúng ranh giới giữa 2 đơn rút nhờ dấu "---\n", không cắt giữa 1 đơn) và gửi lần lượt,
    // đảm bảo không mất bất kỳ đơn rút nào dù có bao nhiêu đơn đang chờ.
    const header = `📋 *Danh sách ${data.length} đơn rút CHỜ DUYỆT:*\n`;
    const entries = msg.replace(header, '').split('---\n').filter(e => e.trim());
    const chunks = [];
    let current = header;
    for (const entry of entries) {
        const withEntry = entry + '---\n';
        if ((current + withEntry).length > 3500) {
            chunks.push(current);
            current = withEntry;
        } else {
            current += withEntry;
        }
    }
    if (current.trim()) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
        const pageInfo = chunks.length > 1 ? `\n📄 (Trang ${i + 1}/${chunks.length})` : '';
        await ctx.reply(chunks[i] + pageInfo, { parse_mode: 'Markdown' }).catch(async (e) => {
            console.error('Lỗi gửi trang donrutall, gửi lại không dùng Markdown:', e.message);
            await ctx.reply(chunks[i] + pageInfo).catch(() => {}); // Fallback nếu Markdown bị lỗi ký tự đặc biệt
        });
    }
});

// /broadcast
// FIX LỖI "ADMIN DÙNG LỆNH BOT KHÔNG PHẢN HỒI" KHI BROADCAST: trước đây lệnh này AWAIT (chờ) toàn bộ
// vòng lặp gửi tin cho từng user bên trong handler -> vì Telegraf xử lý tuần tự (xem giải thích ở
// middleware timeout-guard phía trên), nếu danh sách user lớn (vài trăm - vài nghìn người, mỗi người cách
// nhau 50ms) thì CẢ BOT bị "đứng hình", không nhận/trả lời được BẤT KỲ lệnh nào khác (kể cả của admin)
// trong suốt thời gian gửi (có thể vài phút). Cách fix: trả lời admin "Đã bắt đầu gửi" NGAY LẬP TỨC rồi để
// vòng lặp gửi chạy NGẦM (background) không chặn middleware chain, nhờ đó bot vẫn phản hồi bình thường mọi
// lệnh khác trong lúc broadcast đang chạy.
bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.substring(11).trim(); // Bỏ '/broadcast '
    if (!msg) return ctx.reply("❌ Nhập tin nhắn cần gửi!");

    const adminChatId = ctx.chat.id;
    ctx.reply("⏳ Đang gửi tin nhắn (chạy ngầm, bot vẫn dùng được bình thường trong lúc gửi)...");

    (async () => {
        try {
            const { data: users, error } = await supabase.from('users').select('id');
            if (error) {
                console.error("Lỗi lấy danh sách user để broadcast:", error);
                return safeSendMessage(adminChatId, "❌ Lỗi database khi lấy danh sách người dùng.");
            }

            let successCount = 0;
            for (const u of users) {
                const sent = await safeSendMessage(u.id, `📢 *THÔNG BÁO TỪ ADMIN:*\n\n${msg}`, { parse_mode: 'Markdown' });
                if (sent) successCount++;
                await new Promise(r => setTimeout(r, 50)); // Giới hạn tốc độ gửi
            }
            await safeSendMessage(adminChatId, `✅ Đã gửi thành công đến ${successCount}/${users.length} người dùng.`);
        } catch (e) {
            console.error("Lỗi broadcast (chạy ngầm):", e);
            safeSendMessage(adminChatId, "❌ Có lỗi xảy ra trong lúc gửi broadcast.").catch(() => {});
        }
    })();
});

// ==================== RESET BXH TUẦN + TRAO THƯỞNG TOP 1-3 ====================
// Trước đây việc "reset BXH mỗi tuần" chỉ được xử lý ở CLIENT (index.html), nghĩa là: (1) chỉ chạy khi có
// user mở app đúng lúc sang tuần mới, (2) không hề trao thưởng thật cho top 1-3 (chỉ xóa số liệu hiển thị
// tạm trên máy người đó). Chuyển toàn bộ sang SERVER để chạy đúng giờ, đáng tin cậy, và trao thưởng thật.

// Xác định "mã tuần" hiện tại (tuần bắt đầu từ Thứ 2, giống hệt cách tính ở frontend) để biết đã sang tuần mới hay chưa
// Tính "mã tuần" theo mốc CHỦ NHẬT 00:00 (khớp với đồng hồ đếm ngược "⏳ Reset vào 00:00 Chủ Nhật" hiển thị
// cho người dùng ở tab BXH) - KHÔNG dùng ISO week (Thứ 2) để tránh lệch 1 ngày so với những gì người dùng
// nhìn thấy trên giao diện.
function getWeekIdentifier(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // Chủ Nhật = 0
    d.setDate(d.getDate() - day); // Lùi về đúng Chủ Nhật gần nhất (hoặc giữ nguyên nếu hôm nay là Chủ Nhật)
    return d.toISOString().slice(0, 10);
}

// Phần thưởng mặc định cho Top 1-3 BXH mời bạn hàng tuần (có thể chỉnh lại số này theo ý muốn)
const WEEKLY_TOP_REWARDS = [
    { rank: 1, orders: 75000, spins: 8, label: '🥇 Hạng 1' },
    { rank: 2, orders: 45000, spins: 5, label: '🥈 Hạng 2' },
    { rank: 3, orders: 25000, spins: 3, label: '🥉 Hạng 3' }
];

const WEEKLY_ADS_KEY = 'weekly_ads_counts';
let weeklyAdsWriteQueue = Promise.resolve();
async function getWeeklyAdsCounts() {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', WEEKLY_ADS_KEY).maybeSingle();
    if (error) throw error;
    const value = data?.value;
    if (!value) return {};
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return {}; } }
    return typeof value === 'object' && !Array.isArray(value) ? value : {};
}
async function saveWeeklyAdsCounts(counts) {
    const { error } = await supabase.from('app_settings').upsert({ key:WEEKLY_ADS_KEY, value:counts }, { onConflict:'key' });
    if (error) throw error;
}
function incrementWeeklyAds(userId) {
    const run = weeklyAdsWriteQueue.then(async () => {
        const counts = await getWeeklyAdsCounts();
        counts[String(userId)] = Number(counts[String(userId)] || 0) + 1;
        await saveWeeklyAdsCounts(counts);
        return counts[String(userId)];
    });
    weeklyAdsWriteQueue = run.catch(() => {});
    return run;
}

async function weeklyLeaderboardReset() {
    try {
        const currentWeek = getWeekIdentifier(new Date());

        // ===== BXH MỜI BẠN =====
        const { data: inviteState } = await supabase.from('weekly_state').select('*').eq('id', 1).single();
        if (!inviteState || inviteState.lastWeekKey !== currentWeek) {
            const inviteCols = await getUserColumns();
            const hasWeeklyInviteColumn = inviteCols.has('weeklyValidInvites');
            let topUsers = [], topError = null;
            if (hasWeeklyInviteColumn) {
                const r = await supabase.from('users')
                    .select('id, name, weeklyValidInvites').gt('weeklyValidInvites', 0)
                    .order('weeklyValidInvites', { ascending: false }).limit(3);
                topUsers = r.data || []; topError = r.error || null;
            } else {
                // Cột chưa có trong bảng users -> xếp hạng theo số đếm đang lưu trong app_settings
                const all = await getUserExtraAll();
                const ids = Object.entries(all)
                    .filter(([, v]) => Number(v?.weeklyValidInvites || 0) > 0)
                    .sort((a, b) => Number(b[1].weeklyValidInvites) - Number(a[1].weeklyValidInvites))
                    .slice(0, 3).map(([id]) => id);
                if (ids.length > 0) {
                    const { data: rows } = await supabase.from('users').select('id, name').in('id', ids);
                    const names = Object.fromEntries((rows || []).map(u => [String(u.id), u.name]));
                    topUsers = ids.map(id => ({ id, name: names[id] || ('User ' + id), weeklyValidInvites: Number(all[id].weeklyValidInvites || 0) }));
                }
            }
            if (topError) {
                console.error('Lỗi lấy top BXH mời bạn tuần:', topError);
            } else {
                for (let i = 0; i < topUsers.length; i++) {
                    const u = topUsers[i], prize = WEEKLY_TOP_REWARDS[i];
                    if (!prize) break;
                    // Top 1-3 chỉ nhận thưởng BXH Mời Bạn tuần khi có >= 5 ref hợp lệ trong tuần đó.
                    // Không đủ 5 ref hợp lệ -> vẫn đứng hạng trên BXH nhưng KHÔNG được trao thưởng.
                    if (Number(u.weeklyValidInvites || 0) < 5) continue;
                    const { data: cur } = await supabase.from('users').select('orders, spins').eq('id', u.id).single();
                    await touchWallet(u.id, { orders: (cur?.orders || 0) + prize.orders, spins: (cur?.spins || 0) + prize.spins });
                    logTransaction(u.id, 'orders', prize.orders, `${prize.label} BXH mời bạn tuần`);
                    await safeSendMessage(u.id,
                        `🏆 *CHÚC MỪNG!* Bạn đạt *${prize.label}* Bảng Xếp Hạng Mời Bạn tuần này với *${u.weeklyValidInvites}* lượt mời hợp lệ!\n🎁 Phần thưởng: *+${prize.orders.toLocaleString()} Đơn Hàng + ${prize.spins} Lượt Mở Rương*\n\nBXH đã được reset cho tuần mới!`,
                        { parse_mode: 'Markdown' }
                    );
                    logActivity(`🏆 ${maskName(u.name)} đạt ${prize.label} BXH mời bạn tuần này`);
                }
                if (hasWeeklyInviteColumn) {
                    await supabase.from('users').update({ weeklyValidInvites: 0 }).gt('weeklyValidInvites', -1);
                } else {
                    const all = await getUserExtraAll();
                    Object.keys(all).forEach(k => { if (all[k] && all[k].weeklyValidInvites) all[k].weeklyValidInvites = 0; });
                    await saveUserExtraAll(all);
                }
                await supabase.from('weekly_state').upsert({ id: 1, lastWeekKey: currentWeek });
            }
        }

        // ===== BXH XEM QC =====
        const { data: adsState } = await supabase.from('weekly_state').select('*').eq('id', 2).single();
        if (!adsState || adsState.lastWeekKey !== currentWeek) {
            const counts = await getWeeklyAdsCounts();
            const topIds = Object.entries(counts).filter(([,count]) => Number(count)>0)
                .sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,3).map(([id])=>id);
            const { data: adUsers, error: adsError } = topIds.length
                ? await supabase.from('users').select('id,name').in('id',topIds)
                : { data:[], error:null };
            const names = Object.fromEntries((adUsers||[]).map(u=>[String(u.id),u.name]));
            const topAds = topIds.map(id=>({id,name:names[id]||('User '+id),weeklyAdsCount:Number(counts[id]||0)}));
            if (adsError) {
                console.error('Lỗi lấy top BXH Xem QC tuần:', adsError);
            } else {
                for (let i = 0; i < topAds.length; i++) {
                    const u = topAds[i], prize = WEEKLY_TOP_REWARDS[i];
                    if (!prize) break;
                    // Top 1-3 chỉ nhận thưởng BXH Xem QC tuần khi có >= 20 QC hợp lệ trong tuần đó.
                    // Không đủ 20 QC -> vẫn đứng hạng trên BXH nhưng KHÔNG được trao thưởng.
                    if (Number(u.weeklyAdsCount || 0) < 20) continue;
                    const { data: cur } = await supabase.from('users').select('orders, spins').eq('id', u.id).single();
                    await touchWallet(u.id, { orders: (cur?.orders || 0) + prize.orders, spins: (cur?.spins || 0) + prize.spins });
                    logTransaction(u.id, 'orders', prize.orders, `${prize.label} BXH Xem QC tuần`);
                    await safeSendMessage(u.id,
                        `📺 *CHÚC MỪNG!* Bạn đạt *${prize.label}* Bảng Xếp Hạng Xem QC tuần này với *${u.weeklyAdsCount}* lượt xem!\n🎁 Phần thưởng: *+${prize.orders.toLocaleString()} Đơn Hàng + ${prize.spins} Lượt Mở Rương*\n\nBXH Xem QC đã được reset cho tuần mới!`,
                        { parse_mode: 'Markdown' }
                    );
                    logActivity(`📺 ${maskName(u.name)} đạt ${prize.label} BXH Xem QC tuần này`);
                }
                await saveWeeklyAdsCounts({});
                await supabase.from('weekly_state').upsert({ id: 2, lastWeekKey: currentWeek });
            }
        }

        console.log(`✅ Kiểm tra/reset BXH tuần xong: ${currentWeek}`);
    } catch (e) {
        console.error('Lỗi weeklyLeaderboardReset:', e);
    }
}
weeklyLeaderboardReset(); // Kiểm tra ngay lúc server khởi động (phòng trường hợp server tắt đúng lúc qua tuần mới)
setInterval(weeklyLeaderboardReset, 60 * 60 * 1000); // Kiểm tra lại mỗi giờ để không bỏ lỡ mốc sang tuần


// (ví dụ lỗi 409 Conflict do phiên bản deploy cũ vẫn còn đang polling khi Render tạo instance mới),
// Promise sẽ bị reject mà không ai xử lý -> Node coi là "unhandledRejection" và THOÁT TIẾN TRÌNH với mã lỗi 1
// (đây chính là nguyên nhân phổ biến khiến deploy trên Render báo "Exited with status 1" dù code không có lỗi cú pháp).
bot.command('ban_ip', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    
    const args = ctx.message.text.split(' ');
    const ip = args[1];
    if (!ip) { ctx.reply('❌ Dùng: /ban_ip <IP>'); return; }
    
    // Ban toàn bộ user từ IP này
    const ipColumn = (await getUserColumns()).has('ip_address') ? 'ip_address' : 'ip';
    const { data: users, error } = await supabase
        .from('users')
        .select('id')
        .eq(ipColumn, ip);
    
    if (users && users.length > 0) {
        await supabase.from('users').update({ isBanned: true }).eq(ipColumn, ip);
        ctx.reply(`✅ Đã ban ${users.length} user từ IP ${ip}`);
    } else {
        ctx.reply(`ℹ️ Không tìm thấy user nào từ IP ${ip}`);
    }
});

(async () => {
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await bot.launch({ dropPendingUpdates: true });
        console.log("✅ Bot is running...");
    } catch (err) {
        console.error("❌ Lỗi khởi động bot (server vẫn tiếp tục chạy để phục vụ API/Web):", err.message);
    }
})();

// Dừng bot đúng cách khi Render tắt instance cũ lúc deploy bản mới, tránh xung đột polling giữa 2 phiên bản
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Lưới an toàn: không để 1 lỗi bất đồng bộ chưa được catch làm sập toàn bộ server ngoài ý muốn
process.on('unhandledRejection', (reason) => {
    console.error('⚠️ Unhandled Rejection (đã được chặn để server không bị crash):', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️ Uncaught Exception (đã được chặn để server không bị crash):', err);
});

// ==================== API CHO FRONTEND ====================

// API để Mini App kiểm tra trạng thái khoá bảo trì (KHÔNG bị chặn bởi middleware bên dưới)
app.get('/api/lock-status', (req, res) => {
    // Admin CHÍNH (ID 6327666718) luôn bypass khóa bảo trì để có thể tự kiểm tra/test Mini App
    const isMainAdminRequest = String(req.query.userId) === String(ADMIN_ID);
    res.json({ locked: BOT_LOCKED && !isMainAdminRequest, message: MAINTENANCE_MESSAGE });
});

// Lấy userId của người gọi API, thử nhiều nguồn khác nhau (query, body, hoặc đoạn cuối path dạng /api/xxx/:id)
function extractRequestUserId(req) {
    return req.query?.userId || req.body?.userId || req.body?.id || req.path.split('/').filter(Boolean).pop();
}

// Chặn toàn bộ API của Mini App khi bot đang bị khoá bảo trì (trừ chính API kiểm tra khoá ở trên, các API
// dành cho Admin, và mọi request đến từ chính Admin CHÍNH - ID 6327666718 - để Admin luôn thao tác được
// bình thường qua Mini App/web /admin trong lúc bảo trì).
app.use('/api', (req, res, next) => {
    if (BOT_LOCKED && req.path !== '/lock-status' && !req.path.startsWith('/admin')) {
        if (String(extractRequestUserId(req)) === String(ADMIN_ID)) return next();
        return res.status(503).json({ locked: true, error: MAINTENANCE_MESSAGE, message: MAINTENANCE_MESSAGE });
    }
    next();
});

// API kiểm tra tham gia nhóm từ frontend
app.get('/api/verify/:id', async (req, res) => {
    try {
        const isMember = await checkUserMembership(req.params.id);
        // FIX LỖ HỔNG: trước đây route này chỉ trả về true/false, không thử chốt lượt mời bạn. Nếu user
        // bấm "✅ Kiểm tra" ngay trong Mini App (thay vì qua bot) sau khi đã lỡ xem đủ 3 QC từ trước, lượt
        // mời sẽ không bao giờ được tính vì onAdWatched() chỉ gọi check-referral khi lifetimeAdsWatched<=3.
        // Gọi tại đây để MỌI đường xác nhận thành viên đều tự thử chốt, không phụ thuộc thứ tự thao tác.
        if (isMember) {
            tryFinalizeReferral(req.params.id, true).catch(() => {});
        }
        res.json({ success: isMember });
    } catch (e) {
        console.error("Lỗi API verify:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API lưu IP
app.post('/api/save-ip/:id', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: "IP is required" });

    const { data: userBeforeUpdate, error: fetchError } = await readUserRow(req.params.id);
    if (!userBeforeUpdate) {
        // Chưa có bản ghi user (vd mở Mini App trước khi /start) - KHÔNG phải lỗi hệ thống, chỉ trả 404
        // và không ghi log nữa để log Render không bị spam như trước.
        if (fetchError) console.error("Lỗi lấy user để lưu IP:", fetchError.message);
        return res.status(404).json({ success: false, error: "User not found" });
    }

    // Chỉ cập nhật IP nếu nó thay đổi
    if (userBeforeUpdate.ip !== ip) {
        const { error: updateError } = await saveUserFields(req.params.id, { ip });
        if (updateError) {
            console.error("Lỗi cập nhật IP:", updateError);
            return res.status(500).json({ success: false, error: "Failed to update IP" });
        }
    }
    
    // Check IP trùng và cảnh báo admin (chỉ cảnh báo nếu IP mới khác IP cũ hoặc nếu chưa từng có IP)
    if (ip && (userBeforeUpdate.ip !== ip || !userBeforeUpdate.ip)) {
        const duplicates = await checkDuplicateIP(req.params.id, ip);
        if (duplicates.length > 0) {
            await safeSendMessage(ADMIN_ID,
                `⚠️ *CẢNH BÁO IP TRÙNG MỚI PHÁT HIỆN!*\n` +
                `👤 User: ${userBeforeUpdate.name || 'N/A'} (${req.params.id})\n` +
                `🌐 IP: ${ip}\n` +
                `⚠️ Trùng với: ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
    
    res.json({ success: true });
});

// API lấy user (kèm level stats)
app.get('/api/user/:id', async (req, res) => {
    let { data, error } = await readUserRow(req.params.id);
    // Sang ngày mới (0h00 giờ VN) thì SERVER tự reset, nên tải lại app hay tắt/mở bot đều KHÔNG
    // tạo thêm lượt câu hỏi / SmartLink / nhiệm vụ như trước.
    if (data && !isCurrentVietnamDay(data.lastResetDate)) {
        const { error: resetError } = await saveUserFields(req.params.id, {
            ...dailyResetFields(), walletUpdatedAt: new Date().toISOString()
        });
        if (!resetError) ({ data } = await readUserRow(req.params.id));
    }
    if (!data) {
        if (!error || error.code === 'PGRST116') { // Not Found
            return res.status(404).json({ error: "User not found" });
        }
        console.error("Lỗi lấy user:", error);
        return res.status(500).json({ error: "Failed to fetch user data" });
    }
    // Parse referralMilestones if stored as JSON string (bọc try/catch để 1 dòng dữ liệu hỏng
    // không làm crash cả request, khiến client không bao giờ nhận được phản hồi)
    if (data.referralMilestones && typeof data.referralMilestones === 'string') {
        try { data.referralMilestones = JSON.parse(data.referralMilestones); } catch (_) { data.referralMilestones = []; }
    }
    
    // Thêm level stats vào response
    const levelStats = calculateLevelStats(data.truckLevel || 1);
    
    res.json({ ...data, levelStats });
});

// API cập nhật user. QUAN TRỌNG: các field "ví" (coins/orders/spins/truckLevel/isBanned) được đối chiếu
// qua walletUpdatedAt để KHÔNG cho phép dữ liệu game trên client (vốn chỉ lưu snapshot cục bộ) ghi đè
// mất các thay đổi mà ADMIN vừa thực hiện trực tiếp trên database (đây là nguyên nhân gây lỗi "lệnh admin
// không áp dụng được"). Cách hoạt động: client gửi kèm clientWalletSyncedAt = mốc walletUpdatedAt mà nó
// biết gần nhất. Nếu mốc đó CŨ HƠN mốc hiện tại trong DB (tức admin vừa sửa ví sau khi client đồng bộ lần
// cuối) thì server sẽ BỎ QUA phần ví client gửi lên, giữ nguyên giá trị admin đã đặt, và trả lại giá trị
// mới nhất để client tự cập nhật lại local state.
// Toàn bộ field có thể bị ADMIN thay đổi trực tiếp qua lệnh bot (congcoin, trucoin, addspin, adddonhang,
// setlevel, ban/unban, resetdaily, reset, resetall...) được đối chiếu qua walletUpdatedAt để KHÔNG cho
// phép dữ liệu game trên client (vốn chỉ lưu snapshot cục bộ, có thể cũ) ghi đè mất thay đổi của admin.
// Lấy trực tiếp từ fullResetFields() để danh sách này LUÔN khớp với những gì các lệnh reset thực sự đổi,
// tránh trường hợp thêm field mới vào fullResetFields() mà quên thêm vào đây.
// FIX LỖI "XEM QC TĂNG TỐC X2 THÀNH CÔNG NHƯNG THỜI GIAN KHÔNG GIẢM": 'speedUpUsed' trước đây KHÔNG nằm
// trong danh sách WALLET_FIELDS (vì fullResetFields() không có field này), nên khi walletOverridden=true
// (server phát hiện dữ liệu ví trên DB mới hơn mốc client đã đồng bộ), 'lastProducedAt'/'productionInterval'
// bị loại khỏi bản lưu (đúng, để không mất thay đổi mới hơn) NHƯNG 'speedUpUsed' vẫn được lưu bình thường
// -> kết quả: speedUpUsed=true được ghi nhận (đã dùng X2) trong khi lastProducedAt/productionInterval bị
// hoàn tác về giá trị cũ (thời gian KHÔNG giảm) -> user thấy "xem QC xong nhưng thời gian không đổi" và
// còn bị khoá không cho dùng X2 lần nữa cho mẻ đó. Thêm 'speedUpUsed' vào WALLET_FIELDS để nó LUÔN được
// hoàn tác/giữ nguyên ĐỒNG BỘ cùng lastProducedAt/productionInterval trong cùng 1 lần ghi đè, đảm bảo
// trạng thái X2 và thời gian sản xuất không bao giờ bị lệch nhau.
const WALLET_FIELDS = [...new Set([...Object.keys(fullResetFields()), 'isBanned', 'speedUpUsed', 'dailyTasks', 'allTasksClaimed'])];
app.post('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const { clientWalletSyncedAt, ...body } = req.body;
        let updateData = { ...body };

        // SECURITY: referral relationship/counters are server-owned and immutable from the client.
        // This endpoint is a compatibility sync route for legacy UI state only.
        [
            'referrerId', 'referrerCounted', 'invitedCount', 'validInvites',
            'weeklyValidInvites', 'lifetimeAdsWatched', 'lifetimeSmartlinks',
            'adsToday', 'smartlinksToday', 'smartlinkCount', 'deliveryCount',
            'deliveryCountLifetime', 'chestOpensTotal', 'chestOpensToday',
            'referralMilestones', 'dailyValidInvites',
            'bonusAdsToday','rewardedAdsToday','extraDeliveryAdsToday','extraDeliveryCount','withdrawRemain','spinAdCount','groupTaskClaimed',
            'quizDate', 'quizFreeUsed', 'quizAdUnlocked', 'quizUsedIds',
            'dailyTasks', 'allTasksClaimed', 'lastResetDate',
            'weeklyAdsCount', 'serverTaskClaims', 'dailyActionFlags', 'loginStreakState', 'groupTaskClaimed'
        ].forEach(f => { delete updateData[f]; });

        // Handle referralMilestones as JSON string
        if (updateData.referralMilestones) {
            updateData.referralMilestones = JSON.stringify(updateData.referralMilestones);
        }

        let { data: current, error: currentError } = await readUserRow(userId);
        if (!current) {
            // Chưa có bản ghi (mở Mini App trước khi /start) -> tạo mới ngay để KHÔNG mất dữ liệu người dùng
            const { known: seedRow } = await splitUserFields({
                id: userId,
                name: body.name || 'Shipper',
                walletUpdatedAt: new Date().toISOString(),
                accountCreatedAt: new Date().toISOString()
            });
            const { error: createError } = await supabase.from('users').insert(seedRow);
            if (createError) {
                console.error(`Không tạo được user ${userId}:`, createError.message || currentError?.message);
                return res.status(404).json({ success: false, error: "User not found" });
            }
            ({ data: current } = await readUserRow(userId));
            if (!current) return res.status(404).json({ success: false, error: "User not found" });
        }
        if (current.isBanned) {
            return res.status(403).json({ success: false, error: "Tài khoản đã bị khóa.", isBanned: true });
        }

        const dbWalletTime = current.walletUpdatedAt ? new Date(current.walletUpdatedAt).getTime() : 0;
        const clientTime = clientWalletSyncedAt ? new Date(clientWalletSyncedAt).getTime() : 0;
        let walletOverridden = false;

        if (dbWalletTime > clientTime) {
            // Admin vừa sửa ví sau lần client đồng bộ gần nhất -> bỏ các field ví trong request này
            WALLET_FIELDS.forEach(f => { delete updateData[f]; });
            walletOverridden = true;
        } else {
            // Client đang là bản mới nhất -> cho phép lưu, đồng thời cập nhật lại mốc walletUpdatedAt
            updateData.walletUpdatedAt = new Date().toISOString();
        }

        const { error } = await saveUserFields(userId, updateData);
        if (error) {
            console.error(`Lỗi cập nhật user ${userId}:`, error.message || error);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (walletOverridden) {
            // Trả về giá trị mới nhất từ DB cho TOÀN BỘ field được bảo vệ để client tự đồng bộ lại, tránh mất thay đổi của admin
            const { data: fresh } = await readUserRow(userId);
            if (fresh && fresh.referralMilestones && typeof fresh.referralMilestones === 'string') {
                try { fresh.referralMilestones = JSON.parse(fresh.referralMilestones); } catch (_) { fresh.referralMilestones = []; }
            }
            const levelStats = calculateLevelStats(fresh?.truckLevel || 1);
            return res.json({ success: true, walletOverridden: true, wallet: fresh, levelStats });
        }

        // Lấy dữ liệu cập nhật mới nhất để trả về level stats
        const { data: updated } = await supabase.from('users').select('truckLevel').eq('id', userId).single();
        const levelStats = calculateLevelStats(updated?.truckLevel || 1);
        
        res.json({ success: true, walletOverridden: false, walletUpdatedAt: updateData.walletUpdatedAt, levelStats });
    } catch (e) {
        console.error("Lỗi API cập nhật user:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== SMARTLINK ====================
// Mỗi lần bấm SmartLink hợp lệ được +50 Coin và +25 Đơn hàng, do SERVER cộng và lưu thẳng vào
// Supabase (không tính ở máy người dùng) nên tải lại app hay tắt/mở bot đều không đổi số lượt.
const smartlinkProcessing = new Set();
const SMARTLINK_DAILY_LIMIT = 30;
const SMARTLINK_REWARD_COINS = 50;
const SMARTLINK_REWARD_ORDERS = 25;
app.post('/api/smartlink/complete', async (req, res) => {
    const authUserId = String(req.body?.userId || req.params?.id || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    const userId = String(req.body?.userId || '');
    if (!userId) return res.status(400).json({ success: false, error: 'Thiếu userId.' });
    if (smartlinkProcessing.has(userId)) {
        return res.status(409).json({ success: false, retry: true, error: 'Lượt SmartLink đang được xử lý.' });
    }
    smartlinkProcessing.add(userId);
    try {
        let { data: user } = await readUserRow(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user.' });
        if (user.isBanned) return res.status(403).json({ success: false, isBanned: true, error: 'Tài khoản đã bị khóa.' });

        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate,verificationRequired:true});

        const newDay = !isCurrentVietnamDay(user.lastResetDate);
        if (newDay) {
            await saveUserFields(userId, { ...dailyResetFields(), walletUpdatedAt: new Date().toISOString() });
            ({ data: user } = await readUserRow(userId));
            if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy user.' });
        }

        const currentCount = Number(user.smartlinkCount || 0);
        if (currentCount >= SMARTLINK_DAILY_LIMIT) {
            return res.json({
                success: true, alreadyComplete: true, smartlinkCount: SMARTLINK_DAILY_LIMIT,
                smartlinksToday: Number(user.smartlinksToday || 0),
                lifetimeSmartlinks: Number(user.lifetimeSmartlinks || 0),
                coins: Number(user.coins || 0), orders: Number(user.orders || 0),
                walletUpdatedAt: user.walletUpdatedAt
            });
        }

        const mutation = await atomicWalletMutation(userId, {
            deltaCoins: SMARTLINK_REWARD_COINS,
            deltaOrders: SMARTLINK_REWARD_ORDERS,
            setFields: {
                smartlinkCount: currentCount + 1,
                smartlinksToday: Number(user.smartlinksToday || 0) + 1,
                lifetimeSmartlinks: Number(user.lifetimeSmartlinks || 0) + 1,
                lastSmartlinkTime: Date.now(),
                lastResetDate: vietnamDayKey()
            }
        });
        if (mutation.error) return res.status(409).json({ success:false, retry:true, error:mutation.error.message });

        const fresh = await readUserRow(userId);
        await recordAntiFraudEvent(userId, 'smartlink', {
            rewardEvent:true,
            coins:SMARTLINK_REWARD_COINS,
            orders:SMARTLINK_REWARD_ORDERS,
            ip:requestIp(req),
            sessionId:String(req.body?.sessionId || '')
        });
        logTransaction(userId, 'coin', SMARTLINK_REWARD_COINS, 'Hoàn thành 1 SmartLink');
        logTransaction(userId, 'orders', SMARTLINK_REWARD_ORDERS, 'Hoàn thành 1 SmartLink');

        res.json({
            success: true,
            rewardCoins: SMARTLINK_REWARD_COINS, rewardOrders: SMARTLINK_REWARD_ORDERS,
            smartlinkCount: Number(fresh.data?.smartlinkCount || 0),
            smartlinksToday: Number(fresh.data?.smartlinksToday || 0),
            lifetimeSmartlinks: Number(fresh.data?.lifetimeSmartlinks || 0),
            coins: Number(fresh.data?.coins || 0),
            orders: Number(fresh.data?.orders || 0),
            walletUpdatedAt: fresh.data?.walletUpdatedAt || mutation.data?.walletUpdatedAt || null,
            riskScore: (await getAntiFraudState(userId)).stats.score
        });
    } catch (e) {
        console.error('Lỗi hoàn tất SmartLink:', e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        smartlinkProcessing.delete(userId);
    }
});
// ==================== QUIZ: SERVER CẤP LƯỢT, RELOAD KHÔNG THỂ NHẬN LẠI ====================
const QUIZ_DAILY_LIMIT = 5;
const QUIZ_AD_LIMIT = 4;
const quizProcessing = new Set();
async function loadCurrentDailyUser(userId) {
    let { data: user } = await readUserRow(userId);
    if (!user) return null;
    if (!isCurrentVietnamDay(user.lastResetDate)) {
        // Chỉ sang ngày mới thật sự mới reset toàn bộ nhiệm vụ/QC/SmartLink/giao hàng.
        await saveUserFields(userId, { ...dailyResetFields(), walletUpdatedAt:new Date().toISOString() });
        ({ data:user } = await readUserRow(userId));
    } else if (user.quizDate !== vietnamDayKey()) {
        // Nếu riêng dữ liệu quiz cũ/thiếu thì chỉ reset quiz, tuyệt đối không xóa tiến độ khác trong ngày.
        await saveUserFields(userId, {
            quizDate:vietnamDayKey(), quizFreeUsed:false, quizAdUnlocked:0, quizUsedIds:[]
        });
        ({ data:user } = await readUserRow(userId));
    }
    return user;
}
function quizState(user) {
    const quizFreeUsed = !!user?.quizFreeUsed;
    const quizAdUnlocked = Math.min(QUIZ_AD_LIMIT, Math.max(0, Number(user?.quizAdUnlocked || 0)));
    const slotsUsed = (quizFreeUsed ? 1 : 0) + quizAdUnlocked;
    return {
        quizDate: vietnamDayKey(), quizFreeUsed, quizAdUnlocked,
        quizUsedIds: Array.isArray(user?.quizUsedIds) ? user.quizUsedIds.slice(0, QUIZ_DAILY_LIMIT) : [],
        slotsUsed, remaining: Math.max(0, QUIZ_DAILY_LIMIT - slotsUsed)
    };
}
app.get('/api/quiz/status/:id', async (req, res) => {
    try {
        const user = await loadCurrentDailyUser(String(req.params.id));
        if (!user) return res.status(404).json({ success:false, error:'Không tìm thấy user.' });
        res.json({ success:true, ...quizState(user) });
    } catch (e) {
        console.error('Lỗi lấy trạng thái câu hỏi:', e);
        res.status(500).json({ success:false, error:e.message });
    }
});
app.post('/api/quiz/claim-slot', async (req, res) => {
    const userId = String(req.body?.userId || '');
    const kind = req.body?.kind === 'ad' ? 'ad' : 'free';
    if (!userId) return res.status(400).json({ success:false, error:'Thiếu userId.' });
    if (quizProcessing.has(userId)) return res.status(409).json({ success:false, retry:true, error:'Đang xử lý lượt câu hỏi.' });
    quizProcessing.add(userId);
    try {
        const user = await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({ success:false, error:'Không tìm thấy user.' });
        const state = quizState(user);
        if (state.slotsUsed >= QUIZ_DAILY_LIMIT) {
            return res.status(429).json({ success:false, limitReached:true, error:'Bạn đã dùng đủ 5 câu hỏi hôm nay.', ...state });
        }
        const update = { quizDate:vietnamDayKey(), lastResetDate:vietnamDayKey(), walletUpdatedAt:new Date().toISOString() };
        if (kind === 'free') {
            if (state.quizFreeUsed) return res.status(409).json({ success:false, error:'Câu miễn phí hôm nay đã được dùng.', ...state });
            update.quizFreeUsed = true;
        } else {
            if (!state.quizFreeUsed) return res.status(400).json({ success:false, error:'Hãy dùng câu miễn phí trước.' });
            if (state.quizAdUnlocked >= QUIZ_AD_LIMIT) return res.status(429).json({ success:false, limitReached:true, error:'Đã mở đủ 4 câu bằng quảng cáo.' });
            update.quizAdUnlocked = state.quizAdUnlocked + 1;
        }
        const { error } = await saveUserFields(userId, update);
        if (error) throw error;
        res.json({ success:true, kind, walletUpdatedAt:update.walletUpdatedAt, ...quizState({ ...user, ...update }) });
    } catch (e) {
        console.error('Lỗi cấp lượt câu hỏi:', e);
        res.status(500).json({ success:false, error:e.message });
    } finally { quizProcessing.delete(userId); }
});



const REFERRAL_MILESTONE_REWARDS = [
    { friends:5, coins:1000, orders:2000, spins:0, label:'1,000 Coin + 2,000 Đơn Hàng' },
    { friends:10, coins:1000, orders:1000, spins:1, label:'1,000 Coin + 1 Spin + 1,000 Đơn Hàng' },
    { friends:20, coins:1500, orders:1000, spins:0, label:'1,500 Coin + 1,000 Đơn Hàng' },
    { friends:30, coins:0, orders:3000, spins:1, label:'3,000 Đơn Hàng + 1 Spin' },
    { friends:50, coins:3000, orders:5000, spins:0, label:'3,000 Coin + 5,000 Đơn Hàng' },
    { friends:75, coins:0, orders:7000, spins:3, label:'7,000 Đơn Hàng + 3 Spins' },
    { friends:100, coins:0, orders:20000, spins:7, label:'20,000 Đơn Hàng + 7 Spins' }
];

app.get('/api/referral/milestones/:id', async (req,res) => {
    try {
        const userId = String(req.params.id || '');
        if (!assertTelegramUser(req, userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
        const user = await readUserRow(userId);
        if (!user.data) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        const extra = await getUserExtra(userId);
        const claims = (extra?.serverReferralMilestones && typeof extra.serverReferralMilestones === 'object') ? extra.serverReferralMilestones : {};
        res.json({success:true,validInvites:Number(user.data.validInvites||0),milestones:REFERRAL_MILESTONE_REWARDS.map(m=>({...m,claimed:claims[String(m.friends)] === true}))});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

const referralMilestoneProcessing = new Set();
app.post('/api/referral/milestone-claim', async (req,res) => {
    const userId = String(req.body?.userId || '');
    const friends = Number(req.body?.friends);
    if (!assertTelegramUser(req, userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    const lockKey = `${userId}:${friends}`;
    if (referralMilestoneProcessing.has(lockKey)) return res.status(409).json({success:false,retry:true,error:'Mốc đang được xử lý.'});
    referralMilestoneProcessing.add(lockKey);
    try {
        const reward = REFERRAL_MILESTONE_REWARDS.find(m => m.friends === friends);
        if (!reward) return res.status(400).json({success:false,error:'Mốc không hợp lệ.'});
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate});
        const user = await readUserRow(userId);
        if (!user.data) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        if (Number(user.data.validInvites||0) < reward.friends) return res.status(400).json({success:false,error:'Chưa đủ bạn hợp lệ.'});
        const extra = await getUserExtra(userId);
        const claims = (extra?.serverReferralMilestones && typeof extra.serverReferralMilestones === 'object') ? { ...extra.serverReferralMilestones } : {};
        if (claims[String(friends)] === true) return res.status(409).json({success:false,error:'Mốc này đã nhận.'});

        const mutation = await atomicWalletMutation(userId, {
            deltaCoins: reward.coins,
            deltaOrders: reward.orders,
            deltaSpins: reward.spins
        });
        if (mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});

        claims[String(friends)] = true;
        await saveUserExtra(userId,{serverReferralMilestones:claims});
        await flushUserExtra();
        await recordAntiFraudEvent(userId,'task',{rewardEvent:true,coins:reward.coins,orders:reward.orders,spins:reward.spins});
        if (reward.coins) logTransaction(userId,'coin',reward.coins,`Thưởng mốc ${friends} bạn`);
        if (reward.orders) logTransaction(userId,'orders',reward.orders,`Thưởng mốc ${friends} bạn`);
        const {data:out}=await readUserRow(userId);
        res.json({success:true,friends,reward,coins:out?.coins||0,orders:out?.orders||0,spins:out?.spins||0,walletUpdatedAt:out?.walletUpdatedAt||null});
    } catch(e) { console.error('Lỗi claim referral milestone:',e); res.status(500).json({success:false,error:e.message}); }
    finally { referralMilestoneProcessing.delete(lockKey); }
});

// ==================== SERVER-AUTHORITATIVE DAILY TASK / QUIZ REWARDS ====================
const TASK_REWARDS = {
    deliver5: { coins: 50, orders: 50, spins: 0 },
    deliver10: { coins: 100, orders: 100, spins: 0 },
    deliver15: { coins: 200, orders: 200, spins: 0 },
    deliver20: { coins: 250, orders: 300, spins: 0 },
    x2Once: { coins: 50, orders: 25, spins: 0 },
    upgradeOnce: { coins: 100, orders: 50, spins: 0 },
    watch3rewarded: { coins: 150, orders: 50, spins: 0 },
    smartlink5: { coins: 75, orders: 75, spins: 0 },
    spin1: { coins: 50, orders: 0, spins: 0 },
    invite1: { coins: 350, orders: 25, spins: 0 },
    invite5: { coins: 500, orders: 100, spins: 1 },
};
const DAILY_TASK_IDS = Object.keys(TASK_REWARDS);
const DAILY_TASK_ALL_REWARD = { coins: 1000, orders: 500, spins: 2 };

async function getServerTaskClaims(userId) {
    const extra = await getUserExtra(userId);
    return (extra?.serverTaskClaims && typeof extra.serverTaskClaims === 'object') ? extra.serverTaskClaims : {};
}
async function getDailyActionFlags(userId) {
    const extra = await getUserExtra(userId);
    const flags = extra?.dailyActionFlags;
    if (!flags || flags.__date !== vietnamDayKey()) return { __date: vietnamDayKey() };
    return { ...flags };
}

function dailyTaskDefinitions(user = {}, claims = {}, actionFlags = {}) {
    const today = vietnamDayKey();
    const rewardedAds = Number(user.rewardedAdsToday || 0);
    const delivery = Number(user.deliveryCount || 0);
    const smartlinks = Number(user.smartlinkCount || 0);
    const invites = Number(user.dailyValidInvites || 0);
    const defs = [
        { id:'deliver5', name:'🚚 Giao hàng 5 lần', icon:'🚚', max:5, progress:Math.min(delivery,5), eligible:delivery>=5 },
        { id:'deliver10', name:'🚚 Giao hàng 10 lần', icon:'🚚', max:10, progress:Math.min(delivery,10), eligible:delivery>=10 },
        { id:'deliver15', name:'🚚 Giao hàng 15 lần', icon:'🚚', max:15, progress:Math.min(delivery,15), eligible:delivery>=15 },
        { id:'deliver20', name:'🚚 Giao hàng 20 lần', icon:'🚚', max:20, progress:Math.min(delivery,20), eligible:delivery>=20 },
        { id:'x2Once', name:'⚡ Dùng X2 một lần', icon:'⚡', max:1, progress:actionFlags.x2 ? 1 : 0, eligible:actionFlags.x2 === true },
        { id:'upgradeOnce', name:'⬆️ Nâng cấp xe một lần', icon:'⬆️', max:1, progress:actionFlags.upgrade ? 1 : 0, eligible:actionFlags.upgrade === true },
        { id:'watch3rewarded', name:'📺 Xem 3 QC (chỉ tính QC Rewarded Interstitial)', icon:'📺', max:3, progress:Math.min(rewardedAds,3), eligible:rewardedAds>=3 },
        { id:'smartlink5', name:'🔗 Hoàn thành 5 SmartLink', icon:'🔗', max:5, progress:Math.min(smartlinks,5), eligible:smartlinks>=5 },
        { id:'spin1', name:'🎁 Mở rương 1 lần', icon:'🎁', max:1, progress:Number(user.chestOpensToday||0)>=1?1:0, eligible:Number(user.chestOpensToday||0)>=1 },
        { id:'invite1', name:'👥 Mời 1 bạn thành công', icon:'👥', max:1, progress:Math.min(invites,1), eligible:invites>=1 },
        { id:'invite5', name:'👥 Mời 5 bạn thành công', icon:'👥', max:5, progress:Math.min(invites,5), eligible:invites>=5 },
    ];
    return defs.map(t => ({
        ...t,
        reward: TASK_REWARDS[t.id]?.coins || 0,
        rewardOrders: TASK_REWARDS[t.id]?.orders || 0,
        rewardSpins: TASK_REWARDS[t.id]?.spins || 0,
        once: t.max === 1,
        done: claims[t.id] === today,
        claimable: claims[t.id] !== today && t.eligible
    }));
}

const taskClaimProcessing = new Set();
async function claimServerTask(userId, taskId) {
    const lockKey = `${String(userId)}:${String(taskId)}`;
    if (taskClaimProcessing.has(lockKey)) return { ok:false, reason:'processing' };
    taskClaimProcessing.add(lockKey);
    try {
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return { ok:false, reason:'fraud_hold', fraudGate };
        const user = await loadCurrentDailyUser(userId);
        if (!user) return { ok:false, reason:'user_not_found' };
        if (user.isBanned) return { ok:false, reason:'banned' };
        if (!TASK_REWARDS[taskId]) return { ok:false, reason:'unsupported_task' };
        const today = vietnamDayKey();
        const claims = { ...(await getServerTaskClaims(userId)) };
        if (claims.__date && claims.__date !== today) Object.keys(claims).forEach(k => { if (k !== '__date') delete claims[k]; });
        claims.__date = today;
        if (claims[taskId] === today) return { ok:false, reason:'already_claimed' };
        const actionFlags = await getDailyActionFlags(userId);
        const defs = dailyTaskDefinitions(user, claims, actionFlags);
        const task = defs.find(t => t.id === taskId);
        if (!task || !task.eligible) return { ok:false, reason:'not_eligible' };

        const reward = TASK_REWARDS[taskId];
        const mutation = await atomicWalletMutation(userId, { deltaCoins:reward.coins, deltaOrders:reward.orders, deltaSpins:reward.spins });
        if (mutation.error) return { ok:false, reason:'wallet_update_failed', error:mutation.error };
        claims[taskId] = today;
        await saveUserExtra(userId, { serverTaskClaims: claims });
        await flushUserExtra();
        await recordAntiFraudEvent(userId,'task',{ rewardEvent:true, coins:reward.coins, orders:reward.orders, spins:reward.spins });
        if (reward.coins) logTransaction(userId,'coin',reward.coins,`Nhiệm vụ ${taskId}`);
        if (reward.orders) logTransaction(userId,'orders',reward.orders,`Nhiệm vụ ${taskId}`);
        return { ok:true, taskId, reward, walletUpdatedAt:mutation.data?.walletUpdatedAt || new Date().toISOString() };
    } finally { taskClaimProcessing.delete(lockKey); }
}

app.get('/api/daily-tasks/status/:id', async (req,res) => {
    const userId = String(req.params.id||'');
    if (!assertTelegramUser(req,userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const user = await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        const claims = await getServerTaskClaims(userId);
        const flags = await getDailyActionFlags(userId);
        const tasks = dailyTaskDefinitions(user,claims,flags);
        const allTasksClaimed = claims.__all === vietnamDayKey();
        const allDone = tasks.every(t => t.done);
        res.json({ success:true, today, lastResetDate:user.lastResetDate||today, tasks, allDone, allTasksClaimed, rewardedAdsToday:Number(user.rewardedAdsToday||0), deliveryCount:Number(user.deliveryCount||0), deliveryLimit:20+Number(user.extraDeliveryCount||0), extraDeliveryAdsToday:Number(user.extraDeliveryAdsToday||0), extraDeliveryCount:Number(user.extraDeliveryCount||0), smartlinkCount:Number(user.smartlinkCount||0), smartlinksToday:Number(user.smartlinksToday||0), coins:Number(user.coins||0), orders:Number(user.orders||0), spins:Number(user.spins||0), walletUpdatedAt:user.walletUpdatedAt||null });
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/task/claim', async (req,res) => {
    const authUserId = String(req.body?.userId || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const userId = String(req.body?.userId || ''); const taskId = String(req.body?.taskId || '');
        if (!userId || !taskId) return res.status(400).json({success:false,error:'Thiếu userId/taskId.'});
        const result = await claimServerTask(userId,taskId);
        if (!result.ok) {
            if (result.reason==='already_claimed') return res.json({success:true,alreadyClaimed:true,taskId});
            if (result.reason==='processing') return res.status(409).json({success:false,retry:true,error:'Nhiệm vụ đang được xử lý.'});
            if (result.reason==='fraud_hold') return res.status(result.fraudGate.status).json({success:false,...result.fraudGate,verificationRequired:true});
            return res.status(400).json({success:false,error:result.reason});
        }
        const {data:user}=await readUserRow(userId);
        const tasks = dailyTaskDefinitions(user, await getServerTaskClaims(userId), await getDailyActionFlags(userId));
        res.json({success:true,...result.reward,taskId,tasks,coins:user?.coins||0,orders:user?.orders||0,spins:user?.spins||0,walletUpdatedAt:user?.walletUpdatedAt||null});
    } catch(e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/task/claim-all', async (req,res) => {
    const userId=String(req.body?.userId||'');
    if(!assertTelegramUser(req,userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    const lockKey=`all:${userId}`; if(taskClaimProcessing.has(lockKey)) return res.status(409).json({success:false,retry:true,error:'Đang xử lý phần thưởng.'});
    taskClaimProcessing.add(lockKey);
    try {
        const fraudGate=await antiFraudRewardGate(userId); if(!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate,verificationRequired:true});
        const user=await loadCurrentDailyUser(userId); if(!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        const claims={...(await getServerTaskClaims(userId))}; const today=vietnamDayKey();
        if(claims.__date!==today) return res.status(400).json({success:false,error:'Chưa hoàn thành các nhiệm vụ hôm nay.'});
        const defs=dailyTaskDefinitions(user,claims,await getDailyActionFlags(userId));
        if(defs.some(t=>claims[t.id]!==today)) return res.status(400).json({success:false,error:'Chưa hoàn thành toàn bộ nhiệm vụ hôm nay.'});
        if(claims.__all===today) { const fresh=await readUserRow(userId); return res.json({success:true,alreadyClaimed:true,coins:fresh.data?.coins||0,orders:fresh.data?.orders||0,spins:fresh.data?.spins||0,walletUpdatedAt:fresh.data?.walletUpdatedAt||null}); }
        const reward=DAILY_TASK_ALL_REWARD; const mutation=await atomicWalletMutation(userId,{deltaCoins:reward.coins,deltaOrders:reward.orders,deltaSpins:reward.spins});
        if(mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});
        claims.__all=today; await saveUserExtra(userId,{serverTaskClaims:claims}); await flushUserExtra();
        await recordAntiFraudEvent(userId,'task',{rewardEvent:true,coins:reward.coins,orders:reward.orders,spins:reward.spins});
        logTransaction(userId,'coin',reward.coins,'Thưởng hoàn thành tất cả nhiệm vụ ngày'); logTransaction(userId,'orders',reward.orders,'Thưởng hoàn thành tất cả nhiệm vụ ngày');
        const fresh=await readUserRow(userId);
        res.json({success:true,...reward,coins:fresh.data?.coins||0,orders:fresh.data?.orders||0,spins:fresh.data?.spins||0,walletUpdatedAt:fresh.data?.walletUpdatedAt||null});
    } catch(e) { res.status(500).json({success:false,error:e.message}); } finally { taskClaimProcessing.delete(lockKey); }
});

// ==================== NHIỆM VỤ "THAM GIA NHÓM" (1 LẦN DUY NHẤT, KHÔNG RESET THEO NGÀY) ====================
// Khác hẳn TASK_REWARDS/claimServerTask() ở trên (dùng chung "serverTaskClaims" bị XOÁ mỗi khi sang ngày
// mới - xem dailyResetFields/claims.__date), nhiệm vụ này chỉ được thưởng ĐÚNG 1 LẦN trong toàn bộ vòng
// đời tài khoản nên PHẢI dùng cờ riêng "groupTaskClaimed", không được lẫn vào object claims theo ngày đó.
// Ưu tiên CAS (compare-and-swap) trực tiếp trên cột thật của bảng users (an toàn tuyệt đối với 2 request
// song song, giống hệt cách tryFinalizeReferral() đang khoá referrerCounted). Nếu cột "groupTaskClaimed"
// CHƯA tồn tại trên Supabase (chưa chạy SQL migration optional bên dưới) thì tự động rơi về kho lưu tạm
// user_extra_state kèm khoá bộ nhớ theo user - vẫn chống được double-claim ở mức tương đương cách hệ thống
// đang dùng cho serverReferralMilestones, và sẽ tự chuyển sang dùng cột thật ngay khi migration được chạy.
//
// SQL migration TÙY CHỌN (không bắt buộc để tính năng hoạt động):
//   alter table users add column if not exists "groupTaskClaimed" boolean default false;
const TASK_GROUP_REWARD = { coins: 500, orders: 500 };
async function checkTaskGroupMembership(userId) {
    try {
        const m = await bot.telegram.getChatMember(TASK_GROUP_USERNAME, userId).catch(() => ({ status: 'left' }));
        return ['member', 'administrator', 'creator'].includes(m.status);
    } catch (e) {
        console.error(`Lỗi check thành viên nhóm nhiệm vụ ${userId}:`, e.message);
        return false;
    }
}
const groupTaskProcessing = new Set();
async function claimGroupTask(userId) {
    const key = String(userId);
    if (groupTaskProcessing.has(key)) return { ok:false, reason:'processing' };
    groupTaskProcessing.add(key);
    try {
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return { ok:false, reason:'fraud_hold', fraudGate };

        const { data:user, error:userErr } = await readUserRow(userId);
        if (userErr || !user) return { ok:false, reason:'user_not_found' };
        if (user.isBanned) return { ok:false, reason:'banned' };
        if (user.groupTaskClaimed === true) return { ok:false, reason:'already_claimed' };

        const isMember = await checkTaskGroupMembership(userId);
        if (!isMember) return { ok:false, reason:'not_member' };

        // Thử CAS trên cột thật trước (an toàn tuyệt đối với 2 request song song)
        const { data: claimRows, error: claimError } = await supabase.from('users')
            .update({ groupTaskClaimed: true })
            .eq('id', userId)
            .eq('groupTaskClaimed', false)
            .select('id');
        let usedFallbackStore = false;
        if (claimError) {
            const missingCol = extractMissingColumn(claimError);
            if (missingCol !== 'groupTaskClaimed') {
                console.error('Lỗi claim nhiệm vụ nhóm:', claimError);
                return { ok:false, reason:'claim_error' };
            }
            // Cột chưa tồn tại trên Supabase -> dùng kho lưu tạm với double-check trước khi ghi
            usedFallbackStore = true;
            const extra = await getUserExtra(userId);
            if (extra?.groupTaskClaimed === true) return { ok:false, reason:'already_claimed' };
            await saveUserExtra(userId, { groupTaskClaimed: true });
            await flushUserExtra();
        } else if (!claimRows || claimRows.length === 0) {
            // Một request khác đã claim xong trong lúc hàm này đang kiểm tra ở trên
            return { ok:false, reason:'already_claimed' };
        }

        const mutation = await atomicWalletMutation(userId, {
            deltaCoins: TASK_GROUP_REWARD.coins,
            deltaOrders: TASK_GROUP_REWARD.orders
        });
        if (mutation.error) {
            // Ghi ví thất bại -> hoàn tác cờ claim để không mất vĩnh viễn cơ hội nhận thưởng, cho phép
            // user bấm kiểm tra lại ở lần sau.
            if (usedFallbackStore) await saveUserExtra(userId, { groupTaskClaimed: false });
            else await supabase.from('users').update({ groupTaskClaimed: false }).eq('id', userId);
            return { ok:false, reason:'wallet_update_failed', error:mutation.error };
        }

        await recordAntiFraudEvent(userId, 'task', { rewardEvent:true, coins:TASK_GROUP_REWARD.coins, orders:TASK_GROUP_REWARD.orders });
        logTransaction(userId, 'coin', TASK_GROUP_REWARD.coins, 'Nhiệm vụ Tham gia nhóm');
        logTransaction(userId, 'orders', TASK_GROUP_REWARD.orders, 'Nhiệm vụ Tham gia nhóm');
        const { data: fresh } = await readUserRow(userId);
        return { ok:true, reward:TASK_GROUP_REWARD, coins:fresh?.coins||0, orders:fresh?.orders||0, walletUpdatedAt:fresh?.walletUpdatedAt||null };
    } finally {
        groupTaskProcessing.delete(key);
    }
}
app.post('/api/task/group/claim', async (req, res) => {
    const authUserId = String(req.body?.userId || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const result = await claimGroupTask(authUserId);
        if (!result.ok) {
            if (result.reason === 'already_claimed') return res.json({success:true,alreadyClaimed:true});
            if (result.reason === 'processing') return res.status(409).json({success:false,retry:true,error:'Đang xử lý, vui lòng thử lại.'});
            if (result.reason === 'not_member') return res.status(400).json({success:false,error:'not_member'});
            if (result.reason === 'fraud_hold') return res.status(result.fraudGate.status).json({success:false,...result.fraudGate,verificationRequired:true});
            return res.status(400).json({success:false,error:result.reason});
        }
        res.json({success:true, reward:result.reward, coins:result.coins, orders:result.orders, walletUpdatedAt:result.walletUpdatedAt});
    } catch (e) {
        console.error('Lỗi claim nhiệm vụ nhóm:', e);
        res.status(500).json({success:false,error:e.message});
    }
});



const QUIZ_QUESTIONS = [
    { i: 0, q: 'Hành tinh nào gần Mặt Trời nhất?', options: ['Sao Kim', 'Sao Thủy', 'Trái Đất', 'Sao Hỏa'], answer: 1 },
    { i: 1, q: 'Ai là người đầu tiên đặt chân lên Mặt Trăng?', options: ['Buzz Aldrin', 'Neil Armstrong', 'Yuri Gagarin', 'John Glenn'], answer: 1 },
    { i: 2, q: 'Năm 1945, Việt Nam tuyên bố độc lập vào ngày nào?', options: ['2/9', '30/4', '19/5', '1/1'], answer: 0 },
    { i: 3, q: 'Cái gì bạn không cầm được dù có nắm chặt?', options: ['Cát', 'Nước', 'Gió', 'Tất cả đều đúng'], answer: 3 },
    { i: 4, q: 'Nguyên tố hóa học nào có ký hiệu là “O”?', options: ['Oxy', 'Ozon', 'Oganesson', 'Osmium'], answer: 0 }
];
const QUIZ_REWARD = { coins:150, spins:1 };
app.post('/api/quiz/answer', async (req,res) => {
    const authUserId = String(req.body?.userId || req.params?.id || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const userId = String(req.body?.userId || '');
        const questionId = Number(req.body?.questionId);
        const answer = Number(req.body?.answer);
        if (!userId || !Number.isInteger(questionId) || !Number.isInteger(answer)) return res.status(400).json({success:false,error:'Dữ liệu câu hỏi không hợp lệ.'});
        const user = await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        const quizQuestion = QUIZ_QUESTIONS.find(q => Number(q.i) === questionId);
        if (!quizQuestion) return res.status(400).json({success:false,error:'Không tìm thấy câu hỏi.'});
        const used = Array.isArray(user.quizUsedIds) ? user.quizUsedIds.map(Number) : [];
        if (used.includes(questionId)) return res.status(409).json({success:false,error:'Câu hỏi này đã được trả lời.'});
        const slots = quizState(user);
        if (slots.slotsUsed <= 0) return res.status(400).json({success:false,error:'Chưa mở lượt câu hỏi.'});
        if (used.length >= QUIZ_DAILY_LIMIT) return res.status(429).json({success:false,error:'Bạn đã dùng đủ 5 câu hỏi hôm nay.'});
        const skipped = answer === -3;
        if (!skipped && (answer < 0 || answer >= quizQuestion.options.length)) {
            return res.status(400).json({success:false,error:'Đáp án không hợp lệ.'});
        }
        const correct = !skipped && answer === Number(quizQuestion.answer);
        if (correct) {
            const fraudGate = await antiFraudRewardGate(userId);
            if (!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate,verificationRequired:true});
        }

        const nextUsed = [...used, questionId].slice(0, QUIZ_DAILY_LIMIT);
        let reward = { coins:0, spins:0 };
        if (correct) reward = { ...QUIZ_REWARD };

        const mutation = await atomicWalletMutation(userId, {
            deltaCoins: reward.coins,
            deltaSpins: reward.spins,
            setFields: { quizUsedIds: nextUsed }
        });
        if (mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});

        await recordAntiFraudEvent(userId,'quiz',{rewardEvent:correct,coins:reward.coins,spins:reward.spins});
        if (reward.coins) logTransaction(userId,'coin',reward.coins,'Trả lời quiz đúng');
        const { data:fresh } = await readUserRow(userId);
        res.json({success:true,correct,reward,quizUsedIds:nextUsed,coins:fresh?.coins || 0,spins:fresh?.spins || 0,walletUpdatedAt:fresh?.walletUpdatedAt || null});
    } catch (e) {
        console.error('Lỗi trả lời quiz:',e);
        res.status(500).json({success:false,error:e.message});
    }
});


// ==================== SERVER COIN BOX REWARD ====================
const COIN_BOX_REWARDS = [
    { prob:0.70, coin:100 },
    { prob:0.18, coin:200 },
    { prob:0.07, coin:500 },
    { prob:0.04, coin:1000 },
    { prob:0.009, coin:2000 },
    { prob:0.001, coin:5000 }
];
app.post('/api/coinbox/open', async (req,res) => {
    try {
        const userId = String(req.body?.userId || '');
        const adToken = String(req.body?.adToken || '');
        if (!assertTelegramUser(req, userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
        const event = completedAdEvents.get(adToken);
        if (!event || event.used || event.userId !== userId) return res.status(400).json({success:false,error:'Lượt quảng cáo hợp lệ không tồn tại hoặc đã sử dụng.'});
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate,verificationRequired:true});
        event.used = true;
        let r=Math.random(), c=0, reward=COIN_BOX_REWARDS[0];
        for (const item of COIN_BOX_REWARDS) { c += item.prob; if (r <= c) { reward=item; break; } }
        const user=await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        const mutation = await atomicWalletMutation(userId,{deltaCoins:reward.coin});
        if (mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});
        await recordAntiFraudEvent(userId,'task',{rewardEvent:true,coins:reward.coin});
        logTransaction(userId,'coin',reward.coin,'Mở Hộp Coin sau Rewarded Ad');
        const {data:fresh}=await readUserRow(userId);
        res.json({success:true,coin:reward.coin,coins:fresh?.coins||0,walletUpdatedAt:fresh?.walletUpdatedAt||null});
    } catch(e) { console.error('Lỗi mở Hộp Coin server:',e); res.status(500).json({success:false,error:e.message}); }
});


// ==================== SERVER CHEST REWARD ====================
const CHEST_REWARD_POOL = [
    { label: '❌', prob: 0.6549, type: 'none', value: 0 },
    { label: '100💰', prob: 0.18, type: 'coin', value: 100 },
    { label: '1 Lượt', prob: 0.08, type: 'spin', value: 1 },
    { label: '500💰', prob: 0.04, type: 'coin', value: 500 },
    { label: '1k💰', prob: 0.025, type: 'coin', value: 1000 },
    { label: '3k📦', prob: 0.02, type: 'order', value: 3000 },
    { label: '💎75k', prob: 0.0001, type: 'order', value: 75000 }
];
function pickWeightedReward(pool) {
    let r = Math.random(), cumulative = 0;
    for (const item of pool) { cumulative += item.prob; if (r <= cumulative) return item; }
    return pool[0];
}
const chestProcessing = new Set();
app.post('/api/chest/open', async (req,res) => {
    const authUserId = String(req.body?.userId || req.params?.id || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const userId = String(req.body?.userId || '');
        const eventId = String(req.body?.eventId || '');
        if (!userId || !eventId) return res.status(400).json({success:false,error:'Thiếu userId/eventId.'});
        const lockKey = `${userId}:${eventId}`;
        if (chestProcessing.has(lockKey)) return res.status(409).json({success:false,retry:true,error:'Lượt mở rương đang được xử lý.'});
        chestProcessing.add(lockKey);

        const user = await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        const extra = await getUserExtra(userId);
        const usedEvents = Array.isArray(extra?.chestEventIds) ? extra.chestEventIds.map(String) : [];
        if (usedEvents.includes(eventId)) return res.status(409).json({success:false,alreadyProcessed:true});
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate,verificationRequired:true});
        const spins = Number(user.spins || 0);
        if (spins <= 0) return res.status(400).json({success:false,error:'Không còn lượt mở rương.'});

        const reward = pickWeightedReward(CHEST_REWARD_POOL);
        const nextUsedEvents = [...usedEvents, eventId].slice(-100);
        const setFields = {
            chestOpensTotal: Number(user.chestOpensTotal || 0) + 1,
            chestOpensToday: Number(user.chestOpensToday || 0) + 1
        };
        const mutation = await atomicWalletMutation(userId, {
            deltaSpins: -1 + (reward.type === 'spin' ? reward.value : 0),
            deltaCoins: reward.type === 'coin' ? reward.value : 0,
            deltaOrders: reward.type === 'order' ? reward.value : 0,
            setFields
        });
        if (mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});

        await saveUserExtra(userId, { chestEventIds: nextUsedEvents });
        await flushUserExtra();
        await recordAntiFraudEvent(userId,'task',{
            rewardEvent:true,
            coins:reward.type === 'coin' ? reward.value : 0,
            orders:reward.type === 'order' ? reward.value : 0,
            spins:reward.type === 'spin' ? reward.value : -1
        });
        if (reward.type === 'coin') logTransaction(userId,'coin',reward.value,'Mở rương');
        if (reward.type === 'order') logTransaction(userId,'orders',reward.value,'Mở rương');
        const { data:fresh } = await readUserRow(userId);
        return res.json({success:true,reward,spins:fresh?.spins||0,coins:fresh?.coins||0,orders:fresh?.orders||0,chestOpensTotal:fresh?.chestOpensTotal||0,chestOpensToday:fresh?.chestOpensToday||0,walletUpdatedAt:fresh?.walletUpdatedAt||null});
    } catch(e) {
        console.error('Lỗi mở rương server:',e);
        res.status(500).json({success:false,error:e.message});
    } finally {
        const userId = String(req.body?.userId || '');
        const eventId = String(req.body?.eventId || '');
        chestProcessing.delete(`${userId}:${eventId}`);
    }
});

// ==================== NÂNG CẤP XE (SAU KHI XEM REWARDED AD) ====================
// FIX LỖI "NÂNG CẤP XE BÁO THÀNH CÔNG NHƯNG KHÔNG TRỪ COIN / KHÔNG TĂNG LEVEL": trước đây việc nâng cấp
// (trừ coin + tăng truckLevel) được xử lý HOÀN TOÀN Ở CLIENT trong index.txt, rồi mới gọi saveState() để
// đồng bộ toàn bộ trạng thái lên server. Nếu request đồng bộ đó bị lỗi mạng/timeout, hoặc bị server coi là
// "cũ hơn" một lần đồng bộ khác đang chạy song song (cơ chế chống admin bị ghi đè ở /api/user/:id), thay
// đổi coin/level bị ÂM THẦM loại bỏ (client tự rollback lại giá trị cũ) dù thông báo "Nâng cấp thành công"
// đã hiển thị trước đó rồi -> tải lại app thấy vẫn ở level cũ, đúng hiện tượng lỗi được báo cáo.
// Cách fix: toàn bộ việc nâng cấp giờ xử lý HOÀN TOÀN Ở SERVER trong 1 lệnh update Supabase có điều kiện
// (optimistic lock/CAS trên đúng coins+truckLevel vừa đọc), CHỈ trả "success" cho client sau khi ĐÃ trừ đủ
// coin VÀ đã tăng truckLevel thành công trong DB. Nếu update lỗi -> không mất coin, không báo thành công.
// adToken tái sử dụng đúng cơ chế "1 lượt QC = dùng được đúng 1 lần" đã có sẵn (completedAdEvents) để chống
// bấm nâng cấp nhiều lần / gửi trùng request cho cùng 1 lượt xem quảng cáo.
const truckUpgradeProcessing = new Set();
app.post('/api/truck/upgrade', async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!assertTelegramUser(req, userId)) return res.status(401).json({ success: false, error: 'Telegram session không hợp lệ.' });
    const adToken = String(req.body?.adToken || '');
    if (!userId || !adToken) return res.status(400).json({ success: false, error: 'Thiếu userId/adToken.' });

    // Chống bấm nâng cấp nhiều lần liên tiếp / gửi trùng request khi 1 request trước đó của CÙNG user
    // còn đang xử lý (race condition giữa 2 request đồng thời).
    if (truckUpgradeProcessing.has(userId)) {
        return res.status(409).json({ success: false, retry: true, error: 'Yêu cầu nâng cấp đang được xử lý.' });
    }
    truckUpgradeProcessing.add(userId);
    try {
        // 1 lượt QC (token) chỉ được dùng ĐÚNG 1 LẦN, cho ĐÚNG user đã xem -> chống xem QC xong gửi trùng
        // request nâng cấp, hoặc dùng token của lượt QC khác.
        const event = completedAdEvents.get(adToken);
        if (!event || event.used || event.userId !== userId) {
            return res.status(400).json({ success: false, error: 'Lượt quảng cáo hợp lệ không tồn tại hoặc đã sử dụng.' });
        }
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return res.status(fraudGate.status).json({ success: false, ...fraudGate, verificationRequired: true });
        event.used = true; // Đánh dấu dùng NGAY để token này không thể tái sử dụng lần nữa dù bước dưới lỗi

        // CAS loop: đọc coins/truckLevel MỚI NHẤT, tính giá theo ĐÚNG level hiện tại, rồi update có điều
        // kiện (chỉ thành công nếu coins/truckLevel trên DB CHƯA bị đổi bởi request khác kể từ lúc đọc),
        // tránh 2 request nâng cấp/admin sửa ví chạy song song làm mất coin hoặc lên sai level.
        const MAX_RETRIES = 6;
        let result = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const { data: current, error: readError } = await readUserRow(userId);
            if (readError || !current) { result = { error: readError || new Error('Không tìm thấy user.') }; break; }
            if (current.isBanned) { result = { error: new Error('Tài khoản đã bị khóa.'), isBanned: true }; break; }

            const level = Number(current.truckLevel || 1);
            if (level >= MAX_TRUCK_LEVEL) { result = { error: new Error('Xe đã đạt cấp tối đa.'), maxed: true }; break; }

            const cost = calculateLevelStats(level).upgradeCost;
            const coins = Number(current.coins || 0);
            if (coins < cost) { result = { error: new Error('Không đủ Coin để nâng cấp xe.'), insufficientCoins: true }; break; }

            const { data: updated, error: updateError } = await supabase.from('users')
                .update({ coins: coins - cost, truckLevel: level + 1, walletUpdatedAt: new Date().toISOString() })
                .eq('id', userId)
                .eq('coins', coins)
                .eq('truckLevel', level)
                .select('id,coins,truckLevel,walletUpdatedAt');

            if (updateError) { result = { error: updateError }; break; }
            if (updated && updated.length > 0) {
                result = { error: null, data: updated[0], cost, previousLevel: level };
                break;
            }
            // updated.length === 0 -> dữ liệu vừa bị request khác đổi giữa lúc đọc và lúc update -> thử lại vòng sau
        }

        if (!result) {
            return res.status(409).json({ success: false, retry: true, error: 'Ví vừa thay đổi đồng thời, vui lòng thử lại.' });
        }
        if (result.error) {
            const status = result.isBanned ? 403 : (result.maxed || result.insufficientCoins ? 400 : 500);
            return res.status(status).json({
                success: false,
                error: result.error.message,
                maxed: !!result.maxed,
                insufficientCoins: !!result.insufficientCoins,
                isBanned: !!result.isBanned
            });
        }

        logTransaction(userId, 'coin', -result.cost, `Nâng cấp xe lên cấp ${result.data.truckLevel}`);
        const currentFlags = await getDailyActionFlags(userId);
        await saveUserExtra(userId, { dailyActionFlags: { ...currentFlags, __date: vietnamDayKey(), upgrade: true } });
        await flushUserExtra();
        const levelStats = calculateLevelStats(result.data.truckLevel);
        return res.json({
            success: true,
            truckLevel: result.data.truckLevel,
            coins: result.data.coins,
            upgradeCost: result.cost,
            levelStats,
            walletUpdatedAt: result.data.walletUpdatedAt
        });
    } catch (e) {
        console.error('Lỗi nâng cấp xe server:', e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        truckUpgradeProcessing.delete(userId);
    }
});

// ==================== TĂNG TỐC X2 SẢN XUẤT (XEM QC GIẢM 1/2 THỜI GIAN CHỜ) ====================
// FIX TRIỆT ĐỂ LỖI X2: trước đây kết quả X2 chỉ được TÍNH VÀ LƯU HOÀN TOÀN Ở CLIENT (trong index.txt),
// rồi được gửi lên server qua route đồng bộ chung "/api/user/:id" giống mọi field giao diện khác ->
// KHÔNG có 1 nguồn sự thật (source of truth) atomic cho riêng hành động X2 trên server, nên mới xảy ra:
// bấm X2 xong báo "đã giảm 1/2 thời gian" nhưng đồng hồ thực tế không giảm (do 1 lần saveState() khác
// đang chạy gửi snapshot CŨ ghi đè ngay sau đó, hoặc do 2 request X2/2 tab chạy song song), hoặc
// speedUpUsed=true trong khi lastProducedAt/productionInterval vẫn là giá trị trước X2 (2 field vốn được
// client set ở 2 dòng riêng biệt, không cùng 1 giao dịch). Nay chuyển hẳn việc ÁP DỤNG X2 sang 1 API
// riêng dưới đây, atomic, dùng ĐÚNG cơ chế khoá + xác minh adToken đã có sẵn cho "/api/truck/upgrade":
//  - Khoá theo userId (speedupProcessing) để 2 request X2 chạy song song / double click chỉ 1 cái được xử lý.
//  - Bắt buộc đúng 1 adToken hợp lệ, CHƯA dùng, từ /api/ad/session/complete (completedAdEvents) -> 1 lượt
//    xem QC chỉ áp dụng X2 được đúng 1 lần, không thể replay/gửi trùng request để X2 lần 2.
//  - Đọc currentProducts/maxProducts/lastProducedAt/productionInterval/speedUpUsed MỚI NHẤT trực tiếp từ
//    Supabase (readUserRow) NGAY TẠI THỜI ĐIỂM XỬ LÝ - không tin bất kỳ giá trị nào client gửi lên - rồi
//    tính remainingReal bằng thời gian THỰC vừa trôi qua (kể cả thời gian xem QC), không dùng lại snapshot
//    "remaining" cũ mà client tính trước khi xem QC.
//  - Ghi speedUpUsed=true CÙNG LÚC với lastProducedAt/productionInterval trong đúng 1 lần gọi
//    saveUserFields() (1 giao dịch), nên không bao giờ có tình huống speedUpUsed=true nhưng thời gian
//    chưa giảm, hay ngược lại. walletUpdatedAt cũng được làm mới trong lần ghi này nên cơ chế
//    walletOverridden của "/api/user/:id" (đã có sẵn WALLET_FIELDS gồm cả speedUpUsed) sẽ tự động chặn
//    mọi snapshot cũ hơn (kể cả saveState() đang chạy song song) ghi đè lại kết quả X2 vừa lưu.
// Client (index.txt) CHỈ được cập nhật đồng hồ + hiển thị "X2 thành công" SAU KHI nhận success=true từ
// đúng API này, không còn tự tính/tự trừ thời gian ở phía client nữa.
const speedupProcessing = new Set();
app.post('/api/production/speedup', async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!assertTelegramUser(req, userId)) return res.status(401).json({ success: false, error: 'Telegram session không hợp lệ.' });
    const adToken = String(req.body?.adToken || '');
    if (!userId || !adToken) return res.status(400).json({ success: false, error: 'Thiếu userId/adToken.' });

    // Chống double click / 2 request X2 chạy song song cho CÙNG 1 user (race condition).
    if (speedupProcessing.has(userId)) {
        return res.status(409).json({ success: false, retry: true, error: 'Yêu cầu Tăng Tốc X2 đang được xử lý.' });
    }
    speedupProcessing.add(userId);
    try {
        // 1 lượt QC (token) chỉ được dùng ĐÚNG 1 LẦN, cho ĐÚNG user đã xem -> chống gửi trùng request X2
        // hoặc tái sử dụng token của lượt QC khác/cũ.
        const event = completedAdEvents.get(adToken);
        if (!event || event.used || event.userId !== userId) {
            return res.status(400).json({ success: false, error: 'Lượt quảng cáo hợp lệ không tồn tại hoặc đã sử dụng.' });
        }
        const fraudGate = await antiFraudRewardGate(userId);
        if (!fraudGate.allowed) return res.status(fraudGate.status).json({ success: false, ...fraudGate, verificationRequired: true });
        event.used = true; // Đánh dấu dùng NGAY để token này không thể tái sử dụng lần nữa dù bước dưới lỗi

        const { data: current, error: readError } = await readUserRow(userId);
        if (readError || !current) return res.status(404).json({ success: false, error: 'Không tìm thấy user.' });
        if (current.isBanned) return res.status(403).json({ success: false, isBanned: true, error: 'Tài khoản đã bị khóa.' });

        // Trạng thái mẻ hàng THẬT SỰ đang lưu trên Supabase - nguồn sự thật duy nhất cho X2.
        const currentProducts = Number(current.currentProducts || 0);
        const maxProducts = Number(current.maxProducts || 0);
        const productionInterval = Number(current.productionInterval || 0);
        const lastProducedAt = Number(current.lastProducedAt || Date.now());
        const speedUpUsed = !!current.speedUpUsed;

        if (maxProducts > 0 && currentProducts >= maxProducts) {
            return res.status(400).json({ success: false, alreadyReady: true, error: 'Mẻ hàng đã sẵn sàng, không cần tăng tốc.' });
        }
        if (speedUpUsed) {
            return res.status(400).json({ success: false, alreadyUsed: true, error: 'Mẻ hàng này đã dùng Tăng Tốc X2 rồi.' });
        }

        // Tính thời gian còn lại BẰNG THỜI GIAN THỰC ngay tại thời điểm xử lý (sau khi đã xem xong quảng
        // cáo) - không dùng lại giá trị "remaining" mà client từng tính trước khi xem quảng cáo.
        const now = Date.now();
        const remainingReal = productionInterval - (now - lastProducedAt);
        if (remainingReal <= 0) {
            // Mẻ hàng đã tự sản xuất xong trong lúc xem quảng cáo -> không còn gì để tăng tốc.
            return res.status(400).json({ success: false, alreadyReady: true, error: 'Mẻ hàng đã sẵn sàng trong lúc bạn xem quảng cáo.' });
        }
        const newLastProducedAt = lastProducedAt - Math.floor(remainingReal / 2);

        const { error: saveError } = await saveUserFields(userId, {
            lastProducedAt: newLastProducedAt,
            productionInterval,
            speedUpUsed: true,
            walletUpdatedAt: new Date().toISOString()
        });
        if (saveError) {
            console.error('Lỗi lưu Tăng Tốc X2:', saveError.message || saveError);
            return res.status(500).json({ success: false, error: saveError.message || 'Không lưu được kết quả Tăng Tốc X2.' });
        }

        const { data: fresh } = await readUserRow(userId);
        const currentFlags = await getDailyActionFlags(userId);
        await saveUserExtra(userId, { dailyActionFlags: { ...currentFlags, __date: vietnamDayKey(), x2: true } });
        await flushUserExtra();
        res.json({
            success: true,
            lastProducedAt: Number(fresh?.lastProducedAt ?? newLastProducedAt),
            productionInterval: Number(fresh?.productionInterval ?? productionInterval),
            speedUpUsed: true,
            currentProducts: Number(fresh?.currentProducts ?? currentProducts),
            maxProducts: Number(fresh?.maxProducts ?? maxProducts),
            walletUpdatedAt: fresh?.walletUpdatedAt || null
        });
    } catch (e) {
        console.error('Lỗi Tăng Tốc X2 server:', e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        speedupProcessing.delete(userId);
    }
});

// ==================== GIAO HÀNG: 20 CƠ BẢN + TỐI ĐA 10 BONUS/NGÀY ====================
const DELIVERY_DAILY_LIMIT = 20;
const DELIVERY_MAX_BONUS = 10;
const deliveryProcessing = new Set();
app.post('/api/delivery/claim', async (req,res)=>{
    const userId=String(req.body?.userId||''); if(!assertTelegramUser(req,userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    const adToken=String(req.body?.adToken||''); if(!adToken) return res.status(400).json({success:false,error:'Thiếu adToken của Rewarded Interstitial.'});
    const key=`${userId}:${adToken}`; if(deliveryProcessing.has(key)) return res.status(409).json({success:false,retry:true,error:'Đang xử lý lượt giao hàng.'});
    deliveryProcessing.add(key);
    try{
        const event=completedAdEvents.get(adToken);
        if(!event || event.userId!==userId || event.purpose!=='delivery') return res.status(400).json({success:false,error:'Lượt Rewarded dùng cho giao hàng không hợp lệ hoặc đã hết hạn.'});
        if(event.used && event.deliveryClaimResult) return res.json({success:true,...event.deliveryClaimResult,idempotent:true});
        const fraudGate=await antiFraudRewardGate(userId); if(!fraudGate.allowed) return res.status(fraudGate.status).json({success:false,...fraudGate,verificationRequired:true});
        const user=await loadCurrentDailyUser(userId); if(!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        if(user.isBanned) return res.status(403).json({success:false,isBanned:true,error:'Tài khoản đã bị khóa.'});
        const current=Math.max(0,Number(user.deliveryCount||0)); const extra=Math.min(DELIVERY_MAX_BONUS,Math.max(0,Number(user.extraDeliveryCount||0))); const limit=DELIVERY_DAILY_LIMIT+extra;
        if(current>=limit) return res.status(429).json({success:false,limitReached:true,deliveryCount:current,limit,error:'Bạn đã dùng hết lượt giao hàng hiện có hôm nay.'});
        const deliveredProducts=Math.max(0,Number(user.currentProducts||0));
        if(deliveredProducts<=0) return res.status(400).json({success:false,error:'Kho chưa có hàng để giao.'});
        const deliveryCount=current+1; const lifetime=Math.max(0,Number(user.deliveryCountLifetime||0))+1;
        const mutation=await atomicWalletMutation(userId,{
            deltaOrders: deliveredProducts,
            setFields:{
                deliveryCount, deliveryCountLifetime, currentProducts:0,
                lastProducedAt:Date.now(), speedUpUsed:false, lastResetDate:vietnamDayKey()
            }
        });
        if(mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});
        const fresh=await readUserRow(userId);
        const result={
            deliveryCount, remaining:limit-deliveryCount, limit, bonusLimit:DELIVERY_MAX_BONUS, extraDeliveryCount:extra,
            deliveredProducts, currentProducts:Number(fresh.data?.currentProducts||0), orders:Number(fresh.data?.orders||0),
            lastProducedAt:Number(fresh.data?.lastProducedAt||Date.now()), speedUpUsed:!!fresh.data?.speedUpUsed,
            walletUpdatedAt:fresh.data?.walletUpdatedAt||mutation.data?.walletUpdatedAt||null
        };
        event.used=true; event.deliveryClaimResult=result;
        await recordAntiFraudEvent(userId,'delivery',{rewardEvent:true,ip:requestIp(req),adToken});
        res.json({success:true,...result});
    }catch(e){res.status(500).json({success:false,error:e.message});}finally{deliveryProcessing.delete(key);}
});

// ==================== CAPTCHA & AD TRACKING ENDPOINTS ====================

// API kiểm tra xem delivery này có cần CAPTCHA không (random 1-3 lần đầu tiên)
app.post('/api/delivery/check-captcha', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await loadCurrentDailyUser(String(userId || ''));
        if (!user) return res.status(404).json({ error:'User không tồn tại' });
        const current = Math.max(0, Number(user.deliveryCount || 0));
        const bonus = Math.min(DELIVERY_MAX_BONUS, Math.max(0, Number(user.extraDeliveryCount || 0)));
        const limit = DELIVERY_DAILY_LIMIT + bonus;
        if (current >= limit) {
            return res.status(429).json({ error:'Hôm nay bạn đã dùng hết lượt giao hàng.', deliveryCount:current, limit });
        }
        const nextDelivery = current + 1;
        const requiresCaptcha = nextDelivery <= 3 && Math.random() < 0.4;
        res.json({
            requiresCaptcha, deliveryCount:current, remaining:limit-current, limit,
            captchaCode: requiresCaptcha ? Math.random().toString(36).substring(2,8).toUpperCase() : null
        });
    } catch (e) {
        console.error('Lỗi check CAPTCHA delivery:', e.message);
        res.status(500).json({ error:e.message });
    }
});

// API xác thực CAPTCHA trước khi cho phép rút tiền
app.post('/api/withdraw/captcha-verify', async (req, res) => {
    try {
        const { userId, captchaInput, captchaCode } = req.body;
        const verified = captchaInput.toUpperCase() === captchaCode;
        
        if (verified) {
            await saveUserFields(userId, { lastCaptchaAt: new Date().toISOString() });
        }
        
        res.json({ verified });
    } catch (e) {
        console.error('Lỗi xác thực CAPTCHA:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// API theo dõi xem QC (dùng cho in-app ads & banner tracking)
app.post('/api/ad/impression', async (req, res) => {
    try {
        const { userId, adType, zone } = req.body;
        if (!userId || !adType) return res.status(400).json({ error: 'Missing userId or adType' });
        
        // Log ad impression (optional - có thể store vào table analytics nếu cần)
        console.log(`[AD] ${adType} zone ${zone} - user ${userId}`);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const adSessions = new Map();
const activeAdByUser = new Map();
const completedAdEvents = new Map();
const adRewardProcessing = new Set();
function makeAdToken() { return `${Date.now()}_${Math.random().toString(36).slice(2,12)}`; }
app.post('/api/ad/session/start', async (req, res) => {
    const authUserId = String(req.body?.userId || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const { userId, adType, purpose, sessionId } = req.body || {};
        if (!userId || !['rewarded','inapp'].includes(adType)) return res.status(400).json({success:false,error:'Invalid ad session'});
        const allowedPurposes = ['generic','delivery','extra-delivery','x2','truck-upgrade','streak-recovery','bonus-task','quiz-unlock','quiz-skip','chest-spin','passive'];
        const sessionPurpose = allowedPurposes.includes(purpose) ? purpose : 'generic';
        const normalizedUserId = String(userId);
        const existingToken = activeAdByUser.get(normalizedUserId);
        if (existingToken) {
            const existing = adSessions.get(existingToken);
            if (existing && Date.now() - existing.startedAt < 120000) {
                return res.status(409).json({success:false,retry:true,active:true,token:existingToken,error:'Đang có một quảng cáo được xử lý cho tài khoản này.'});
            }
            activeAdByUser.delete(normalizedUserId);
            adSessions.delete(existingToken);
        }
        const token = makeAdToken();
        adSessions.set(token, { userId:normalizedUserId, adType, purpose:sessionPurpose, sessionId:String(sessionId || ''), startedAt:Date.now() });
        activeAdByUser.set(normalizedUserId, token);
        recordAntiFraudEvent(String(userId), 'ad_start', {
            ip: requestIp(req),
            sessionId: String(sessionId || ''),
            countAction: false
        }).catch(e => console.error('Anti-fraud ad start:', e.message));
        setTimeout(() => {
            adSessions.delete(token);
            if (activeAdByUser.get(normalizedUserId) === token) activeAdByUser.delete(normalizedUserId);
        }, 120000);
        res.json({ success:true, token });
    } catch (e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/ad/session/complete', async (req, res) => {
    const authUserId = String(req.body?.userId || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    const processingUserId = String(req.body?.userId || '');
    const key = `${processingUserId}:${String(req.body?.token||'')}`;
    if (adRewardProcessing.has(key)) return res.status(409).json({success:false,retry:true,error:'Lượt quảng cáo đang được xử lý.'});
    adRewardProcessing.add(key);
    try {
        const { userId, token, adType, sessionId } = req.body || {};
        const existingCompleted = completedAdEvents.get(String(token));
        if (existingCompleted && existingCompleted.userId === String(userId) && existingCompleted.adType === adType) {
            if (existingCompleted.completionResult) return res.json({ ...existingCompleted.completionResult, idempotent:true });
        }
        const s=adSessions.get(token);
        if (!s || s.userId!==String(userId) || s.adType!==adType) return res.status(400).json({success:false,error:'Phiên quảng cáo không hợp lệ.'});
        const elapsed=Date.now()-s.startedAt; const purpose=s.purpose||'generic';
        if (purpose!=='passive' && elapsed<5000) {
            await recordAntiFraudEvent(String(userId),'ad',{reactionTime:elapsed,retry:true,ip:requestIp(req),rewardEvent:false,sessionId});
            return res.status(400).json({success:false,error:'QC chưa đủ 5 giây.'});
        }
        const preRisk=await recordAntiFraudEvent(String(userId),'ad',{reactionTime:elapsed,ip:requestIp(req),rewardEvent:false,countAction:false,sessionId,checkDuplicateIp:true});
        if (purpose!=='passive' && preRisk.blockedReward) return res.status(429).json({success:false,verificationRequired:true,riskScore:preRisk.score,riskLevel:preRisk.level,error:'Reward quảng cáo đang tạm giữ để kiểm tra bảo mật.'});
        if (purpose==='passive') {
            insertRowSafe('ad_events',{user_id:String(userId),ad_type:'rewarded',purpose,status:'passive_success',ip:requestIp(req),created_at:new Date().toISOString()}).catch(()=>{});
            const passiveResponse={success:true,adToken:String(token),purpose,passive:true,elapsed};
            completedAdEvents.set(String(token),{userId:String(userId),adType,purpose,completedAt:Date.now(),used:true,passive:true,completionResult:passiveResponse});
            if (activeAdByUser.get(String(userId)) === token) activeAdByUser.delete(String(userId));
            adSessions.delete(token);
            setTimeout(()=>completedAdEvents.delete(String(token)),120000);
            return res.json(passiveResponse);
        }
        let user=await loadCurrentDailyUser(String(userId)); if(!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'});
        if (purpose==='extra-delivery') {
            if (Number(user.deliveryCount||0)<20) return res.status(400).json({success:false,error:'Chỉ có thể nhận thêm lượt sau khi đã giao đủ 20 lượt cơ bản hôm nay.'});
            if (Number(user.extraDeliveryAdsToday||0)>=5) return res.status(429).json({success:false,limitReached:true,error:'Đã xem đủ 5 quảng cáo nhận thêm lượt giao hôm nay.'});
        }
        if (purpose==='chest-spin' && Number(user.spinAdCount||0)>=10) return res.status(429).json({success:false,error:'Bạn đã xem đủ QC Rương hôm nay (tối đa 10).'});
        const next=await incrementWeeklyAds(String(userId)); if(next===null) return res.status(500).json({success:false,error:'Không cập nhật được BXH Xem QC.'});
        const rewardCoins=purpose==='bonus-task'?50:0, rewardOrders=purpose==='bonus-task'?25:0, rewardSpins=purpose==='chest-spin'?1:0;
        const updateFields={adsToday:Number(user.adsToday||0)+1,rewardedAdsToday:Number(user.rewardedAdsToday||0)+1,lifetimeAdsWatched:Number(user.lifetimeAdsWatched||0)+1,lastResetDate:vietnamDayKey()};
        if(purpose==='bonus-task') updateFields.bonusAdsToday=Number(user.bonusAdsToday||0)+1;
        if(purpose==='chest-spin') updateFields.spinAdCount=Number(user.spinAdCount||0)+1;
        if(purpose==='extra-delivery'){
            updateFields.extraDeliveryAdsToday=Number(user.extraDeliveryAdsToday||0)+1;
            updateFields.extraDeliveryCount=Math.min(10,Number(user.extraDeliveryCount||0)+2);
        }
        const mutation=await atomicWalletMutation(String(userId),{deltaCoins:rewardCoins,deltaOrders:rewardOrders,deltaSpins:rewardSpins,setFields:updateFields});
        if(mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message});
        const fresh=await readUserRow(String(userId));
        const completed={userId:String(userId),adType,purpose,completedAt:Date.now(),used:false,deliveryClaimResult:null,streakRecoveryResult:null,completionResult:null};
        await recordAntiFraudEvent(String(userId),'ad',{reactionTime:elapsed,ip:requestIp(req),rewardEvent:true,coins:rewardCoins,orders:rewardOrders,spins:rewardSpins,sessionId,purpose});
        if(rewardCoins) logTransaction(String(userId),'coin',rewardCoins,'Xem 1 QC hợp lệ'); if(rewardOrders) logTransaction(String(userId),'orders',rewardOrders,'Xem 1 QC hợp lệ');
        try{await tryFinalizeReferral(String(userId));}catch(_){}
        insertRowSafe('ad_events',{user_id:String(userId),ad_type:adType,status:'success',purpose,ip:requestIp(req),created_at:new Date().toISOString()}).catch(()=>{});
        completedAdEvents.set(String(token),completed);
        const response={success:true,adToken:String(token),purpose,weeklyAdsCount:next,adsToday:Number(fresh.data?.adsToday||0),rewardedAdsToday:Number(fresh.data?.rewardedAdsToday||0),lifetimeAdsWatched:Number(fresh.data?.lifetimeAdsWatched||0),bonusAdsToday:Number(fresh.data?.bonusAdsToday||0),extraDeliveryAdsToday:Number(fresh.data?.extraDeliveryAdsToday||0),extraDeliveryCount:Number(fresh.data?.extraDeliveryCount||0),rewardCoins,rewardOrders,rewardSpins,coins:Number(fresh.data?.coins||0),orders:Number(fresh.data?.orders||0),spins:Number(fresh.data?.spins||0),spinAdCount:Number(fresh.data?.spinAdCount||0),walletUpdatedAt:fresh.data?.walletUpdatedAt||mutation.data?.walletUpdatedAt||null,elapsed,riskScore:(await getAntiFraudState(String(userId))).stats.score};
        completed.completionResult=response;
        adSessions.delete(token);
        if (activeAdByUser.get(String(userId)) === token) activeAdByUser.delete(String(userId));
        setTimeout(()=>completedAdEvents.delete(String(token)),10*60*1000);
        res.json(response);
    } catch(e){res.status(500).json({success:false,error:e.message});} finally{adRewardProcessing.delete(key);}
});

// API cũ giữ tương thích nhưng KHÔNG tự cộng BXH nữa.
// BXH Xem QC chỉ được cộng tại /api/ad/session/complete sau khi server xác nhận
// đúng loại Rewarded/In-App và đủ >= 5 giây, tránh đếm trùng hoặc bị gọi giả.
app.post('/api/ad/watched', async (req, res) => {
    try {
        const { userId, adType } = req.body || {};
        if (!userId || !['rewarded','inapp'].includes(adType)) return res.status(400).json({success:false,error:'Chỉ Rewarded/In-App Interstitial được tính BXH.'});
        const counts = await getWeeklyAdsCounts();
        res.json({ success:true, weeklyAdsCount:Number(counts[String(userId)]||0), countingEndpoint:'/api/ad/session/complete' });
    } catch (e) { console.error('Lỗi kiểm tra BXH Xem QC:',e); res.status(500).json({success:false,error:e.message}); }
});

// Heartbeat anti-fraud: chỉ ghi telemetry tổng hợp, không tin client để cấp reward.
app.post('/api/security/heartbeat', async (req,res) => {
    try {
        const userId = String(req.body?.userId || '');
        if (!assertTelegramUser(req, userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
        const result = await recordAntiFraudEvent(userId, 'heartbeat', {
            isHeartbeat: true,
            sessionId: String(req.body?.sessionId || ''),
            ip: requestIp(req),
            clickIntervals: Array.isArray(req.body?.clickIntervals) ? req.body.clickIntervals.slice(-20) : [],
            device: req.body?.device || {}
        });
        const current = await getAntiFraudState(userId);
        res.json({
            success:true,
            riskScore:result.score,
            riskLevel:result.level,
            activeHoursToday:Number(result.activeHoursToday || 0),
            consecutiveActiveDays:Number(current.state.consecutiveActiveDays || 0),
            suspiciousSignals:result.reasons || [],
            verificationRequired:result.score >= ANTI_FRAUD_CONFIG.thresholds.challenge
        });
    } catch(e) {
        console.error('Lỗi anti-fraud heartbeat:', e.message);
        res.status(500).json({success:false,error:'Không cập nhật được security heartbeat.'});
    }
});

// ==================== END CAPTCHA & AD TRACKING ====================

// API kiểm tra và xác nhận mời bạn hợp lệ (gọi từ frontend mỗi khi user xem QC)
app.post('/api/check-referral/:id', async (req, res) => {
    const authUserId = String(req.body?.userId || req.params?.id || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    try {
        const userId = req.params.id;

        // SECURITY: referral counters are server-owned. Do NOT trust lifetimeAdsWatched/lifetimeSmartlinks
        // or clientWalletSyncedAt from the request body. Referral eligibility must come from trusted server events.
        const result = await tryFinalizeReferral(userId);
        res.json(result);
    } catch (e) {
        console.error("Lỗi check-referral:", e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ==================== LOGIN STREAK 7 NGÀY ====================
const STREAK_REWARDS = [
 {day:1,coins:100,orders:0,spins:0},{day:2,coins:150,orders:0,spins:0},{day:3,coins:200,orders:20,spins:0},
 {day:4,coins:250,orders:30,spins:0},{day:5,coins:350,orders:0,spins:1},{day:6,coins:500,orders:50,spins:0},{day:7,coins:1000,orders:100,spins:1}
];
function addVietnamDays(dayKey,days){ const d=new Date(`${dayKey}T12:00:00+07:00`); d.setUTCDate(d.getUTCDate()+days); return vietnamDayKey(d); }
function diffVietnamDays(a,b){ const da=new Date(`${a}T12:00:00+07:00`).getTime(); const db=new Date(`${b}T12:00:00+07:00`).getTime(); return Math.round((db-da)/(24*60*60*1000)); }
async function getStreakState(userId){ const extra=await getUserExtra(userId); return (extra?.loginStreakState&&typeof extra.loginStreakState==='object')?{...extra.loginStreakState}:{day:0,lastCheckInDate:null,recoveryAvailable:false,recoveryDate:null}; }
function streakView(state){ const today=vietnamDayKey(); let day=Number(state.day||0), current=0, missed=false; if(state.lastCheckInDate){ const diff=diffVietnamDays(state.lastCheckInDate,today); if(diff===0) current=day||7; else if(diff===1) current=day>=7?1:day+1; else { missed=true; current=day>=7?1:day+1; } } else current=1; return {today,day,currentDay:current,missed,recoveryAvailable:missed||!!state.recoveryAvailable,recoveryDate:state.recoveryDate||null,lastCheckInDate:state.lastCheckInDate||null}; }
app.get('/api/streak/status/:id',async(req,res)=>{ const userId=String(req.params.id||''); if(!assertTelegramUser(req,userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'}); try{ const state=await getStreakState(userId); res.json({success:true,...streakView(state),rewards:STREAK_REWARDS}); }catch(e){res.status(500).json({success:false,error:e.message});} });
const streakProcessing=new Set();
app.post('/api/streak/checkin',async(req,res)=>{ const userId=String(req.body?.userId||''); if(!assertTelegramUser(req,userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'}); if(streakProcessing.has(userId)) return res.status(409).json({success:false,retry:true,error:'Đang xử lý điểm danh.'}); streakProcessing.add(userId); try{ const fraud=await antiFraudRewardGate(userId); if(!fraud.allowed) return res.status(fraud.status).json({success:false,...fraud,verificationRequired:true}); const user=await loadCurrentDailyUser(userId); if(!user) return res.status(404).json({success:false,error:'Không tìm thấy user.'}); const state=await getStreakState(userId); const view=streakView(state); if(state.lastCheckInDate===view.today) return res.json({success:true,alreadyClaimed:true,...view,rewards:STREAK_REWARDS}); if(view.missed) { const recoveryDate=state.recoveryDate||addVietnamDays(state.lastCheckInDate||view.today,1); const recoveryAvailable=true; await saveUserExtra(userId,{loginStreakState:{...state,recoveryAvailable,recoveryDate}}); return res.status(409).json({success:false,missed:true,recoveryAvailable:true,recoveryDate,...view,error:'Chuỗi đã bị đứt. Hãy khôi phục bằng Rewarded để nhận lại ngày bị bỏ lỡ.'}); } const day=view.currentDay||1; const reward=STREAK_REWARDS[day-1]; const mutation=await atomicWalletMutation(userId,{deltaCoins:reward.coins,deltaOrders:reward.orders,deltaSpins:reward.spins}); if(mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message}); const nextState={day:day,lastCheckInDate:view.today,recoveryAvailable:false,recoveryDate:null}; await saveUserExtra(userId,{loginStreakState:nextState}); await flushUserExtra(); if(reward.coins) logTransaction(userId,'coin',reward.coins,`Điểm danh Day ${day}`); if(reward.orders) logTransaction(userId,'orders',reward.orders,`Điểm danh Day ${day}`); await recordAntiFraudEvent(userId,'streak',{rewardEvent:true,coins:reward.coins,orders:reward.orders,spins:reward.spins,day}); const fresh=await readUserRow(userId); res.json({success:true,day,reward,day7:day===7,...streakView(nextState),coins:fresh.data?.coins||0,orders:fresh.data?.orders||0,spins:fresh.data?.spins||0,walletUpdatedAt:fresh.data?.walletUpdatedAt||mutation.data?.walletUpdatedAt||null}); }catch(e){res.status(500).json({success:false,error:e.message});}finally{streakProcessing.delete(userId);} });
app.post('/api/streak/recover',async(req,res)=>{ const userId=String(req.body?.userId||''); const adToken=String(req.body?.adToken||''); if(!assertTelegramUser(req,userId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'}); if(!adToken) return res.status(400).json({success:false,error:'Thiếu adToken.'}); if(streakProcessing.has(userId)) return res.status(409).json({success:false,retry:true,error:'Đang xử lý khôi phục chuỗi.'}); streakProcessing.add(userId); try{ const event=completedAdEvents.get(adToken); if(!event||event.userId!==userId||event.purpose!=='streak-recovery') return res.status(400).json({success:false,error:'Rewarded khôi phục chuỗi không hợp lệ.'}); if(event.used&&event.streakRecoveryResult) return res.json({success:true,...event.streakRecoveryResult,idempotent:true}); const fraud=await antiFraudRewardGate(userId); if(!fraud.allowed) return res.status(fraud.status).json({success:false,...fraud,verificationRequired:true}); const state=await getStreakState(userId); const view=streakView(state); if(!view.missed) return res.status(400).json({success:false,error:'Hiện không có ngày bị bỏ lỡ để khôi phục.'}); const recoveryDay=Number(view.currentDay||1); const reward=STREAK_REWARDS[recoveryDay-1]; const mutation=await atomicWalletMutation(userId,{deltaCoins:reward.coins,deltaOrders:reward.orders,deltaSpins:reward.spins}); if(mutation.error) return res.status(409).json({success:false,retry:true,error:mutation.error.message}); const recoveryDate=view.recoveryDate||addVietnamDays(state.lastCheckInDate||view.today,1); const nextState={day:recoveryDay,lastCheckInDate:view.today,recoveryAvailable:false,recoveryDate:null}; await saveUserExtra(userId,{loginStreakState:nextState}); await flushUserExtra(); event.used=true; event.streakRecoveryResult={recoveryDay,reward,...streakView(nextState)}; if(reward.coins) logTransaction(userId,'coin',reward.coins,`Khôi phục chuỗi Day ${recoveryDay}`); if(reward.orders) logTransaction(userId,'orders',reward.orders,`Khôi phục chuỗi Day ${recoveryDay}`); await recordAntiFraudEvent(userId,'streak',{rewardEvent:true,recovery:true,coins:reward.coins,orders:reward.orders,spins:reward.spins,day:recoveryDay}); const fresh=await readUserRow(userId); res.json({success:true,...event.streakRecoveryResult,coins:fresh.data?.coins||0,orders:fresh.data?.orders||0,spins:fresh.data?.spins||0,walletUpdatedAt:fresh.data?.walletUpdatedAt||mutation.data?.walletUpdatedAt||null}); }catch(e){res.status(500).json({success:false,error:e.message});}finally{streakProcessing.delete(userId);} });

// API rút tiền - Hỗ trợ Ngân hàng / Momo / ZaloPay với các trường tách riêng
// (bankName, accountName, accountNumber cho ngân hàng; accountNumber = SĐT cho Momo/ZaloPay)
// LƯU Ý SCHEMA: bảng "withdrawals" trên Supabase cần có thêm các cột:
// ordersAmount (int8), bankName (text), accountName (text), accountNumber (text), txCode (int8)
const SUPPORTED_BANKS = [
 'Vietcombank','BIDV','VietinBank','Agribank','MBBank','Techcombank','VPBank','ACB','Sacombank','HDBank','VIB','TPBank','SHB','MSB','Eximbank','OCB','SeABank','LPBank','Bac A Bank','Nam A Bank','VietABank','ABBank','PVcomBank','KienlongBank','VietBank','BVBank','Public Bank Vietnam','Hong Leong Bank Vietnam','UOB Vietnam','HSBC Vietnam','Standard Chartered Vietnam','CIMB Vietnam','Woori Bank Vietnam','Shinhan Bank Vietnam','DBS Vietnam'
];
const SUPPORTED_EWALLETS = ['momo','zalopay'];
function normalizeAccountDigits(v){ return String(v??'').trim().replace(/\s+/g,''); }
const WITHDRAW_MIN_ORDERS = 30000;      // Tối thiểu 30.000 Đơn Hàng (= 3.000 VNĐ, tỷ giá 1 Order = 0,1 VNĐ giữ nguyên)
const WITHDRAW_MIN_ADS = 7;             // Xem tối thiểu 7 QC trong ngày
const WITHDRAW_MIN_SMARTLINKS = 10;     // Bấm tối thiểu 10 SmartLink trong ngày
const WITHDRAW_PER_USER_PER_DAY = 1;    // Mỗi người 1 đơn rút/ngày
const WITHDRAW_DAILY_QUOTA = 20;        // Toàn Mini App nhận tối đa 20 đơn rút/ngày
const withdrawalProcessing = new Set();
let withdrawalQueue = Promise.resolve();
async function acquireWithdrawalQueue() {
    const previous = withdrawalQueue;
    let release;
    const current = new Promise(resolve => { release = resolve; });
    withdrawalQueue = previous.then(() => current);
    await previous;
    return release;
}
// Nhóm nhận thông báo rút tiền: https://t.me/khohangchatkiemtien
const WITHDRAW_NOTIFY_CHAT = process.env.WITHDRAW_NOTIFY_CHAT || '@khohangchatkiemtien';
app.post('/api/withdraw', async (req, res) => {
    const authUserId = String(req.body?.userId || req.params?.id || '');
    if (!assertTelegramUser(req, authUserId)) return res.status(401).json({success:false,error:'Telegram session không hợp lệ.'});
    const releaseWithdrawalQueue = await acquireWithdrawalQueue();
    let withdrawalUserId = '';
    try {
        const { userId, method, bankName, accountName, accountNumber, ordersAmount, walletType } = req.body;
        withdrawalUserId = String(userId || '');
        if (withdrawalUserId && withdrawalProcessing.has(withdrawalUserId)) {
            return res.status(409).json({ error: 'Yêu cầu rút tiền đang được xử lý. Vui lòng thử lại sau ít giây.' });
        }
        if (withdrawalUserId) {
            withdrawalProcessing.add(withdrawalUserId);
            setTimeout(() => withdrawalProcessing.delete(withdrawalUserId), 30000);
        }

        if (!userId || !method || !accountNumber || !ordersAmount) {
        return res.status(400).json({ error: "Vui lòng nhập đầy đủ thông tin rút tiền." });
    }
    if (ordersAmount < WITHDRAW_MIN_ORDERS) { // Mức rút tối thiểu: 30.000 Đơn Hàng (3.000 VNĐ)
        return res.status(400).json({ error: "Số đơn hàng rút tối thiểu là 30.000 Đơn Hàng (3.000 VNĐ)." });
    }
    const normalizedAccountNumber = normalizeAccountDigits(accountNumber);
    const normalizedAccountName = String(accountName || '').trim().toUpperCase();
    if (!/^[0-9]+$/.test(normalizedAccountNumber)) return res.status(400).json({ error:'Số tài khoản/số điện thoại chỉ được chứa chữ số.' });
    if (!normalizedAccountName) return res.status(400).json({ error:'Tên Chủ Tài Khoản là bắt buộc.' });
    let normalizedMethod = method;
    let normalizedWalletType = String(walletType||'').toLowerCase();
    if (method === 'momo' || method === 'zalopay') { normalizedMethod='ewallet'; normalizedWalletType=method; }
    if (normalizedMethod === 'bank') {
        const normalizedBank=String(bankName||'').trim();
        if (!SUPPORTED_BANKS.includes(normalizedBank)) return res.status(400).json({error:'Ngân hàng không nằm trong danh sách được hỗ trợ.'});
    } else if (normalizedMethod === 'ewallet') {
        if (!SUPPORTED_EWALLETS.includes(normalizedWalletType)) return res.status(400).json({error:'Vui lòng chọn MoMo hoặc ZaloPay.'});
    } else return res.status(400).json({error:'Phương thức rút tiền không hợp lệ.'});

    const { data: userData } = await readUserRow(userId);
    if (!userData) {
        return res.status(404).json({ error: "User not found or database error." });
    }
    if (userData.isBanned) {
        return res.status(403).json({ error: "Tài khoản đã bị khóa." });
    }

    const withdrawalRisk = await recordAntiFraudEvent(String(userId), 'withdrawal', {
        ip: requestIp(req), rewardEvent:false
    });
    if (withdrawalRisk.holdWithdrawal) {
        return res.status(423).json({
            error: "Yêu cầu rút tiền đang được tạm giữ để kiểm tra bảo mật.",
            verificationRequired: true,
            riskScore: withdrawalRisk.score,
            riskLevel: withdrawalRisk.level
        });
    }

    // FIRST-WITHDRAW PROTECTION: account must be at least 24 hours old by server time.
    // (Điều kiện tuổi tài khoản >= 24 giờ cho lần rút đầu tiên đã được YÊU CẦU GỠ BỎ - xem log commit.
    // Các điều kiện rút tiền khác bên dưới (đơn hàng, QC, SmartLink, giới hạn/ngày, anti-fraud...) giữ nguyên.)
    
    // Điều kiện rút tiền: đọc TRỰC TIẾP từ DB (không tin dữ liệu client gửi lên) để chống gian lận.
    // Yêu cầu: ≥30.000 Đơn Hàng, xem ≥7 QC hôm nay, bấm ≥10 SmartLink hôm nay.
    const adsTodayCount = Number(userData.adsToday || 0);
    const smartlinksTodayCount = Number(userData.smartlinksToday || 0);
    if (adsTodayCount < WITHDRAW_MIN_ADS || smartlinksTodayCount < WITHDRAW_MIN_SMARTLINKS) {
        return res.status(400).json({ error: `Chưa đủ điều kiện: cần xem ≥${WITHDRAW_MIN_ADS} QC hôm nay (hiện ${adsTodayCount}/${WITHDRAW_MIN_ADS}) và bấm ≥${WITHDRAW_MIN_SMARTLINKS} SmartLink hôm nay (hiện ${smartlinksTodayCount}/${WITHDRAW_MIN_SMARTLINKS}).` });
    }
    // Mỗi người chỉ rút 1 lần/ngày và toàn Mini App chỉ nhận tối đa 20 đơn rút mỗi ngày (0h00 giờ VN)
    const dayStart = vietnamDayStartIso();
    const { count: myTodayCount, error: myCountError } = await supabase.from('withdrawals')
        .select('*', { count: 'exact', head: true }).eq('userId', userId).gte('createdAt', dayStart);
    if (myCountError) console.error('Lỗi đếm đơn rút của user:', myCountError.message);
    if ((myTodayCount || 0) >= WITHDRAW_PER_USER_PER_DAY) {
        return res.status(429).json({ error: `Mỗi ngày chỉ được rút ${WITHDRAW_PER_USER_PER_DAY} lần. Vui lòng quay lại sau 0h00.` });
    }
    const { count: allTodayCount, error: allCountError } = await supabase.from('withdrawals')
        .select('*', { count: 'exact', head: true }).gte('createdAt', dayStart);
    if (allCountError) console.error('Lỗi đếm đơn rút trong ngày:', allCountError.message);
    if ((allTodayCount || 0) >= WITHDRAW_DAILY_QUOTA) {
        return res.status(429).json({ error: `Hôm nay đã đủ ${WITHDRAW_DAILY_QUOTA} đơn rút của hệ thống. Vui lòng quay lại sau 0h00.` });
    }
    if (userData.orders < ordersAmount) {
        return res.status(400).json({ error: "Không đủ đơn hàng để rút số lượng này." });
    }

    // Tỉ lệ quy đổi: 1 Đơn Hàng = 0,1 VNĐ (mức rút tối thiểu: 30.000 Đơn Hàng = 3.000 VNĐ)
    const amountVnd = Math.floor(ordersAmount * 0.1);
    const newOrders = userData.orders - ordersAmount;
    const methodLabel = normalizedMethod === 'bank' ? String(bankName).trim() : (normalizedWalletType === 'momo' ? 'Ví điện tử - MoMo' : 'Ví điện tử - ZaloPay');
    const accountInfoText = normalizedMethod === 'bank' ? `${String(bankName).trim()} - ${normalizedAccountName} - ${normalizedAccountNumber}` : `${normalizedWalletType} - ${normalizedAccountNumber}`;

    try {
        // Mã giao dịch tuần tự cho TOÀN BỘ bot (đơn rút thứ 1, 2, 3...)
        const { count } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true });
        const txCode = (count || 0) + 1;

        // Trừ đơn hàng bằng UPDATE có điều kiện (WHERE orders = giá_trị_vừa_đọc): nếu có 1 yêu cầu rút khác
        // vừa kịp trừ trước trong lúc request này đang xử lý, orders thực tế trên DB sẽ khác giá trị đã đọc
        // -> 0 dòng bị ảnh hưởng -> từ chối ngay, KHÔNG tạo đơn rút, tránh trừ vượt quá số dư thực có.
        const newOrdersWalletUpdatedAt = new Date().toISOString();
        const { data: updatedRows, error: updErr } = await supabase.from('users')
            .update({ orders: newOrders, walletUpdatedAt: newOrdersWalletUpdatedAt })
            .eq('id', userId)
            .eq('orders', userData.orders)
            .select('orders, walletUpdatedAt');
        if (updErr) throw updErr;
        if (!updatedRows || updatedRows.length === 0) {
            return res.status(409).json({ error: "Số dư của bạn vừa thay đổi, vui lòng thử lại." });
        }

        const { error: withdrawInsertError } = await insertRowSafe('withdrawals', {
            userId,
            amount: amountVnd,
            ordersAmount,
            method: methodLabel,
            bankName: normalizedMethod === 'bank' ? String(bankName).trim() : null,
            accountName: normalizedAccountName,
            accountNumber: normalizedAccountNumber,
            walletType: normalizedMethod === 'ewallet' ? normalizedWalletType : null,
            accountInfo: accountInfoText,
            status: 'pending',
            txCode
        });
        if (withdrawInsertError) {
            // CHỐNG MẤT ĐƠN HÀNG: đơn hàng đã bị trừ trước khi tạo đơn rút. Nếu tạo đơn rút thất bại
            // thì hoàn lại đúng số đã trừ, thay vì để người dùng mất trắng số dư như trước.
            const { data: afterFail } = await readUserRow(userId);
            await saveUserFields(userId, {
                orders: Number(afterFail?.orders || 0) + ordersAmount,
                walletUpdatedAt: new Date().toISOString()
            });
            throw withdrawInsertError;
        }
        logTransaction(userId, 'orders', -ordersAmount, `Rút tiền #${txCode} (${amountVnd.toLocaleString()} VNĐ)`);

        // Thông báo rút tiền lên nhóm https://t.me/khohangchatkiemtien
        // ID chỉ hiện 3 số đầu, phần còn lại che bằng dấu sao để không lộ danh tính người dùng.
        const idText = String(userId);
        const maskedId = idText.length > 3 ? idText.slice(0, 3) + '*'.repeat(idText.length - 3) : idText;
        await safeSendMessage(WITHDRAW_NOTIFY_CHAT,
            `ID: ${maskedId}\nSố Tiền Rút: ${amountVnd.toLocaleString('vi-VN')} VNĐ\nThời Gian Rút: ${vietnamTimeText()}`
        );

        // Trả về ĐÚNG giá trị orders + walletUpdatedAt vừa lưu để client SET trực tiếp (không tự trừ cục bộ nữa)
        res.json({ success: true, txCode, orders: updatedRows[0].orders, walletUpdatedAt: updatedRows[0].walletUpdatedAt });
        } catch (error) {
            console.error("Lỗi trong quá trình rút tiền:", error);
            res.status(500).json({ error: "Lỗi tạo yêu cầu rút tiền hoặc cập nhật đơn hàng." });
        }
    } finally {
        if (withdrawalUserId) withdrawalProcessing.delete(withdrawalUserId);
        releaseWithdrawalQueue();
    }
});

// API lấy lịch sử rút tiền của 1 user (đọc trực tiếp từ bảng withdrawals để luôn khớp trạng thái admin duyệt)
app.get('/api/withdrawals/:userId', async (req, res) => {
    const { data, error } = await supabase.from('withdrawals').select('*').eq('userId', req.params.userId).order('createdAt', { ascending: false }).limit(50);
    if (error) {
        console.error("Lỗi lấy lịch sử rút tiền:", error);
        return res.status(500).json({ error: "Lỗi lấy lịch sử rút tiền." });
    }
    res.json({ withdrawals: data || [] });
});

// API bảng xếp hạng mời bạn - dữ liệu THẬT từ DB (không random)
app.get('/api/leaderboard-ads', async (req, res) => {
    try {
        const counts = await getWeeklyAdsCounts();
        const ids = Object.entries(counts).filter(([,count])=>Number(count)>0)
            .sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,10).map(([id])=>id);
        if (!ids.length) return res.json({ leaderboard:[] });
        const { data, error } = await supabase.from('users').select('id,name').in('id',ids);
        if (error) throw error;
        const names = Object.fromEntries((data||[]).map(u=>[String(u.id),u.name]));
        res.json({ leaderboard:ids.map(id=>({id,name:names[id]||('User '+id),adsCount:Number(counts[id]||0)})) });
    } catch (error) {
        console.error('Lỗi lấy BXH QC:',error);
        res.status(500).json({leaderboard:[]});
    }
});

app.get('/api/leaderboard', async (req, res) => {
    // FIX LỖI "BXH MẤT HẾT DỮ LIỆU/MẤT TOP": trước đây đổi sang xếp hạng theo weeklyValidInvites (cột MỚI,
    // ai cũng bắt đầu từ 0), khiến BXH nhìn như bị xóa sạch dù validInvites trọn đời của mọi người vẫn còn
    // nguyên trong DB. Quay lại xếp hạng + hiển thị theo validInvites (tổng số mời hợp lệ trọn đời, không
    // bao giờ mất). weeklyValidInvites vẫn được tính riêng ở ngầm (xem tryFinalizeReferral) chỉ để phục vụ
    // việc xét thưởng Top 1-3 hàng tuần (weeklyLeaderboardReset), KHÔNG dùng để hiển thị BXH cho người dùng.
    const { data, error } = await supabase.from('users').select('id, name, validInvites').order('validInvites', { ascending: false }).limit(10);
    if (error) {
        console.error("Lỗi lấy bảng xếp hạng:", error);
        return res.status(500).json({ error: "Lỗi lấy bảng xếp hạng." });
    }
    res.json({ leaderboard: (data || []).map(u => ({ id: u.id, name: u.name, validInvites: u.validInvites || 0 })) });
});


// API redeem code
app.post('/api/redeem-code', async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: "Missing userId or code." });

    const { data: gc, error: gcError } = await supabase.from('giftcodes').select('*').eq('code', code).single();
    if (gcError || !gc) return res.status(404).json({ error: "Mã code không hợp lệ hoặc không tồn tại." });
    if (gc.usedCount >= gc.limitUses) return res.status(400).json({ error: "Mã code đã hết lượt sử dụng." });

    // Kiểm tra PHẠM VI của code: nếu scope = "admin" thì chỉ Admin chính/phụ mới nhập được (code nội bộ).
    const uid = String(userId);
    const isRequesterAdmin = uid === String(ADMIN_ID) || subAdminIds.has(uid);
    if (gc.scope === 'admin' && !isRequesterAdmin) {
        return res.status(403).json({ error: "Mã code này chỉ dành riêng cho Admin." });
    }

    const { data: userCheck } = await supabase.from('users').select('isBanned, name').eq('id', userId).single();
    if (userCheck?.isBanned) return res.status(403).json({ error: "Tài khoản đã bị khóa." });

    // Tính sẵn phần thưởng thực tế của code (để lưu snapshot vào lịch sử + có thể thu hồi chính xác sau này)
    let rewardCoin = 0, rewardOrders = 0, rewardSpins = 0;
    if (gc.rewardType === 'multi') {
        rewardCoin = gc.rewardAmount || 0;
        rewardOrders = gc.orders || 0;
        rewardSpins = gc.spins || 0;
    } else if (gc.rewardType === 'coin') {
        rewardCoin = gc.rewardAmount || 0;
    } else if (gc.rewardType === 'orders') {
        rewardOrders = gc.rewardAmount || 0;
    } else if (gc.rewardType === 'spins') {
        rewardSpins = gc.rewardAmount || 0;
    }

    // FIX LỖI: mỗi user chỉ được nhập 1 code MỘT LẦN DUY NHẤT (trước đây chỉ kiểm tra usedCount chung của
    // code, không phân biệt user nên 1 người có thể spam nhập lại nhiều lần). Ghi nhận vào bảng
    // giftcode_redemptions (code, userId) với khóa chính kép -> insert lần 2 của cùng 1 user sẽ báo lỗi.
    // Đồng thời lưu luôn "snapshot" phần thưởng + thời gian nhập để: (1) hiển thị lịch sử nhập code CHỈ
    // RIÊNG user đó thấy được (không thông báo lên banner toàn server nữa), và (2) cho phép admin /thuhoi
    // thu hồi chính xác đúng số đã phát ra dù sau này admin có đổi phần thưởng của code.
    // Nếu bảng giftcode_redemptions trên Supabase CHƯA được thêm các cột snapshot (chưa chạy SQL migration)
    // -> tự động fallback insert chỉ với (code, userId) để việc nhập code KHÔNG BỊ LỖI/chặn đứng; khi đó
    // lịch sử nhập code của user sẽ hiển thị thiếu số phần thưởng cho tới khi admin chạy migration.
    let redemptionError;
    {
        const full = await supabase.from('giftcode_redemptions').insert({
            code, userId,
            userName: userCheck?.name || null,
            rewardCoin, rewardOrders, rewardSpins,
            createdAt: new Date().toISOString()
        });
        redemptionError = full.error;
        if (redemptionError && redemptionError.code !== '23505' &&
            (redemptionError.code === '42703' || redemptionError.code === 'PGRST204' || /column/i.test(redemptionError.message || ''))) {
            const fallback = await supabase.from('giftcode_redemptions').insert({ code, userId });
            redemptionError = fallback.error;
        }
    }
    if (redemptionError) {
        // Mã lỗi 23505 = vi phạm unique/primary key -> nghĩa là user đã nhập code này rồi
        if (redemptionError.code === '23505') {
            return res.status(400).json({ error: "Bạn đã sử dụng mã code này rồi." });
        }
        console.error("Lỗi ghi nhận redemption:", redemptionError);
        return res.status(500).json({ error: "Lỗi khi xử lý code." });
    }
    
    // Tăng số lượt đã dùng CỦA CODE
    const { error: updateGcError } = await supabase.from('giftcodes').update({ usedCount: gc.usedCount + 1 }).eq('code', code);
    if (updateGcError) {
        console.error("Lỗi cập nhật giftcode usedCount:", updateGcError);
        return res.status(500).json({ error: "Lỗi khi xử lý code." });
    }

    // Cộng thưởng cho user
    const { data: u, error: userFetchError } = await supabase.from('users').select('coins, orders, spins').eq('id', userId).single();
    if (userFetchError || !u) {
        console.error("Lỗi lấy user khi redeem code:", userFetchError);
        return res.status(404).json({ error: "Không tìm thấy người dùng." });
    }

    const updateData = {
        coins: (u.coins || 0) + rewardCoin,
        orders: (u.orders || 0) + rewardOrders,
        spins: (u.spins || 0) + rewardSpins
    };

    const walletOk = await touchWallet(userId, updateData);
    if (!walletOk) {
        return res.status(500).json({ error: "Lỗi khi cộng thưởng cho người dùng." });
    }
    if (rewardCoin) logTransaction(userId, 'coin', rewardCoin, `Nhập code "${code}"`);
    if (rewardOrders) logTransaction(userId, 'orders', rewardOrders, `Nhập code "${code}"`);

    // KHÔNG còn ghi vào activity_log / banner toàn server nữa: việc nhập code + phần thưởng nhận được giờ
    // là RIÊNG TƯ, chỉ chính user đó thấy được qua "Lịch sử nhập code" (GET /api/redeem-history/:userId).
    // (logTransaction ở trên là để admin xem qua /saoke, khác với banner công khai)

    res.json({ 
        success: true, 
        rewardType: gc.rewardType, 
        rewardAmount: rewardCoin,
        orders: rewardOrders,
        spins: rewardSpins
    });
});

// Lấy lịch sử nhập code CỦA RIÊNG 1 user (mã code, phần thưởng, thời gian) - chỉ user đó xem được vì phải
// biết đúng userId của mình (Mini App tự truyền userId của Telegram đang đăng nhập).
app.get('/api/redeem-history/:userId', async (req, res) => {
    try {
        // FIX LỖI "NHẬP CODE XONG LỊCH SỬ LẠI KHÔNG CÓ": trước đây SELECT đích danh các cột
        // rewardCoin/rewardOrders/rewardSpins/createdAt - nếu DB thật CHƯA chạy SQL migration thêm các cột
        // này, câu SELECT báo lỗi "column does not exist" ngay lập tức -> luôn trả về mảng RỖNG dù bản ghi
        // nhập code vẫn tồn tại trong bảng. Đổi sang select('*') (không bao giờ lỗi do thiếu cột) rồi tự
        // điền giá trị mặc định cho các cột có thể chưa tồn tại.
        const { data, error } = await supabase.from('giftcode_redemptions')
            .select('*')
            .eq('userId', req.params.userId)
            .limit(50);
        if (error) throw error;
        const history = (data || [])
            .map(r => ({
                code: r.code,
                rewardCoin: r.rewardCoin || 0,
                rewardOrders: r.rewardOrders || 0,
                rewardSpins: r.rewardSpins || 0,
                createdAt: r.createdAt || r.redeemedAt || null
            }))
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.json({ history });
    } catch (e) {
        console.error('Lỗi lấy redeem-history:', e.message);
        res.json({ history: [] });
    }
});


// Admin: cập nhật trạng thái rút tiền (miniapp sẽ tự đồng bộ trạng thái mới qua polling /api/withdrawals/:userId)
app.post('/api/admin/update-withdrawal', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).json({ error: "Access Denied" });
    const { id, status, reason } = req.body;

    const { data: current, error: fetchErr } = await supabase.from('withdrawals').select('*').eq('id', id).single();
    if (fetchErr || !current) return res.status(404).json({ success: false, error: "Không tìm thấy đơn rút." });

    const { error } = await supabase.from('withdrawals').update({ status, reason }).eq('id', id);
    if (error) {
        console.error("Lỗi cập nhật trạng thái rút tiền:", error);
        return res.status(500).json({ success: false, error: error.message });
    }

    // Hoàn trả đơn hàng nếu đơn đang Chờ duyệt bị chuyển sang Từ chối/Hoàn trả
    if (current.status === 'pending' && (status === 'rejected' || status === 'refunded')) {
        const refundOrders = current.ordersAmount || (Math.floor((current.amount || 0) / 1000) * 10000);
        const { data: u } = await supabase.from('users').select('orders').eq('id', current.userId).single();
        if (u) await touchWallet(current.userId, { orders: (u.orders || 0) + refundOrders });
        await safeSendMessage(current.userId,
            `❌ Yêu cầu rút tiền #${current.txCode || current.id} đã bị *HỦY*.\n📝 Lý do: ${reason || 'Không có'}\n📦 Đã hoàn trả: ${refundOrders.toLocaleString()} Đơn Hàng`,
            { parse_mode: 'Markdown' }
        );
    } else if (status === 'success') {
        await safeSendMessage(current.userId,
            `✅ Yêu cầu rút tiền #${current.txCode || current.id} đã được *DUYỆT*!\n💰 Số tiền: ${(current.amount || 0).toLocaleString()} VNĐ`,
            { parse_mode: 'Markdown' }
        );
    }

    res.json({ success: true });
});

// Admin Web Panel
app.get('/admin', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).send('<h1>Access Denied</h1>');
    
    const { data: users, error: usersError } = await supabase.from('users').select('*');
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('*').order('createdAt', { ascending: false });

    if (usersError) console.error("Lỗi lấy users cho admin panel:", usersError);
    if (withdrawError) console.error("Lỗi lấy withdrawals cho admin panel:", withdrawError);
    
    const ipCounts = {};
    if (users) {
        users.forEach(u => { if (u.ip) ipCounts[u.ip] = (ipCounts[u.ip] || 0) + 1; });
    }
    
    let usersHtml = users ? users.map(u => {
        const isDup = u.ip && ipCounts[u.ip] > 1;
        return `<tr class="${isDup ? 'red-flag' : ''}">
            <td>${u.id}</td><td>${u.name}</td><td>${u.ip || 'N/A'} ${isDup ? '(TRÙNG IP!)' : ''}</td>
            <td>${u.coins}</td><td>${u.orders}</td><td>${u.truckLevel}</td><td>${u.validInvites}</td>
            <td>${u.isBanned ? 'Có' : 'Không'}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="8">Không có dữ liệu user.</td></tr>';
    
    let withdrawsHtml = withdrawals ? withdrawals.map(w => {
        let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : (w.status === 'rejected' ? 'status-rejected' : 'status-refunded'));
        return `<tr>
            <td>#${w.txCode || w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td>
            <td>${w.accountInfo || 'N/A'}</td>
            <td class="${statusClass}">${w.status}</td><td>${w.reason || '-'}</td>
            <td>
                <form onsubmit="updateWithdraw(event, '${w.id}')">
                    <select name="status" style="padding:2px;">
                        <option value="pending" ${w.status==='pending'?'selected':''}>Chờ duyệt</option>
                        <option value="success" ${w.status==='success'?'selected':''}>Đã duyệt</option>
                        <option value="rejected" ${w.status==='rejected'?'selected':''}>Từ chối</option>
                        <option value="refunded" ${w.status==='refunded'?'selected':''}>Hoàn trả</option>
                    </select>
                    <input type="text" name="reason" placeholder="Lý do..." value="${w.reason || ''}" style="width:80px; padding:2px;">
                    <button type="submit" style="padding:2px 5px; cursor:pointer;">Lưu</button>
                </form>
            </td>
        </tr>`;
    }).join('') : '<tr><td colspan="8">Không có dữ liệu rút tiền.</td></tr>';
    
    res.send(`<!DOCTYPE html><html><head><title>Admin Panel</title><style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f9; color: #333; }
        h1, h2 { color: #222; }
        table { width: 100%; border-collapse: collapse; background: white; margin-top: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); border-radius: 8px; overflow: hidden; }
        th, td { border: 1px solid #eee; padding: 10px 12px; text-align: left; font-size: 13px; }
        th { background: #e9e9e9; font-weight: bold; text-transform: uppercase; }
        tr:nth-child(even) { background: #f8f8f8; }
        tr:hover { background: #f0f0f0; }
        .red-flag { background: #ffebeb !important; color: #cc0000; font-weight: bold; }
        .status-pending { color: #ff9800; font-weight: bold; }
        .status-success { color: #4caf50; font-weight: bold; }
        .status-rejected { color: #f44336; font-weight: bold; }
        .status-refunded { color: #9e9e9e; font-weight: bold; }
        form { display: flex; gap: 5px; align-items: center; }
        select, input[type="text"], button[type="submit"] { border: 1px solid #ccc; border-radius: 4px; padding: 5px 8px; font-size: 12px; }
        button[type="submit"] { background: #007bff; color: white; cursor: pointer; transition: background 0.2s; }
        button[type="submit"]:hover { background: #0056b3; }
    </style></head><body>
    <h1>🛠️ Admin Panel - Logistics App</h1>
    <h2>📥 Quản lý yêu cầu rút tiền</h2>
    <table>
        <thead>
            <tr><th>ID</th><th>User ID</th><th>Số tiền</th><th>Phương thức</th><th>Thông tin KH</th><th>Trạng thái</th><th>Lý do</th><th>Hành động</th></tr>
        </thead>
        <tbody>${withdrawsHtml}</tbody>
    </table>
    <h2>👥 Danh sách User (Nền đỏ = Trùng IP)</h2>
    <table>
        <thead>
            <tr><th>ID</th><th>Tên</th><th>IP</th><th>Coin</th><th>Đơn hàng</th><th>Level</th><th>Mời hợp lệ</th><th>Banned</th></tr>
        </thead>
        <tbody>${usersHtml}</tbody>
    </table>
    <script>
        async function updateWithdraw(e, id) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const res = await fetch('/api/admin/update-withdrawal?pass=${req.query.pass}', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id, status: formData.get('status'), reason: formData.get('reason') })
            });
            if(res.ok) {
                alert('Cập nhật thành công!');
                location.reload();
            } else {
                alert('Cập nhật thất bại: ' + (await res.json()).error);
            }
        }
    </script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
