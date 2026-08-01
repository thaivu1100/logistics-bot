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
const GROUP_1_ID = parseInt(process.env.GROUP_1_ID);
const GROUP_2_ID = parseInt(process.env.GROUP_2_ID);
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://logistics-bot-vyxa.onrender.com';

const bot = new Telegraf(BOT_TOKEN);
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

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
        const m1 = await bot.telegram.getChatMember(GROUP_1_ID, userId);
        const m2 = await bot.telegram.getChatMember(GROUP_2_ID, userId);
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

// ==================== BOT LOGIC ====================

// /start - Kiểm tra tham gia nhóm TRƯỚC khi cho vào miniapp
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    const referrerId = ctx.startPayload;

    try {
        // Tạo user mới nếu chưa có
        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
        
        if (!user) {
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
                referralMilestones: [],
                isBanned: false
            };
            await supabase.from('users').insert(newUser);
            
            // Tăng invitedCount cho người mời (chưa tính hợp lệ)
            if (referrerId) {
                const { data: ref } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
                if (ref) {
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
        } else if (user.isBanned) {
            return ctx.reply("❌ Tài khoản của bạn đã bị khóa. Liên hệ admin để được hỗ trợ.");
        }

        // Kiểm tra tham gia nhóm
        const isMember = await checkUserMembership(userId);

        if (isMember) {
            // Nếu có referrer và chưa được đếm hợp lệ -> đếm
            if (referrerId && !user.referrerCounted) {
                const { data: ref } = await supabase.from('users').select('validInvites, referralMilestones').eq('id', referrerId).single();
                if (ref) {
                    const newValid = (ref.validInvites || 0) + 1;
                    await supabase.from('users').update({ 
                        validInvites: newValid,
                        referrerCounted: true 
                    }).eq('id', userId);
                    
                    // Thông báo chi tiết cho người mời
                    const milestones = [
                        { friends: 5, reward: '1,000 Coin + 500 Đơn Hàng' },
                        { friends: 10, reward: '1,500 Coin + 2 Lượt Mở Rương' },
                        { friends: 20, reward: '2,000 Coin + 1,500 Đơn Hàng' },
                        { friends: 30, reward: '5,000 Đơn Hàng + 2 Lượt Mở Rương' },
                        { friends: 50, reward: '5,000 Coin + 7,000 Đơn Hàng' },
                        { friends: 75, reward: '10,000 Đơn Hàng + 5 Lượt Mở Rương' },
                        { friends: 100, reward: '20,000 Đơn Hàng + 10 Lượt Mở Rương' }
                    ];
                    
                    const nextMilestone = milestones.find(m => m.friends > newValid);
                    const progressText = nextMilestone 
                        ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn (Phần thưởng: ${nextMilestone.reward})`
                        : '🏆 Đã đạt tất cả các mốc!';
                    
                    await safeSendMessage(referrerId,
                        `✅ *Xác nhận hợp lệ!* ${userName} đã tham gia đủ nhóm.\n📊 Tổng hợp lệ: *${newValid}*\n${progressText}`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
            
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
                "1️⃣ https://t.me/khohangkiemtien\n" +
                "2️⃣ https://t.me/khohangchatkiemtien\n\n" +
                "Sau khi tham gia xong, nhấn nút *Xác Nhận* bên dưới để bot kiểm tra.",
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "1️⃣ Tham gia nhóm 1", url: "https://t.me/khohangkiemtien" }],
                            [{ text: "2️⃣ Tham gia nhóm 2", url: "https://t.me/khohangchatkiemtien" }],
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
            const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
            const referrerId = user?.referrerId;
            
            // Nếu có referrer và chưa được đếm hợp lệ
            if (referrerId && !user.referrerCounted) {
                const { data: ref } = await supabase.from('users').select('validInvites').eq('id', referrerId).single();
                if (ref) {
                    const newValid = (ref.validInvites || 0) + 1;
                    await supabase.from('users').update({ 
                        validInvites: newValid,
                        referrerCounted: true 
                    }).eq('id', userId);
                    
                    const milestones = [
                        { friends: 5, reward: '1,000 Coin + 500 Đơn Hàng' },
                        { friends: 10, reward: '1,500 Coin + 2 Lượt Mở Rương' },
                        { friends: 20, reward: '2,000 Coin + 1,500 Đơn Hàng' },
                        { friends: 30, reward: '5,000 Đơn Hàng + 2 Lượt Mở Rương' },
                        { friends: 50, reward: '5,000 Coin + 7,000 Đơn Hàng' },
                        { friends: 75, reward: '10,000 Đơn Hàng + 5 Lượt Mở Rương' },
                        { friends: 100, reward: '20,000 Đơn Hàng + 10 Lượt Mở Rương' }
                    ];
                    
                    const nextMilestone = milestones.find(m => m.friends > newValid);
                    const progressText = nextMilestone 
                        ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn (Phần thưởng: ${nextMilestone.reward})`
                        : '🏆 Đã đạt tất cả các mốc!';
                    
                    await safeSendMessage(referrerId,
                        `✅ *Xác nhận hợp lệ!* ${userName} đã tham gia đủ nhóm.\n📊 Tổng hợp lệ: *${newValid}*\n${progressText}`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
            
            await ctx.editMessageText(
                `Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`,
                {
                    reply_markup: { 
                        inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] 
                    }
                }
            );
        } else {
            await ctx.answerCbQuery("❌ Bạn vẫn chưa tham gia đủ 2 nhóm!");
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
    
    const totalAds = usersStats ? usersStats.reduce((sum, u) => sum + (u.adsToday || 0), 0) : 0;
    const totalSmartlinks = usersStats ? usersStats.reduce((sum, u) => sum + (u.smartlinksToday || 0), 0) : 0;
    const totalPending = pendingWithdraws ? pendingWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalSuccess = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalRejected = rejectedWithdraws ? rejectedWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    
    ctx.reply(
        `📊 *THỐNG KÊ CHI TIẾT*\n\n` +
        `👥 Tổng User: *${totalUsers || 0}*\n` +
        `📺 Tổng QC đã xem (hôm nay): *${totalAds}*\n` +
        `🔗 Tổng Smartlink đã ấn (hôm nay): *${totalSmartlinks}*\n\n` +
        `💰 *TÀI CHÍNH:*\n` +
        `⏳ Chờ duyệt: *${totalPending.toLocaleString()} VNĐ*\n` +
        `✅ Đã duyệt: *${totalSuccess.toLocaleString()} VNĐ*\n` +
        `❌ Đã từ chối: *${totalRejected.toLocaleString()} VNĐ*`,
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
    await supabase.from('users').update({ isBanned: true }).eq('id', targetId);
    ctx.reply(`✅ Đã ban user ${targetId}`);
});

// /unban
bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /unban <userId>");
    await supabase.from('users').update({ isBanned: false }).eq('id', targetId);
    ctx.reply(`✅ Đã unban user ${targetId}`);
});

// /congcoin
bot.command('congcoin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /congcoin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data } = await supabase.from('users').select('coins').eq('id', targetId).single();
    if (!data) return ctx.reply("❌ Không tìm thấy user");
    await supabase.from('users').update({ coins: (data.coins || 0) + amount }).eq('id', targetId);
    ctx.reply(`✅ Đã cộng ${amount} coin cho ${targetId}. Số dư mới: ${(data.coins || 0) + amount}`);
});

// /trucoin
bot.command('trucoin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /trucoin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data } = await supabase.from('users').select('coins').eq('id', targetId).single();
    if (!data) return ctx.reply("❌ Không tìm thấy user");
    const newCoins = Math.max(0, (data.coins || 0) - amount);
    await supabase.from('users').update({ coins: newCoins }).eq('id', targetId);
    ctx.reply(`✅ Đã trừ ${amount} coin của ${targetId}. Số dư mới: ${newCoins}`);
});

