// server.js
const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

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
//    (để hiển thị lịch sử nhập code riêng tư của từng user và cho /thuhoi, /nhapcode hoạt động):
//    alter table giftcode_redemptions add column if not exists rewardCoin integer default 0;
//    alter table giftcode_redemptions add column if not exists rewardOrders integer default 0;
//    alter table giftcode_redemptions add column if not exists rewardSpins integer default 0;
//    alter table giftcode_redemptions add column if not exists userName text;
//    alter table giftcode_redemptions add column if not exists createdAt timestamptz default now();
// =======================================================================================================

// --- CẤU HÌNH ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_1_ID = parseInt(process.env.GROUP_1_ID); // Kênh thông báo
const GROUP_2_ID = parseInt(process.env.GROUP_2_ID); // Nhóm chat
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://logistics-bot-vyxa.onrender.com';

const bot = new Telegraf(BOT_TOKEN);

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
const isMainAdmin = (ctx) => ctx.from.id === ADMIN_ID;
// Admin (chính hoặc phụ): dùng cho hầu hết lệnh quản trị.
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID || subAdminIds.has(String(ctx.from.id));

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

// Che 1 phần tên user để đăng lên banner công khai mà không lộ danh tính đầy đủ (vd: "Nguyễn Văn A" -> "Ng***")
function maskName(name) {
    if (!name || typeof name !== 'string') return 'Người dùng';
    const clean = name.trim();
    if (clean.length <= 2) return clean + '***';
    return clean.slice(0, 2) + '***';
}

// Ghi lại 1 sự kiện THẬT (rút tiền được duyệt, trúng jackpot, mời bạn thành công...) để hiển thị lên
// banner chạy chữ toàn server, thay vì dữ liệu bịa/hardcode như trước. Không chặn luồng chính nếu lỗi.
async function logActivity(message) {
    try {
        await supabase.from('activity_log').insert({ message });
    } catch (e) {
        console.error('Lỗi ghi activity_log:', e.message);
    }
}


// Frontend sẽ so sánh mốc này với mốc nó biết để tránh việc tự lưu game đè mất thay đổi của admin.
async function touchWallet(userId, extraFields = {}) {
    const { error } = await supabase.from('users').update({
        ...extraFields,
        walletUpdatedAt: new Date().toISOString()
    }).eq('id', userId);
    if (error) console.error(`Lỗi touchWallet ${userId}:`, error);
    return !error;
}

