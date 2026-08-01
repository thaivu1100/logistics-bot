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
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const userName = ctx.from.first_name || 'User';
  const referrerId = ctx.startPayload;

  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    
    if (!user) {
      const newUser = {
        id: userId, name: userName, referrerId: referrerId || null,
        coins: 0, orders: 0, spins: 1, truckLevel: 1, adsToday: 0, smartlinksToday: 0,
        invitedCount: 0, validInvites: 0, referralMilestones: [], isBanned: false, ip: ''
      };
      await supabase.from('users').insert(newUser);
      
      if (referrerId) {
        const { data: ref } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
        if (ref) {
          const newCount = (ref.invitedCount || 0) + 1;
          await supabase.from('users').update({ invitedCount: newCount }).eq('id', referrerId);
        }
      }
    } else if (user.isBanned) {
      return ctx.reply("❌ Tài khoản của bạn đã bị khóa. Liên hệ admin để được hỗ trợ.");
    }

    const isMember = await checkUserMembership(userId);
    if (isMember) {
      const currentUser = user || (await supabase.from('users').select('*').eq('id', userId).single()).data;
      const refId = currentUser?.referrerId;
      
      if (refId && !currentUser.referrerCounted) {
        const { data: ref } = await supabase.from('users').select('validInvites, name').eq('id', refId).single();
        if (ref) {
          const newValid = (ref.validInvites || 0) + 1;
          await supabase.from('users').update({ validInvites: newValid, referrerCounted: true }).eq('id', userId);
          
          const milestones = [
            { friends: 1, reward: '1,000 Coin + 3,000 Đơn Hàng' },
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
            ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn để nhận phần thưởng: ${nextMilestone.reward}`
            : '🏆 Đã đạt tất cả các mốc!';
            
          await safeSendMessage(refId,
            `🎉 Bạn đã mời thành công: *${userName}*\n📊 Tổng hợp lệ: *${newValid}*\n${progressText}\n⚠️ Điều kiện: Bạn bè phải tham gia đủ 2 nhóm và xem ít nhất 3 QC.`,
            { parse_mode: 'Markdown' }
          );
        }
      }
      
      ctx.reply(`Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`, {
        reply_markup: { inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] }
      });
    } else {
      ctx.reply(
        "⚠️ *Bạn chưa tham gia đủ 2 nhóm bắt buộc!*\n\n" +
        "Vui lòng tham gia 2 nhóm dưới đây:\n" +
        "1️⃣ https://t.me/khohangkiemtien (Channel)\n" +
        "2️⃣ https://t.me/khohangchatkiemtien (Nhóm chat)\n\n" +
        "Sau khi tham gia xong, nhấn nút *Xác Nhận* bên dưới để bot kiểm tra.",
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "1️⃣ Tham gia Channel", url: "https://t.me/khohangkiemtien" }],
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

bot.on('callback_query', async (ctx) => {
  if (ctx.callbackQuery.data === 'check_groups') {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    await ctx.answerCbQuery("🔍 Đang kiểm tra...");
    
    const isMember = await checkUserMembership(userId);
    if (isMember) {
      const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
      const referrerId = user?.referrerId;
      
      if (referrerId && !user.referrerCounted) {
        const { data: ref } = await supabase.from('users').select('validInvites, name').eq('id', referrerId).single();
        if (ref) {
          const newValid = (ref.validInvites || 0) + 1;
          await supabase.from('users').update({ validInvites: newValid, referrerCounted: true }).eq('id', userId);
          
          const milestones = [
            { friends: 1, reward: '1,000 Coin + 3,000 Đơn Hàng' },
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
            ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn để nhận phần thưởng: ${nextMilestone.reward}`
            : '🏆 Đã đạt tất cả các mốc!';
            
          await safeSendMessage(referrerId,
            `🎉 Bạn đã mời thành công: *${userName}*\n📊 Tổng hợp lệ: *${newValid}*\n${progressText}\n⚠️ Điều kiện: Bạn bè phải tham gia đủ 2 nhóm và xem ít nhất 3 QC.`,
            { parse_mode: 'Markdown' }
          );
        }
      }
      
      await ctx.editMessageText(
        `Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`,
        { reply_markup: { inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] } }
      );
    } else {
      await ctx.answerCbQuery("❌ Bạn vẫn chưa tham gia đủ 2 nhóm! Vui lòng thử lại sau khi đã tham gia.", true);
    }
  }
});