// /addspin
bot.command('addspin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /addspin <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data } = await supabase.from('users').select('spins').eq('id', targetId).single();
    if (!data) return ctx.reply("❌ Không tìm thấy user");
    await supabase.from('users').update({ spins: (data.spins || 0) + amount }).eq('id', targetId);
    ctx.reply(`✅ Đã cộng ${amount} lượt mở rương cho ${targetId}`);
});

// /adddonhang
bot.command('adddonhang', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /adddonhang <userId> <số_lượng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data } = await supabase.from('users').select('orders').eq('id', targetId).single();
    if (!data) return ctx.reply("❌ Không tìm thấy user");
    await supabase.from('users').update({ orders: (data.orders || 0) + amount }).eq('id', targetId);
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
    await supabase.from('users').update({ truckLevel: level }).eq('id', targetId);
    ctx.reply(`✅ Đã đặt cấp độ xe của ${targetId} lên ${level}`);
});

// /resetdaily
bot.command('resetdaily', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /resetdaily <userId>");
    await supabase.from('users').update({ 
        adsToday: 0, 
        smartlinksToday: 0,
        deliveryCount: 0,
        smartlinkCount: 0,
        spinAdCount: 0,
        spinFree: 1
    }).eq('id', targetId);
    ctx.reply(`✅ Đã reset nhiệm vụ hàng ngày cho ${targetId}`);
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
    
    if (error) return ctx.reply("❌ Lỗi: Mã code đã tồn tại hoặc dữ liệu không hợp lệ.");
    ctx.reply(`✅ Đã tạo code: \`${code}\`\n🪙 Coin: ${coin}\n📦 Đơn hàng: ${orders}\n🎡 Lượt mở rương: ${spins}\n🔢 Giới hạn: ${limit} lần`, { parse_mode: 'Markdown' });
});