// Thử xác nhận 1 lượt mời bạn hợp lệ. Điều kiện đầy đủ:
// 1) Người được mời đã tham gia đủ nhóm Telegram bắt buộc
// 2) Người được mời đã xem tối thiểu 3 quảng cáo (lifetimeAdsWatched >= 3)
// 3) Chưa từng được tính hợp lệ trước đó (referrerCounted = false)
// Có thể được gọi từ nhiều nơi (bot /start, callback_query, API xem QC) nên hàm tự kiểm tra lại từ DB,
// không tin tưởng dữ liệu client gửi lên.
async function tryFinalizeReferral(userId, precomputedIsMember = null) {
    const { data: userRecord, error: userError } = await supabase.from('users')
        .select('id, name, referrerId, referrerCounted, lifetimeAdsWatched, isBanned')
        .eq('id', userId).single();
    if (userError || !userRecord) return { ok: false, reason: 'user_not_found' };
    if (!userRecord.referrerId || userRecord.referrerId === userId) return { ok: false, reason: 'no_referrer' };
    if (userRecord.referrerCounted) return { ok: false, reason: 'already_counted' };
    if (userRecord.isBanned) return { ok: false, reason: 'banned' };

    const isMember = precomputedIsMember !== null ? precomputedIsMember : await checkUserMembership(userId);
    if (!isMember) return { ok: false, reason: 'not_member' };

    if ((userRecord.lifetimeAdsWatched || 0) < 3) return { ok: false, reason: 'not_enough_ads' };

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

    const { data: refUser, error: refError } = await supabase.from('users')
        .select('validInvites, invitedCount, referralMilestones, coins, orders').eq('id', userRecord.referrerId).single();
    if (refError || !refUser) {
        // Đã claim (referrerCounted=true) nhưng không cộng thưởng được -> hoàn tác claim để không mất
        // vĩnh viễn lượt hợp lệ này, cho phép hệ thống tự thử lại ở lần gọi tiếp theo.
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId);
        return { ok: false, reason: 'referrer_not_found' };
    }

    const INSTANT_REF_COINS = 1000;
    const INSTANT_REF_ORDERS = 2000;

    // FIX LỖI "SỐ BẠN HỢP LỆ CAO HƠN SỐ BẠN ĐÃ MỜI": tăng validInvites bằng atomicIncrement (thay vì
    // đọc-rồi-ghi) để không bị mất lượt tăng khi nhiều referral của CÙNG 1 người mời hoàn tất gần như
    // đồng thời. Đồng thời chốt chặn an toàn: validInvites không bao giờ được vượt quá invitedCount
    // (về logic không thể có nhiều bạn "hợp lệ" hơn số bạn thực tế đã mời).
    const newValid = await atomicIncrement(userRecord.referrerId, 'validInvites', 1);
    if (newValid === null) {
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId);
        return { ok: false, reason: 'update_failed' };
    }
    if (newValid > (refUser.invitedCount || 0)) {
        // Dữ liệu invitedCount cũ (trước khi vá lỗi) có thể vẫn còn thấp hơn thực tế -> tự sửa lại cho khớp
        await supabase.from('users').update({ invitedCount: newValid }).eq('id', userRecord.referrerId);
    }

    await touchWallet(userRecord.referrerId, {
        coins: (refUser.coins || 0) + INSTANT_REF_COINS,
        orders: (refUser.orders || 0) + INSTANT_REF_ORDERS
    });

    const milestonesData = refUser.referralMilestones ? JSON.parse(refUser.referralMilestones) : [];
    const nextMilestone = milestonesData.find(m => m.friends > newValid);
    const progressText = nextMilestone
        ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn (Phần thưởng mốc: ${nextMilestone.reward})`
        : '🏆 Đã đạt tất cả các mốc!';

    await safeSendMessage(userRecord.referrerId,
        `✅ *Xác nhận hợp lệ!* ${userRecord.name} đã tham gia đủ nhóm và xem đủ QC.\n🎁 Nhận ngay: *+${INSTANT_REF_COINS.toLocaleString()} Coin + ${INSTANT_REF_ORDERS.toLocaleString()} Đơn Hàng*\n📊 Tổng hợp lệ: *${newValid}*\n${progressText}`,
        { parse_mode: 'Markdown' }
    );
    const { data: referrerInfo } = await supabase.from('users').select('name').eq('id', userRecord.referrerId).single();
    logActivity(`👥 ${maskName(referrerInfo?.name)} vừa mời bạn thành công, nhận ${INSTANT_REF_COINS.toLocaleString()} Coin + ${INSTANT_REF_ORDERS.toLocaleString()} Đơn Hàng`);

    return { ok: true, validInvites: newValid };
}

// ==================== BOT LOGIC ====================

// Middleware chặn TOÀN BỘ tương tác của user thường khi bot đang bị khoá bảo trì (admin vẫn dùng được
// bình thường để có thể tự /mokhoabot mở lại). Đặt TRƯỚC mọi lệnh/handler khác để chặn sớm nhất.
bot.use(async (ctx, next) => {
    if (BOT_LOCKED && !isAdmin(ctx)) {
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
bot.command('listadmins', async (ctx) => {
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
                    { friends: 5, reward: '1,000 Coin + 500 Đơn Hàng', coins: 1000, orders: 500, spins: 0, claimed: false },
                    { friends: 10, reward: '1,500 Coin + 2 Lượt Mở Rương', coins: 1500, orders: 0, spins: 2, claimed: false },
                    { friends: 20, reward: '2,000 Coin + 1,500 Đơn Hàng', coins: 2000, orders: 1500, spins: 0, claimed: false },
                    { friends: 30, reward: '5,000 Đơn Hàng + 2 Lượt Mở Rương', coins: 0, orders: 5000, spins: 2, claimed: false },
                    { friends: 50, reward: '5,000 Coin + 7,000 Đơn Hàng', coins: 5000, orders: 7000, spins: 0, claimed: false },
                    { friends: 75, reward: '10,000 Đơn Hàng + 5 Lượt Mở Rương', coins: 0, orders: 10000, spins: 5, claimed: false },
                    { friends: 100, reward: '20,000 Đơn Hàng + 10 Lượt Mở Rương', coins: 0, orders: 20000, spins: 10, claimed: false }
                ]),
                isBanned: false,
                referrerCounted: false, // Thêm trường này để kiểm soát việc đã đếm hợp lệ cho người mời hay chưa
                lifetimeAdsWatched: 0, // Tổng số QC đã xem trọn đời (không reset theo ngày) - điều kiện xét mời bạn hợp lệ
                bonusAdsToday: 0, // Số lần đã xem QC nhiệm vụ "Xem QC" hôm nay (tối đa 30)
                chestOpensTotal: 0, // Tổng số lượt đã mở rương (trọn đời) - dùng cho /checkID
                chestOpensToday: 0, // Số lượt đã mở rương hôm nay - dùng cho /checkID, reset mỗi ngày
                walletUpdatedAt: new Date().toISOString() // Mốc thời gian admin sửa ví gần nhất, dùng để chống ghi đè dữ liệu
            };
            const { data: insertedUser, error: insertError } = await supabase.from('users').insert(newUser).select().single();
            if (insertError) {
                console.error("Lỗi tạo user mới:", insertError);
                return ctx.reply("⚠️ Có lỗi xảy ra khi tạo tài khoản, vui lòng thử lại sau!");
            }
            userRecord = insertedUser;
            
            // Tăng invitedCount cho người mời (chưa tính hợp lệ)
            // Dùng atomicIncrement thay vì đọc-rồi-ghi để không bị "mất lượt mời" khi nhiều người cùng
            // vào bằng chung 1 link giới thiệu gần như đồng thời (xem giải thích chi tiết ở atomicIncrement).
            if (referrerId && referrerId !== userId) { // Đảm bảo người mời không phải chính mình
                const newCount = await atomicIncrement(referrerId, 'invitedCount', 1);
                if (newCount !== null) {
                    // FIX: trước đây thông báo ghi "🎉 Bạn vừa mời thành công" ngay khi bạn bè chỉ mới BẤM
                    // VÀO LINK (chưa tham gia đủ nhóm, chưa xem QC nào) khiến người mời hiểu lầm là đã nhận
                    // thưởng. Đổi thành thông báo trung thực: chỉ báo có người vào bằng link, CHƯA thành
                    // công, kèm nhắc nhở đúng 2 điều kiện cần hoàn tất. Thưởng + thông báo "thành công" thật
                    // sự chỉ được gửi trong tryFinalizeReferral() khi bạn bè ĐÃ đủ điều kiện.
                    await safeSendMessage(referrerId, 
                        `👋 *${userName}* vừa vào Mini App bằng link giới thiệu của bạn!\n⚠️ Lượt mời này *CHƯA được tính thành công*.\n📋 Hãy nhắc bạn ấy hoàn tất 2 điều kiện sau để bạn nhận được thưởng mời bạn:\n1️⃣ Tham gia đầy đủ nhóm Telegram bắt buộc\n2️⃣ Xem ít nhất 3 quảng cáo trong Mini App (ngoại trừ SmartLink)\n\n✅ Khi bạn ấy hoàn tất, bot sẽ tự động thông báo cho bạn kèm phần thưởng.`,
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
bot.on('callback_query', async (ctx) => {
    if (ctx.callbackQuery.data === 'check_groups') {
        const userId = ctx.from.id.toString();
        const userName = ctx.from.first_name || 'User';
        
        await ctx.answerCbQuery("🔍 Đang kiểm tra...");
        
        const isMember = await checkUserMembership(userId);
        
        if (isMember) {
            const { data: userRecord, error: userError } = await supabase.from('users').select('*').eq('id', userId).single();
            if (userError) {
                console.error("Lỗi lấy user trong callback:", userError);
                return ctx.editMessageText("⚠️ Có lỗi xảy ra, vui lòng thử lại sau!");
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
    ctx.reply(`✅ Đã cộng ${amount} đơn hàng cho ${targetId}`);
});

// /setlevel
bot.command('setlevel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /setlevel <userId> <cấp_độ>");
    const targetId = parts[1];
    const level = parseInt(parts[2]);
    if (level < 1 || level > 10) return ctx.reply("❌ Cấp độ phải từ 1-10");
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
        lastResetDate: new Date(new Date().setDate(new Date().getDate() - 1)).toDateString() // Đặt ngày reset về hôm qua để kích hoạt reset khi mini app load
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
        chestOpensTotal: 0,
        chestOpensToday: 0,
        lifetimeAdsWatched: 0,
        invitedCount: 0,
        validInvites: 0,
        deliveryCount: 0,
        referralMilestones: JSON.stringify([
            { friends: 5, reward: '1,000 Coin + 500 Đơn Hàng', coins: 1000, orders: 500, spins: 0, claimed: false },
            { friends: 10, reward: '1,500 Coin + 2 Lượt Mở Rương', coins: 1500, orders: 0, spins: 2, claimed: false },
            { friends: 20, reward: '2,000 Coin + 1,500 Đơn Hàng', coins: 2000, orders: 1500, spins: 0, claimed: false },
            { friends: 30, reward: '5,000 Đơn Hàng + 2 Lượt Mở Rương', coins: 0, orders: 5000, spins: 2, claimed: false },
            { friends: 50, reward: '5,000 Coin + 7,000 Đơn Hàng', coins: 5000, orders: 7000, spins: 0, claimed: false },
            { friends: 75, reward: '10,000 Đơn Hàng + 5 Lượt Mở Rương', coins: 0, orders: 10000, spins: 5, claimed: false },
            { friends: 100, reward: '20,000 Đơn Hàng + 10 Lượt Mở Rương', coins: 0, orders: 20000, spins: 10, claimed: false }
        ]),
        lastResetDate: new Date(new Date().setDate(new Date().getDate() - 1)).toDateString()
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
    await resetGiftcodeRedemptions(targetId); // Cho phép user nhập lại các code đã nhập trước khi reset
    if (ok) ctx.reply(`✅ Đã reset toàn bộ dữ liệu của user ${targetId} về 0 (kể cả lịch sử nhập code).`);
    else ctx.reply(`❌ Lỗi khi reset dữ liệu user ${targetId}.`);
});

// /resetall - Reset TOÀN BỘ dữ liệu của TẤT CẢ user về 0
bot.command('resetall', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { error } = await supabase.from('users').update({
        ...fullResetFields(),
        walletUpdatedAt: new Date().toISOString()
    }).not('id', 'is', null);
    if (error) {
        console.error("Lỗi /resetall:", error);
        return ctx.reply("❌ Lỗi khi reset toàn bộ dữ liệu: " + error.message);
    }
    await resetGiftcodeRedemptions(null); // Cho phép TẤT CẢ user nhập lại các code đã nhập trước khi reset
    ctx.reply(`✅ Đã reset toàn bộ dữ liệu của TẤT CẢ user về 0 (kể cả lịch sử nhập code).`);
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
    const { error } = await supabase.from('giftcodes').insert({
        code: code,
        rewardType: 'multi',
        rewardAmount: parseInt(coin) || 0,
        orders: parseInt(orders) || 0,
        spins: parseInt(spins) || 0,
        limitUses: parseInt(limit) || 0,
        usedCount: 0,
        scope: scope,
        createdBy: String(ctx.from.id)
    });

    if (error) {
        console.error("Lỗi tạo code:", error);
        return ctx.reply("❌ Lỗi: Mã code đã tồn tại hoặc dữ liệu không hợp lệ (kiểm tra đã thêm cột \"scope\"/\"createdBy\" vào bảng giftcodes chưa).");
    }
    ctx.reply(`✅ Đã tạo code: \`${code}\`\n🪙 Coin: ${coin}\n📦 Đơn hàng: ${orders}\n🎡 Lượt mở rương: ${spins}\n🔢 Giới hạn: ${limit} lần\n🔒 Phạm vi: *${scope === 'admin' ? 'Chỉ Admin' : 'Người dùng'}*`, { parse_mode: 'Markdown' });
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