// ==================== LỆNH ADMIN ====================
bot.command('thongke', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { data: usersStats } = await supabase.from('users').select('adsToday, smartlinksToday');
  const { data: pendingWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'pending');
  const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
  
  const totalAds = usersStats ? usersStats.reduce((sum, u) => sum + (u.adsToday || 0), 0) : 0;
  const totalSmartlinks = usersStats ? usersStats.reduce((sum, u) => sum + (u.smartlinksToday || 0), 0) : 0;
  const totalPending = pendingWithdraws ? pendingWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  const totalSuccess = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;

  ctx.reply(
    `📊 *THỐNG KÊ CHI TIẾT*\n\n` +
    `👥 Tổng User: *${totalUsers || 0}*\n` +
    `📺 Tổng QC đã xem (hôm nay): *${totalAds}*\n` +
    `🔗 Tổng Smartlink đã ấn (hôm nay): *${totalSmartlinks}*\n\n` +
    `💰 *TÀI CHÍNH:*\n` +
    `⏳ Chờ duyệt: *${totalPending.toLocaleString()} VNĐ*\n` +
    `✅ Đã duyệt: *${totalSuccess.toLocaleString()} VNĐ*\n` +
    `💵 Tổng tiền đã rút thành công: *${totalSuccess.toLocaleString()} VNĐ*`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('quantri', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
  const totalWithdrawn = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  ctx.reply(`📊 *Thống kê nhanh:*\n👥 Tổng User: *${totalUsers || 0}*\n💰 Tổng tiền đã duyệt/rút: *${totalWithdrawn.toLocaleString()} VNĐ*`, { parse_mode: 'Markdown' });
});

bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /ban <userId>");
  await supabase.from('users').update({ isBanned: true }).eq('id', targetId);
  ctx.reply(`✅ Đã ban user ${targetId}`);
});

bot.command('unban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /unban <userId>");
  await supabase.from('users').update({ isBanned: false }).eq('id', targetId);
  ctx.reply(`✅ Đã unban user ${targetId}`);
});

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

bot.command('resetdaily', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /resetdaily <userId>");
  await supabase.from('users').update({
    adsToday: 0, smartlinksToday: 0, deliveryCount: 0, smartlinkCount: 0, spinAdCount: 0, spinFree: 1
  }).eq('id', targetId);
  ctx.reply(`✅ Đã reset nhiệm vụ hàng ngày cho ${targetId}`);
});

bot.command('deleteuser', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /deleteuser <userId>");
  await supabase.from('users').delete().eq('id', targetId);
  ctx.reply(`✅ Đã xóa vĩnh viễn user ${targetId}`);
});

bot.command('taocode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 6) return ctx.reply("❌ Sử dụng: /taocode <mã> <coin> <orders> <spins> <giới_hạn>\nVí dụ: /taocode TET2024 500 1000 2 100");
  const [, code, coin, orders, spins, limit] = parts;
  
  const { error } = await supabase.from('giftcodes').insert({
    code: code, rewardType: 'multi', rewardAmount: parseInt(coin),
    orders: parseInt(orders), spins: parseInt(spins), limitUses: parseInt(limit), usedCount: 0
  });
  if (error) return ctx.reply("❌ Lỗi: Mã code đã tồn tại hoặc dữ liệu không hợp lệ.");
  ctx.reply(`✅ Đã tạo code: \`${code}\`\n🪙 Coin: ${coin}\n📦 Đơn hàng: ${orders}\n🎡 Lượt mở rương: ${spins}\n🔢 Giới hạn: ${limit} lần`, { parse_mode: 'Markdown' });
});

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