// /listcodes
bot.command('listcodes', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { data, error } = await supabase.from('giftcodes').select('*');
    if (error) return ctx.reply("❌ Lỗi lấy danh sách code.");
    if (!data || data.length === 0) return ctx.reply("📭 Chưa có giftcode nào.");
    
    let msg = "📜 *Danh sách Giftcode:*\n";
    data.forEach(row => {
        msg += `\n🔹 Mã: \`${row.code}\`\n`;
        msg += `   Loại: ${row.rewardType}\n`;
        if (row.rewardType === 'multi') {
            msg += `   🪙 ${row.rewardAmount || 0} Coin | 📦 ${row.orders || 0} ĐH | 🎡 ${row.spins || 0} lượt\n`;
        } else {
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
    if (error) return ctx.reply("❌ Lỗi: Không tìm thấy code.");
    ctx.reply(`✅ Đã xóa code: ${code}`);
});

// /checkID
bot.command('checkID', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /checkID <userId>");
    
    const { data } = await supabase.from('users').select('*').eq('id', targetId).single();
    if (!data) return ctx.reply("❌ Không tìm thấy user.");
    
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
    
    const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có đơn chờ duyệt của user này.");
    
    let totalRefunded = 0;
    for (const w of withdrawals) {
        const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
        await supabase.from('withdrawals').update({ status: 'refunded', reason: 'Hoàn trả bởi admin' }).eq('id', w.id);
        
        const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
        const newOrders = (userData?.orders || 0) + ordersDeducted;
        await supabase.from('users').update({ orders: newOrders }).eq('id', targetId);
        
        totalRefunded += ordersDeducted;
        await safeSendMessage(targetId, `🔄 Yêu cầu rút tiền của bạn đã được HOÀN TRẢ.\n📦 Số đơn hàng được hoàn: ${ordersDeducted.toLocaleString()}`);
    }
    
    ctx.reply(`✅ Đã hoàn trả ${withdrawals.length} đơn của ${targetId}.\n📦 Tổng đơn hoàn trả: ${totalRefunded.toLocaleString()}`);
});

// /duyet + ID
bot.command('duyet', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /duyet <userId>");
    
    const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt cho user này.");
    
    let totalApproved = 0;
    for (const w of withdrawals) {
        await supabase.from('withdrawals').update({ status: 'success', reason: 'Đã duyệt bởi admin' }).eq('id', w.id);
        totalApproved += w.amount;
    }
    
    await safeSendMessage(targetId, `✅ Yêu cầu rút tiền của bạn đã được *DUYỆT*!\n💰 Tổng số tiền: ${totalApproved.toLocaleString()} VNĐ\nTiền sẽ sớm được chuyển vào tài khoản.`, { parse_mode: 'Markdown' });
    ctx.reply(`✅ Đã duyệt ${withdrawals.length} yêu cầu rút của ${targetId}. Tổng: ${totalApproved.toLocaleString()} VNĐ`);
});