// /nhapcode <mã> - Xem TẤT CẢ người dùng đã nhập 1 mã code cụ thể (ID, tên, phần thưởng nhận, thời gian)
bot.command('nhapcode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("❌ Sử dụng: /nhapcode <mã_code>");

    const { data: redemptions, error } = await supabase.from('giftcode_redemptions')
        .select('*').eq('code', code).order('createdAt', { ascending: false });
    if (error) {
        console.error("Lỗi lấy danh sách người nhập code:", error);
        return ctx.reply("❌ Lỗi khi lấy dữ liệu (kiểm tra đã thêm cột \"createdAt\" vào bảng giftcode_redemptions chưa).");
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

    const { data: approvedUser } = await supabase.from('users').select('name').eq('id', targetId).single();
    logActivity(`🚛 ${maskName(approvedUser?.name)} vừa rút thành công ${totalApprovedAmount.toLocaleString()} VNĐ`);
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
    
    // Telegram message limit is 4096 characters for Markdown
    if (msg.length > 4000) {
        msg = msg.substring(0, 4000) + "\n... (tin nhắn quá dài, hãy kiểm tra trên web admin hoặc lấy thêm chi tiết từng đơn)";
    }
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /broadcast
bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.substring(11).trim(); // Bỏ '/broadcast '
    if (!msg) return ctx.reply("❌ Nhập tin nhắn cần gửi!");
    
    ctx.reply("⏳ Đang gửi tin nhắn...");
    const { data: users, error } = await supabase.from('users').select('id');
    if (error) {
        console.error("Lỗi lấy danh sách user để broadcast:", error);
        return ctx.reply("❌ Lỗi database khi lấy danh sách người dùng.");
    }

    let successCount = 0;
    
    for (const u of users) {
        const sent = await safeSendMessage(u.id, `📢 *THÔNG BÁO TỪ ADMIN:*\n\n${msg}`, { parse_mode: 'Markdown' });
        if (sent) successCount++;
        await new Promise(r => setTimeout(r, 50)); // Giới hạn tốc độ gửi
    }
    ctx.reply(`✅ Đã gửi thành công đến ${successCount}/${users.length} người dùng.`);
});