bot.command('delcode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const code = ctx.message.text.split(' ')[1];
  if (!code) return ctx.reply("❌ Sử dụng: /delcode <mã_code>");
  const { error } = await supabase.from('giftcodes').delete().eq('code', code);
  if (error) return ctx.reply("❌ Lỗi: Không tìm thấy code.");
  ctx.reply(`✅ Đã xóa code: ${code}`);
});

bot.command('checkID', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /checkID <userId>");
  
  const { data } = await supabase.from('users').select('*').eq('id', targetId).single();
  if (!data) return ctx.reply("❌ Không tìm thấy user.");
  
  const { data: withdraws } = await supabase.from('withdrawals').select('amount').eq('userId', targetId).eq('status', 'success');
  const totalWithdrawn = withdraws ? withdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  
  ctx.reply(
    `👤 *Thông tin user:*\n` +
    `🆔 ID: ${data.id}\n` +
    `👤 Tên: ${data.name}\n` +
    `📦 Đơn hàng còn lại: ${data.orders}\n` +
    `🪙 Coin còn lại: ${data.coins}\n` +
    `🚛 Level xe: ${data.truckLevel}\n` +
    `🌐 IP: ${data.ip || 'Chưa có'}\n` +
    `💰 Tổng tiền đã rút: ${totalWithdrawn.toLocaleString()} VNĐ\n` +
    `👥 Đã mời: ${data.invitedCount} (Hợp lệ: ${data.validInvites})`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('hoantra', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /hoantra <userId>");
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có đơn chờ duyệt của user này.");
  
  let totalRefundedOrders = 0;
  for (const w of withdrawals) {
    const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
    await supabase.from('withdrawals').update({ status: 'refunded', reason: 'Hoàn trả bởi admin' }).eq('id', w.id);
    const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
    const newOrders = (userData?.orders || 0) + ordersDeducted;
    await supabase.from('users').update({ orders: newOrders }).eq('id', targetId);
    totalRefundedOrders += ordersDeducted;
  }
  await safeSendMessage(targetId, `🔄 Yêu cầu rút tiền của bạn đã được HOÀN TRẢ.\n📦 Số đơn hàng được hoàn: ${totalRefundedOrders.toLocaleString()}`);
  ctx.reply(`✅ Đã hoàn trả ${withdrawals.length} đơn của ${targetId}.\n📦 Tổng đơn hoàn trả: ${totalRefundedOrders.toLocaleString()}`);
});

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

bot.command('huy', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ Sử dụng: /huy <userId> <lý do>");
  const targetId = parts[1];
  const reason = parts.slice(2).join(' ');
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt.");
  
  let totalRefundedOrders = 0;
  for (const w of withdrawals) {
    const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
    await supabase.from('withdrawals').update({ status: 'rejected', reason: reason }).eq('id', w.id);
    const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
    const newOrders = (userData?.orders || 0) + ordersDeducted;
    await supabase.from('users').update({ orders: newOrders }).eq('id', targetId);
    totalRefundedOrders += ordersDeducted;
  }
  await safeSendMessage(targetId, `❌ Yêu cầu rút tiền của bạn đã bị *HỦY*.\n📝 Lý do: ${reason}\n📦 Số đơn hàng đã được hoàn trả: ${totalRefundedOrders.toLocaleString()}`, { parse_mode: 'Markdown' });
  ctx.reply(`✅ Đã hủy yêu cầu rút tiền của ${targetId}.\n📝 Lý do: ${reason}\n📦 Tổng đơn hoàn trả: ${totalRefundedOrders.toLocaleString()}`);
});