// /huy + ID + lý do
bot.command('huy', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("❌ Sử dụng: /huy <userId> <lý do>");
    const targetId = parts[1];
    const reason = parts.slice(2).join(' ');
    
    const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt.");
    
    let totalRefunded = 0;
    for (const w of withdrawals) {
        const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
        await supabase.from('withdrawals').update({ status: 'rejected', reason: reason }).eq('id', w.id);
        
        const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
        const newOrders = (userData?.orders || 0) + ordersDeducted;
        await supabase.from('users').update({ orders: newOrders }).eq('id', targetId);
        
        totalRefunded += ordersDeducted;
        await safeSendMessage(targetId, `❌ Yêu cầu rút tiền của bạn đã bị *HỦY*.\n📝 Lý do: ${reason}\n📦 Số đơn hàng đã được hoàn trả: ${ordersDeducted.toLocaleString()}`, { parse_mode: 'Markdown' });
    }
    
    ctx.reply(`✅ Đã hủy yêu cầu rút tiền của ${targetId}.\n📝 Lý do: ${reason}\n📦 Tổng đơn hoàn trả: ${totalRefunded.toLocaleString()}`);
});

// /donrutall - Thống kê đơn rút chưa duyệt + check IP trùng
bot.command('donrutall', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const { data, error } = await supabase.from('withdrawals').select('id, userId, amount, method, status, createdAt').eq('status', 'pending');
    if (error) return ctx.reply("❌ Lỗi lấy danh sách đơn rút.");
    if (!data || data.length === 0) return ctx.reply("📭 Không có đơn rút tiền nào đang chờ duyệt.");
    
    let msg = `📋 *Danh sách ${data.length} đơn rút CHỜ DUYỆT:*\n`;
    
    for (const w of data) {
        const { data: userData } = await supabase.from('users').select('ip, name').eq('id', w.userId).single();
        const ip = userData?.ip || 'Chưa có';
        const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
        
        // Check IP trùng
        const duplicates = await checkDuplicateIP(w.userId, userData?.ip);
        const dupText = duplicates.length > 0 ? `\n⚠️ *IP TRÙNG:* ${duplicates.map(d => d.id).join(', ')}` : '';
        
        msg += `\n🆔 ID: ${w.userId}\n👤 Tên: ${userData?.name || 'N/A'}\n💳 ${w.method} | 💰 ${w.amount.toLocaleString()} VNĐ\n📦 Đơn đã trừ: ${ordersDeducted.toLocaleString()}\n🌐 IP: ${ip}${dupText}\n---\n`;
        
        // Gửi tin nhắn riêng cho admin nếu IP trùng
        if (duplicates.length > 0) {
            await safeSendMessage(ADMIN_ID, 
                `⚠️ *CẢNH BÁO IP TRÙNG!*\n` +
                `👤 User: ${userData?.name} (${w.userId})\n` +
                `🌐 IP: ${ip}\n` +
                `⚠️ Trùng với: ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}\n` +
                `💰 Yêu cầu rút: ${w.amount.toLocaleString()} VNĐ`,
                { parse_mode: 'Markdown' }
            );
        }
    }
    
    if (msg.length > 4000) {
        msg = msg.substring(0, 4000) + "\n... (tin nhắn quá dài, hãy kiểm tra trên web admin)";
    }
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /broadcast
bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.substring(11);
    if (!msg) return ctx.reply("❌ Nhập tin nhắn cần gửi!");
    
    ctx.reply("⏳ Đang gửi tin nhắn...");
    const { data: users } = await supabase.from('users').select('id');
    let successCount = 0;
    
    for (const u of users) {
        const sent = await safeSendMessage(u.id, `📢 *THÔNG BÁO TỪ ADMIN:*\n\n${msg}`, { parse_mode: 'Markdown' });
        if (sent) successCount++;
        await new Promise(r => setTimeout(r, 50));
    }
    ctx.reply(`✅ Đã gửi thành công đến ${successCount}/${users.length} người dùng.`);
});

