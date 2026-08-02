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
app.use(express.static(path.join(__dirname, 'public')));

// --- CẤU HÌNH ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_1_ID = parseInt(process.env.GROUP_1_ID); // Kênh thông báo
const GROUP_2_ID = parseInt(process.env.GROUP_2_ID); // Nhóm chat
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://logistics-bot-vyxa.onrender.com';

const bot = new Telegraf(BOT_TOKEN);
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

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
async function tryFinalizeReferral(userId) {
    const { data: userRecord, error: userError } = await supabase.from('users')
        .select('id, name, referrerId, referrerCounted, lifetimeAdsWatched, isBanned')
        .eq('id', userId).single();
    if (userError || !userRecord) return { ok: false, reason: 'user_not_found' };
    if (!userRecord.referrerId || userRecord.referrerId === userId) return { ok: false, reason: 'no_referrer' };
    if (userRecord.referrerCounted) return { ok: false, reason: 'already_counted' };
    if (userRecord.isBanned) return { ok: false, reason: 'banned' };

    const isMember = await checkUserMembership(userId);
    if (!isMember) return { ok: false, reason: 'not_member' };

    if ((userRecord.lifetimeAdsWatched || 0) < 3) return { ok: false, reason: 'not_enough_ads' };

    const { data: refUser, error: refError } = await supabase.from('users')
        .select('validInvites, referralMilestones, coins, orders').eq('id', userRecord.referrerId).single();
    if (refError || !refUser) return { ok: false, reason: 'referrer_not_found' };

    const newValid = (refUser.validInvites || 0) + 1;
    const INSTANT_REF_COINS = 1000;
    const INSTANT_REF_ORDERS = 2000;

    await touchWallet(userRecord.referrerId, {
        validInvites: newValid,
        coins: (refUser.coins || 0) + INSTANT_REF_COINS,
        orders: (refUser.orders || 0) + INSTANT_REF_ORDERS
    });
    // Đánh dấu người được mời đã tính hợp lệ (không thuộc nhóm field "ví" nên update thường, không cần touchWallet)
    await supabase.from('users').update({ referrerCounted: true }).eq('id', userId);

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
                walletUpdatedAt: new Date().toISOString() // Mốc thời gian admin sửa ví gần nhất, dùng để chống ghi đè dữ liệu
            };
            const { data: insertedUser, error: insertError } = await supabase.from('users').insert(newUser).select().single();
            if (insertError) {
                console.error("Lỗi tạo user mới:", insertError);
                return ctx.reply("⚠️ Có lỗi xảy ra khi tạo tài khoản, vui lòng thử lại sau!");
            }
            userRecord = insertedUser;
            
            // Tăng invitedCount cho người mời (chưa tính hợp lệ)
            if (referrerId && referrerId !== userId) { // Đảm bảo người mời không phải chính mình
                const { data: ref, error: refError } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
                if (ref && !refError) {
                    const newCount = (ref.invitedCount || 0) + 1;
                    await supabase.from('users').update({ invitedCount: newCount }).eq('id', referrerId);
                    // THÔNG BÁO RIÊNG CHO NGƯỜI MỜI (tên bạn + tiến độ)
                    const milestones = [5, 10, 20, 30, 50, 75, 100];
                    const nextMilestone = milestones.find(m => m > newCount) || 'Hoàn thành';
                    await safeSendMessage(referrerId, 
                        `🎉 Bạn vừa mời thành công: *${userName}*\n📊 Tổng số người đã mời: *${newCount}*\n🎯 Tiến độ đến mốc tiếp theo: ${newCount}/${nextMilestone}`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        } else {
            userRecord = existingUser;
            if (userRecord.isBanned) {
                return ctx.reply("❌ Tài khoản của bạn đã bị khóa. Liên hệ admin để được hỗ trợ.");
            }
        }

        // Kiểm tra tham gia nhóm
        const isMember = await checkUserMembership(userId);

        if (isMember) {
            // Nếu có referrer và chưa được đếm hợp lệ -> thử xác nhận (cần đủ nhóm + đủ 3 QC đã xem)
            await tryFinalizeReferral(userId);

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
            await tryFinalizeReferral(userId);
            
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

// /taocode - Tạo code (số đơn hàng + coin + mở rương + số lượt nhập)
bot.command('taocode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    // /taocode <mã> <coin> <orders> <spins> <limit>
    if (parts.length < 6) return ctx.reply("❌ Sử dụng: /taocode <mã> <coin> <orders> <spins> <giới_hạn>\nVí dụ: /taocode TET2024 500 1000 2 100");
    
    const [, code, coin, orders, spins, limit] = parts;
    const { error } = await supabase.from('giftcodes').insert({
        code: code,
        rewardType: 'multi',
        rewardAmount: parseInt(coin),
        orders: parseInt(orders),
        spins: parseInt(spins),
        limitUses: parseInt(limit),
        usedCount: 0
    });
    
    if (error) {
        console.error("Lỗi tạo code:", error);
        return ctx.reply("❌ Lỗi: Mã code đã tồn tại hoặc dữ liệu không hợp lệ.");
    }
    ctx.reply(`✅ Đã tạo code: \`${code}\`\n🪙 Coin: ${coin}\n📦 Đơn hàng: ${orders}\n🎡 Lượt mở rương: ${spins}\n🔢 Giới hạn: ${limit} lần`, { parse_mode: 'Markdown' });
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

// API kiểm tra tham gia nhóm từ frontend
app.get('/api/verify/:id', async (req, res) => {
    try {
        const isMember = await checkUserMembership(req.params.id);
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
        const result = await tryFinalizeReferral(req.params.id);
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

        // Thông báo yêu cầu rút tiền mới lên nhóm chat, che bớt STK/SĐT (chỉ hiện 2 số đầu, còn lại che bằng ****)
        const masked = accountNumber.length > 2 ? accountNumber.substring(0, 2) + '*'.repeat(Math.max(accountNumber.length - 2, 3)) : accountNumber;
        await safeSendMessage(GROUP_2_ID,
            `🔔 *Yêu cầu rút tiền mới:*\n🆔 ID: ${userId}\n💳 Phương Thức: ${methodLabel}\n📱 STK/SĐT: ${masked}\n👤 Chủ TK: ${accountName || 'Không có'}\n💰 Số Tiền: ${amountVnd.toLocaleString()} VNĐ\n📦 Đơn Hàng Đã Trừ: ${ordersAmount.toLocaleString()}`,
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

    const { data: userCheck } = await supabase.from('users').select('isBanned').eq('id', userId).single();
    if (userCheck?.isBanned) return res.status(403).json({ error: "Tài khoản đã bị khóa." });

    // FIX LỖI: mỗi user chỉ được nhập 1 code MỘT LẦN DUY NHẤT (trước đây chỉ kiểm tra usedCount chung của
    // code, không phân biệt user nên 1 người có thể spam nhập lại nhiều lần). Ghi nhận vào bảng
    // giftcode_redemptions (code, userId) với khóa chính kép -> insert lần 2 của cùng 1 user sẽ báo lỗi.
    const { error: redemptionError } = await supabase.from('giftcode_redemptions').insert({ code, userId });
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

    let updateData = { 
        coins: (u.coins || 0),
        orders: (u.orders || 0),
        spins: (u.spins || 0)
    };
    
    if (gc.rewardType === 'multi') {
        updateData.coins += (gc.rewardAmount || 0);
        updateData.orders += (gc.orders || 0);
        updateData.spins += (gc.spins || 0);
    } else if (gc.rewardType === 'coin') {
        updateData.coins += gc.rewardAmount;
    } else if (gc.rewardType === 'orders') {
        updateData.orders += gc.rewardAmount;
    } else if (gc.rewardType === 'spins') {
        updateData.spins += gc.rewardAmount;
    }
    
    const walletOk = await touchWallet(userId, updateData);
    if (!walletOk) {
        return res.status(500).json({ error: "Lỗi khi cộng thưởng cho người dùng." });
    }
    const { data: redeemUser } = await supabase.from('users').select('name').eq('id', userId).single();
    logActivity(`🎁 ${maskName(redeemUser?.name)} vừa nhập code "${code}" nhận thưởng`);

    res.json({ 
        success: true, 
        rewardType: gc.rewardType, 
        rewardAmount: gc.rewardAmount || 0,
        orders: gc.orders || 0,
        spins: gc.spins || 0
    });
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