bot.command('donrutall', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { data, error } = await supabase.from('withdrawals').select('id, userId, amount, method, accountInfo, status, createdAt').eq('status', 'pending');
  if (error) return ctx.reply("❌ Lỗi lấy danh sách đơn rút.");
  if (!data || data.length === 0) return ctx.reply("📭 Không có đơn rút tiền nào đang chờ duyệt.");
  
  let msg = `📋 *Danh sách ${data.length} đơn rút CHỜ DUYỆT:*\n`;
  const ipMap = {};
  
  for (const w of data) {
    const { data: userData } = await supabase.from('users').select('ip, name').eq('id', w.userId).single();
    const ip = userData?.ip || 'Chưa có';
    const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
    
    if (!ipMap[ip]) ipMap[ip] = [];
    ipMap[ip].push({ name: userData?.name, id: w.userId, amount: w.amount });
    
    msg += `\n🆔 ID: ${w.userId}\n👤 Tên: ${userData?.name || 'N/A'}\n💳 ${w.method} | 💰 ${w.amount.toLocaleString()} VNĐ\n📦 Đơn đã trừ: ${ordersDeducted.toLocaleString()}\n🌐 IP: ${ip}\n📝 TK/SDT: ${w.accountInfo || 'Chưa cập nhật'}\n---\n`;
  }
  
  for (const [ip, users] of Object.entries(ipMap)) {
    if (users.length >= 2) {
      const userList = users.map(u => `${u.name} (${u.id}) - ${u.amount.toLocaleString()} VNĐ`).join('\n');
      await safeSendMessage(ADMIN_ID, 
        `⚠️ *CẢNH BÁO IP TRÙNG!*\n` +
        `🌐 IP: ${ip}\n` +
        `👥 Các user trùng IP đang rút tiền:\n${userList}`,
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  if (msg.length > 4000) msg = msg.substring(0, 4000) + "\n... (tin nhắn quá dài)";
  ctx.reply(msg, { parse_mode: 'Markdown' });
});

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
app.get('/api/verify/:id', async (req, res) => {
  try {
    const isMember = await checkUserMembership(req.params.id);
    res.json({ success: isMember });
  } catch (e) {
    res.json({ success: false });
  }
});

app.post('/api/save-ip/:id', async (req, res) => {
  const { ip } = req.body;
  await supabase.from('users').update({ ip }).eq('id', req.params.id);
  if (ip) {
    const duplicates = await checkDuplicateIP(req.params.id, ip);
    if (duplicates.length >= 1) { // >= 1 nghĩa là có ít nhất 1 user khác trùng IP (tổng >= 2)
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

app.get('/api/user/:id', async (req, res) => {
  const { data } = await supabase.from('users').select('*').eq('id', req.params.id).single();
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

app.post('/api/user/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    const { data, error } = await supabase.from('users').update(updateData).eq('id', req.params.id).select();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (e) {
    console.error("Lỗi lưu DB", e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, method, accountInfo } = req.body;
  const { error } = await supabase.from('withdrawals').insert({ 
    userId, amount, method, accountInfo: accountInfo || '', status: 'pending' 
  });
  if (error) return res.status(500).json({ error: "Lỗi tạo yêu cầu rút tiền" });
  
  const { data: u } = await supabase.from('users').select('orders').eq('id', userId).single();
  const ordersToDeduct = Math.floor((amount || 0) / 1000) * 10000;
  const newOrders = Math.max(0, (u?.orders || 0) - ordersToDeduct);
  await supabase.from('users').update({ orders: newOrders }).eq('id', userId);
  res.json({ success: true });
});

app.post('/api/redeem-code', async (req, res) => {
  const { userId, code } = req.body;
  const { data: gc, error } = await supabase.from('giftcodes').select('*').eq('code', code).single();
  if (error || !gc) return res.status(404).json({ error: "Mã code không hợp lệ hoặc không tồn tại." });
  if (gc.usedCount >= gc.limitUses) return res.status(400).json({ error: "Mã code đã hết lượt sử dụng." });
  
  await supabase.from('giftcodes').update({ usedCount: gc.usedCount + 1 }).eq('code', code);
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
  res.json({ success: true, rewardType: gc.rewardType, rewardAmount: gc.rewardAmount, orders: gc.orders || 0, spins: gc.spins || 0 });
});

app.post('/api/admin/update-withdrawal', async (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(403).json({ error: "Access Denied" });
  const { id, status, reason } = req.body;
  await supabase.from('withdrawals').update({ status, reason }).eq('id', id);
  res.json({ success: true });
});

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
    let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : (w.status === 'rejected' ? 'status-rejected' : 'status-refunded'));
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