bot.launch();
console.log("✅ Bot is running...");

// ==================== API CHO FRONTEND ====================

// API kiểm tra tham gia nhóm từ frontend
app.get('/api/verify/:id', async (req, res) => {
    try {
        const isMember = await checkUserMembership(req.params.id);
        res.json({ success: isMember });
    } catch (e) {
        res.json({ success: false });
    }
});

// API lưu IP
app.post('/api/save-ip/:id', async (req, res) => {
    const { ip } = req.body;
    await supabase.from('users').update({ ip }).eq('id', req.params.id);
    
    // Check IP trùng và cảnh báo admin
    if (ip) {
        const duplicates = await checkDuplicateIP(req.params.id, ip);
        if (duplicates.length > 0) {
            const { data: user } = await supabase.from('users').select('name').eq('id', req.params.id).single();
            await safeSendMessage(ADMIN_ID,
                `⚠️ *CẢNH BÁO IP TRÙNG!*\n` +
                `👤 User: ${user?.name || 'N/A'} (${req.params.id})\n` +
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
    const { data } = await supabase.from('users').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

// API cập nhật user (chính xác, dùng increment chính xác)
app.post('/api/user/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('users').update(req.body).eq('id', req.params.id);
        res.json({ success: !error });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API rút tiền
app.post('/api/withdraw', async (req, res) => {
    const { userId, amount, method, accountInfo } = req.body;
    
    const { error } = await supabase.from('withdrawals').insert({ 
        userId, 
        amount, 
        method, 
        accountInfo: accountInfo || '',
        status: 'pending' 
    });
    
    if (error) return res.status(500).json({ error: "Lỗi tạo yêu cầu rút tiền" });
    
    // Trừ đơn hàng (1000 đơn = 10000 VNĐ)
    const { data: u } = await supabase.from('users').select('orders').eq('id', userId).single();
    const ordersToDeduct = Math.floor((amount || 0) / 1000) * 10000;
    const newOrders = Math.max(0, (u?.orders || 0) - ordersToDeduct);
    await supabase.from('users').update({ orders: newOrders }).eq('id', userId);
    
    res.json({ success: true });
});

// API redeem code
app.post('/api/redeem-code', async (req, res) => {
    const { userId, code } = req.body;
    const { data: gc, error } = await supabase.from('giftcodes').select('*').eq('code', code).single();
    if (error || !gc) return res.status(404).json({ error: "Mã code không hợp lệ hoặc không tồn tại." });
    if (gc.usedCount >= gc.limitUses) return res.status(400).json({ error: "Mã code đã hết lượt sử dụng." });
    
    // Tăng số lượt đã dùng
    await supabase.from('giftcodes').update({ usedCount: gc.usedCount + 1 }).eq('code', code);
    
    // Cộng thưởng
    const { data: u } = await supabase.from('users').select('coins, orders, spins').eq('id', userId).single();
    let updateData = { ...u };
    
    if (gc.rewardType === 'multi') {
        updateData.coins = (u.coins || 0) + (gc.rewardAmount || 0);
        updateData.orders = (u.orders || 0) + (gc.orders || 0);
        updateData.spins = (u.spins || 0) + (gc.spins || 0);
    } else if (gc.rewardType === 'coin') {
        updateData.coins = (u.coins || 0) + gc.rewardAmount;
    } else if (gc.rewardType === 'orders') {
        updateData.orders = (u.orders || 0) + gc.rewardAmount;
    } else if (gc.rewardType === 'spins') {
        updateData.spins = (u.spins || 0) + gc.rewardAmount;
    }
    
    await supabase.from('users').update(updateData).eq('id', userId);
    res.json({ 
        success: true, 
        rewardType: gc.rewardType, 
        rewardAmount: gc.rewardAmount,
        orders: gc.orders || 0,
        spins: gc.spins || 0
    });
});

// Admin: cập nhật trạng thái rút tiền
app.post('/api/admin/update-withdrawal', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).json({ error: "Access Denied" });
    const { id, status, reason } = req.body;
    await supabase.from('withdrawals').update({ status, reason }).eq('id', id);
    res.json({ success: true });
});

// Admin Web Panel
app.get('/admin', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).send('<h1>Access Denied</h1>');
    
    const { data: users } = await supabase.from('users').select('*');
    const { data: withdrawals } = await supabase.from('withdrawals').select('*').order('createdAt', { ascending: false });
    
    const ipCounts = {};
    users.forEach(u => { if (u.ip) ipCounts[u.ip] = (ipCounts[u.ip] || 0) + 1; });
    
    let usersHtml = users.map(u => {
        const isDup = u.ip && ipCounts[u.ip] > 1;
        return `<tr class="${isDup ? 'red-flag' : ''}">
            <td>${u.id}</td><td>${u.name}</td><td>${u.ip || 'N/A'} ${isDup ? '(TRÙNG IP!)' : ''}</td>
            <td>${u.coins}</td><td>${u.orders}</td><td>${u.truckLevel}</td><td>${u.validInvites}</td>
        </tr>`;
    }).join('');
    
    let withdrawsHtml = withdrawals.map(w => {
        let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : 'status-rejected');
        return `<tr>
            <td>${w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td>
            <td class="${statusClass}">${w.status}</td><td>${w.reason || '-'}</td>
            <td>
                <form onsubmit="updateWithdraw(event, ${w.id})">
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
    }).join('');
    
    res.send(`<!DOCTYPE html><html><head><title>Admin Panel</title><style>
        body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f9; }
        table { width: 100%; border-collapse: collapse; background: white; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 14px; }
        th { background: #f2f2f2; }
        .red-flag { background: #ffcccc !important; color: red; font-weight: bold; }
        .status-pending { color: orange; font-weight: bold; }
        .status-success { color: green; font-weight: bold; }
        .status-rejected { color: red; font-weight: bold; }
        .status-refunded { color: gray; font-weight: bold; }
    </style></head><body>
    <h1>🛠️ Admin Panel - Logistics App</h1>
    <h2>📥 Quản lý yêu cầu rút tiền</h2>
    <table><tr><th>ID</th><th>User ID</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Lý do</th><th>Hành động</th></tr>${withdrawsHtml || '<tr><td colspan="7">Đang tải...</td></tr>'}</table>
    <h2>👥 Danh sách User (Nền đỏ = Trùng IP)</h2>
    <table><tr><th>ID</th><th>Tên</th><th>IP</th><th>Coin</th><th>Đơn hàng</th><th>Level</th><th>Mời hợp lệ</th></tr>${usersHtml || '<tr><td colspan="7">Đang tải...</td></tr>'}</table>
    <script>
        async function updateWithdraw(e, id) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const res = await fetch('/api/admin/update-withdrawal?pass=${req.query.pass}', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ id, status: formData.get('status'), reason: formData.get('reason') })
            });
            if(res.ok) location.reload();
        }
    </script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