// Khởi động bot ở chế độ long-polling. QUAN TRỌNG: bot.launch() trả về 1 Promise - nếu không bắt lỗi
// (ví dụ lỗi 409 Conflict do phiên bản deploy cũ vẫn còn đang polling khi Render tạo instance mới),
// Promise sẽ bị reject mà không ai xử lý -> Node coi là "unhandledRejection" và THOÁT TIẾN TRÌNH với mã lỗi 1
// (đây chính là nguyên nhân phổ biến khiến deploy trên Render báo "Exited with status 1" dù code không có lỗi cú pháp).
bot.launch()
    .then(() => console.log("✅ Bot is running..."))
    .catch((err) => {
        console.error("❌ Lỗi khởi động bot (server vẫn tiếp tục chạy để phục vụ API/Web):", err.message);
    });

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
    res.json({ locked: BOT_LOCKED, message: MAINTENANCE_MESSAGE });
});

// Chặn toàn bộ API của Mini App khi bot đang bị khoá bảo trì (trừ chính API kiểm tra khoá ở trên và
// các API dành cho Admin, để Admin vẫn thao tác được qua web /admin trong lúc bảo trì).
app.use('/api', (req, res, next) => {
    if (BOT_LOCKED && req.path !== '/lock-status' && !req.path.startsWith('/admin')) {
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

    const { data: userBeforeUpdate, error: fetchError } = await supabase.from('users').select('ip, name').eq('id', req.params.id).single();
    if (fetchError || !userBeforeUpdate) {
        console.error("Lỗi lấy user để lưu IP:", fetchError);
        return res.status(404).json({ success: false, error: "User not found" });
    }

    // Chỉ cập nhật IP nếu nó thay đổi
    if (userBeforeUpdate.ip !== ip) {
        const { error: updateError } = await supabase.from('users').update({ ip }).eq('id', req.params.id);
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

// API lấy user
app.get('/api/user/:id', async (req, res) => {
    const { data, error } = await supabase.from('users').select('*').eq('id', req.params.id).single();
    if (error || !data) {
        if (error?.code === 'PGRST116') { // Not Found
            return res.status(404).json({ error: "User not found" });
        }
        console.error("Lỗi lấy user:", error);
        return res.status(500).json({ error: "Failed to fetch user data" });
    }
    // Parse referralMilestones if stored as JSON string
    if (data.referralMilestones && typeof data.referralMilestones === 'string') {
        data.referralMilestones = JSON.parse(data.referralMilestones);
    }
    res.json(data);
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
const WALLET_FIELDS = [...new Set([...Object.keys(fullResetFields()), 'isBanned'])];
app.post('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const { clientWalletSyncedAt, ...body } = req.body;
        let updateData = { ...body };

        // Handle referralMilestones as JSON string
        if (updateData.referralMilestones) {
            updateData.referralMilestones = JSON.stringify(updateData.referralMilestones);
        }

        const { data: current, error: currentError } = await supabase.from('users')
            .select(['walletUpdatedAt', ...WALLET_FIELDS].join(', ')).eq('id', userId).single();
        if (currentError || !current) {
            console.error(`Lỗi lấy user hiện tại ${userId}:`, currentError);
            return res.status(404).json({ success: false, error: "User not found" });
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

        const { error } = await supabase.from('users').update(updateData).eq('id', userId);
        if (error) {
            console.error(`Lỗi cập nhật user ${userId}:`, error);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (walletOverridden) {
            // Trả về giá trị mới nhất từ DB cho TOÀN BỘ field được bảo vệ để client tự đồng bộ lại, tránh mất thay đổi của admin
            const { data: fresh } = await supabase.from('users')
                .select([...WALLET_FIELDS, 'walletUpdatedAt'].join(', ')).eq('id', userId).single();
            if (fresh && fresh.referralMilestones && typeof fresh.referralMilestones === 'string') {
                fresh.referralMilestones = JSON.parse(fresh.referralMilestones);
            }
            return res.json({ success: true, walletOverridden: true, wallet: fresh });
        }

        res.json({ success: true, walletOverridden: false, walletUpdatedAt: updateData.walletUpdatedAt });
    } catch (e) {
        console.error("Lỗi API cập nhật user:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API kiểm tra và xác nhận mời bạn hợp lệ (gọi từ frontend mỗi khi user xem QC)
app.post('/api/check-referral/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // FIX LỖI "BẠN BÈ ĐÃ ĐỦ ĐIỀU KIỆN NHƯNG KHÔNG ĐƯỢC CỘNG THƯỞNG": trước đây API này chỉ đọc
        // lifetimeAdsWatched TRỰC TIẾP TỪ DB. Nhưng phía client, ngay sau khi xem xong 1 QC, gọi
        // saveState() (lưu lifetimeAdsWatched mới lên DB) và gọi API này CÙNG LÚC, không chờ cái nào lưu
        // xong trước -> rất nhiều trường hợp API check này chạy/đọc DB TRƯỚC KHI saveState() kịp lưu, nên
        // đọc phải giá trị lifetimeAdsWatched CŨ (vd 2 thay vì 3) -> bị đánh giá sai là "chưa đủ 3 QC" dù
        // thực tế người được mời đã xem đủ -> người mời không được cộng thưởng ở đúng thời điểm đủ điều
        // kiện. Nay cho phép client gửi kèm số QC hiện tại nó đang giữ, server đồng bộ luôn giá trị này
        // vào DB (chỉ cho phép TĂNG, không bao giờ giảm, và bỏ qua nếu admin vừa sửa ví sau lần client
        // đồng bộ gần nhất - dùng chung cơ chế walletUpdatedAt/clientWalletSyncedAt như API lưu user)
        // TRƯỚC khi chạy kiểm tra, đảm bảo điều kiện luôn được xét trên dữ liệu mới nhất.
        const clientAdsWatched = parseInt(req.body?.lifetimeAdsWatched);
        const clientWalletSyncedAt = req.body?.clientWalletSyncedAt;
        if (!isNaN(clientAdsWatched) && clientAdsWatched > 0) {
            const { data: cur } = await supabase.from('users')
                .select('lifetimeAdsWatched, walletUpdatedAt').eq('id', userId).single();
            if (cur) {
                const dbWalletTime = cur.walletUpdatedAt ? new Date(cur.walletUpdatedAt).getTime() : 0;
                const clientTime = clientWalletSyncedAt ? new Date(clientWalletSyncedAt).getTime() : 0;
                if (dbWalletTime <= clientTime && clientAdsWatched > (cur.lifetimeAdsWatched || 0)) {
                    await supabase.from('users').update({ lifetimeAdsWatched: clientAdsWatched }).eq('id', userId);
                }
            }
        }

        const result = await tryFinalizeReferral(userId);
        res.json(result);
    } catch (e) {
        console.error("Lỗi check-referral:", e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// API rút tiền - Hỗ trợ Ngân hàng / Momo / ZaloPay với các trường tách riêng
// (bankName, accountName, accountNumber cho ngân hàng; accountNumber = SĐT cho Momo/ZaloPay)
// LƯU Ý SCHEMA: bảng "withdrawals" trên Supabase cần có thêm các cột:
// ordersAmount (int8), bankName (text), accountName (text), accountNumber (text), txCode (int8)
app.post('/api/withdraw', async (req, res) => {
    const { userId, method, bankName, accountName, accountNumber, ordersAmount } = req.body;

    if (!userId || !method || !accountNumber || !ordersAmount) {
        return res.status(400).json({ error: "Vui lòng nhập đầy đủ thông tin rút tiền." });
    }
    if (ordersAmount < 20000) { // Mức rút tối thiểu: 20.000 Đơn Hàng (2.000 VNĐ)
        return res.status(400).json({ error: "Số đơn hàng rút tối thiểu là 20.000 Đơn Hàng (2.000 VNĐ)." });
    }
    if (method === 'bank' && (!bankName || !accountName)) {
        return res.status(400).json({ error: "Vui lòng nhập đầy đủ tên ngân hàng và tên chủ tài khoản." });
    }

    const { data: userData, error: userFetchError } = await supabase.from('users').select('orders, isBanned, name').eq('id', userId).single();
    if (userFetchError || !userData) {
        console.error("Lỗi lấy user khi rút tiền:", userFetchError);
        return res.status(404).json({ error: "User not found or database error." });
    }
    if (userData.isBanned) {
        return res.status(403).json({ error: "Tài khoản đã bị khóa." });
    }
    if (userData.orders < ordersAmount) {
        return res.status(400).json({ error: "Không đủ đơn hàng để rút số lượng này." });
    }

    // Tỉ lệ quy đổi: 20.000 Đơn Hàng = 2.000 VNĐ => 1 Đơn Hàng = 0,1 VNĐ
    const amountVnd = Math.floor(ordersAmount * 0.1);
    const newOrders = userData.orders - ordersAmount;
    const methodLabel = method === 'bank' ? (bankName || 'Ngân hàng') : (method === 'momo' ? 'Momo' : 'ZaloPay');
    const accountInfoText = method === 'bank' ? `${bankName} - ${accountName} - ${accountNumber}` : accountNumber;

    try {
        // Mã giao dịch tuần tự cho TOÀN BỘ bot (đơn rút thứ 1, 2, 3...)
        const { count } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true });
        const txCode = (count || 0) + 1;

        const { error: withdrawInsertError } = await supabase.from('withdrawals').insert({
            userId,
            amount: amountVnd,
            ordersAmount,
            method: methodLabel,
            bankName: bankName || null,
            accountName: accountName || null,
            accountNumber,
            accountInfo: accountInfoText,
            status: 'pending',
            txCode
        });
        if (withdrawInsertError) throw withdrawInsertError;

        const walletOk = await touchWallet(userId, { orders: newOrders });
        if (!walletOk) throw new Error("Không thể cập nhật số đơn hàng sau khi rút.");

        // Thông báo yêu cầu rút tiền mới lên nhóm chat, che bớt STK/SĐT và Chủ TK (chỉ hiện 2 ký tự đầu, còn lại che bằng ****)
        const maskText = (txt) => {
            const clean = (txt || '').toString().trim();
            if (!clean) return 'Không có';
            return clean.length > 2 ? clean.substring(0, 2) + '*'.repeat(Math.max(clean.length - 2, 3)) : clean + '***';
        };
        const masked = maskText(accountNumber);
        const maskedAccountName = maskText(accountName);
        await safeSendMessage(GROUP_2_ID,
            `🔔 *Yêu cầu rút tiền mới:*\n🆔 ID: ${userId}\n💳 Phương Thức: ${methodLabel}\n📱 STK/SĐT: ${masked}\n👤 Chủ TK: ${maskedAccountName}\n💰 Số Tiền: ${amountVnd.toLocaleString()} VNĐ\n📦 Đơn Hàng Đã Trừ: ${ordersAmount.toLocaleString()}`,
            { parse_mode: 'Markdown' }
        );

        res.json({ success: true, txCode });
    } catch (error) {
        console.error("Lỗi trong quá trình rút tiền:", error);
        res.status(500).json({ error: "Lỗi tạo yêu cầu rút tiền hoặc cập nhật đơn hàng." });
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
app.get('/api/leaderboard', async (req, res) => {
    const { data, error } = await supabase.from('users').select('id, name, validInvites').order('validInvites', { ascending: false }).limit(10);
    if (error) {
        console.error("Lỗi lấy bảng xếp hạng:", error);
        return res.status(500).json({ error: "Lỗi lấy bảng xếp hạng." });
    }
    res.json({ leaderboard: data || [] });
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
    const { error: redemptionError } = await supabase.from('giftcode_redemptions').insert({
        code, userId,
        userName: userCheck?.name || null,
        rewardCoin, rewardOrders, rewardSpins,
        createdAt: new Date().toISOString()
    });
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

    // KHÔNG còn ghi vào activity_log / banner toàn server nữa: việc nhập code + phần thưởng nhận được giờ
    // là RIÊNG TƯ, chỉ chính user đó thấy được qua "Lịch sử nhập code" (GET /api/redeem-history/:userId).

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
        const { data, error } = await supabase.from('giftcode_redemptions')
            .select('code, rewardCoin, rewardOrders, rewardSpins, createdAt')
            .eq('userId', req.params.userId)
            .order('createdAt', { ascending: false })
            .limit(50);
        if (error) throw error;
        res.json({ history: data || [] });
    } catch (e) {
        console.error('Lỗi lấy redeem-history:', e.message);
        res.json({ history: [] });
    }
});

// User vừa trúng Jackpot 100.000 Đơn Hàng khi mở rương -> ghi vào banner thật toàn server
app.post('/api/log-jackpot/:id', async (req, res) => {
    try {
        const { data: u } = await supabase.from('users').select('name, isBanned').eq('id', req.params.id).single();
        if (!u || u.isBanned) return res.json({ ok: false });
        logActivity(`💎 ${maskName(u.name)} vừa trúng JACKPOT 100.000 Đơn Hàng!`);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false });
    }
});

// Lấy danh sách hoạt động THẬT gần đây để hiển thị lên banner chạy chữ toàn server (thay vì dữ liệu ảo)
app.get('/api/activity-feed', async (req, res) => {
    try {
        const { data, error } = await supabase.from('activity_log')
            .select('message, createdAt').order('createdAt', { ascending: false }).limit(20);
        if (error) throw error;
        res.json({ messages: (data || []).map(d => d.message) });
    } catch (e) {
        console.error('Lỗi lấy activity-feed:', e.message);
        res.json({ messages: [] });
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
