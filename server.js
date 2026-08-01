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
const SUPABASE_URL = 'https://delvprrmrvbuthobcgvs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbHZwcnJtcnZidXRob2JjZ3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0NjA4MjEsImV4cCI6MjEwMTAzNjgyMX0.X-_gTRcZsXUQn7TaXFz3sIJel2fsubROqJN96gCXkY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_1_ID = -1003980180530; // Thay bằng ID channel thật
const GROUP_2_ID = -1003958491178; // Thay bằng ID group chat thật
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const WEB_APP_URL = 'https://logistics-bot-vyxa.onrender.com';

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

// ==================== BOT LOGIC ====================
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
        referralMilestones: JSON.stringify([
          { friends: 1, reward: '1,000 Coin + 3,000 Đơn Hàng', coins: 1000, orders: 3000, spins: 0, claimed: false },
          { friends: 5, reward: '1,000 Coin + 500 Đơn Hàng', coins: 1000, orders: 500, spins: 0, claimed: false },
          { friends: 10, reward: '1,500 Coin + 2 Lượt Mở Rương', coins: 1500, orders: 0, spins: 2, claimed: false },
          { friends: 20, reward: '2,000 Coin + 1,500 Đơn Hàng', coins: 2000, orders: 1500, spins: 0, claimed: false },
          { friends: 30, reward: '5,000 Đơn Hàng + 2 Lượt Mở Rương', coins: 0, orders: 5000, spins: 2, claimed: false },
          { friends: 50, reward: '5,000 Coin + 7,000 Đơn Hàng', coins: 5000, orders: 7000, spins: 0, claimed: false },
          { friends: 75, reward: '10,000 Đơn Hàng + 5 Lượt Mở Rương', coins: 0, orders: 10000, spins: 5, claimed: false },
          { friends: 100, reward: '20,000 Đơn Hàng + 10 Lượt Mở Rương', coins: 0, orders: 20000, spins: 10, claimed: false }
        ]),
        isBanned: false,
        referrerCounted: false,
        joinDate: new Date().toLocaleDateString('vi-VN')
      };
      
      const { data: insertedUser, error: insertError } = await supabase.from('users').insert(newUser).select().single();
      if (insertError) {
        console.error("Lỗi tạo user mới:", insertError);
        return ctx.reply("⚠️ Có lỗi xảy ra khi tạo tài khoản!");
      }
      userRecord = insertedUser;

      // Tăng invitedCount cho người mời
      if (referrerId && referrerId !== userId) {
        const { data: ref } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
        if (ref) {
          const newCount = (ref.invitedCount || 0) + 1;
          await supabase.from('users').update({ invitedCount: newCount }).eq('id', referrerId);
          
          const milestones = [1, 5, 10, 20, 30, 50, 75, 100];
          const nextMilestone = milestones.find(m => m > newCount) || 'Hoàn thành';
          await safeSendMessage(referrerId, 
            `🎉 Bạn vừa mời thành công: *${userName}*\n📊 Tổng số người đã mời: *${newCount}*\n Tiến độ: ${newCount}/${nextMilestone}`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } else {
      userRecord = existingUser;
      if (userRecord.isBanned) {
        return ctx.reply("❌ Tài khoản của bạn đã bị khóa.");
      }
    }

    // Kiểm tra tham gia nhóm
    const isMember = await checkUserMembership(userId);
    
    if (isMember) {
      // Đếm valid invite nếu chưa đếm
      if (userRecord.referrerId && userRecord.referrerId !== userId && !userRecord.referrerCounted) {
        const { data: refUser } = await supabase.from('users').select('validInvites, referralMilestones').eq('id', userRecord.referrerId).single();
        if (refUser) {
          const newValid = (refUser.validInvites || 0) + 1;
          await supabase.from('users').update({ 
            validInvites: newValid,
            referrerCounted: true 
          }).eq('id', userId);

          const milestonesData = refUser.referralMilestones ? JSON.parse(refUser.referralMilestones) : [];
          const nextMilestone = milestonesData.find(m => m.friends > newValid);
          const progressText = nextMilestone 
            ? `🎯 Tiến độ: ${newValid}/${nextMilestone.friends} bạn (Phần thưởng: ${nextMilestone.reward})`
            : '🏆 Đã đạt tất cả các mốc!';
          
          await safeSendMessage(userRecord.referrerId,
            `✅ *Xác nhận hợp lệ!* ${userName} đã tham gia đủ nhóm.\n Tổng hợp lệ: *${newValid}*\n${progressText}`,
            { parse_mode: 'Markdown' }
          );
        }
      }

      ctx.reply(`Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công.`, {
        reply_markup: { 
          inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] 
        }
      });
    } else {
      ctx.reply(
        "⚠️ *Bạn chưa tham gia đủ 2 nhóm bắt buộc!*\n\n" +
        "Vui lòng tham gia:\n" +
        "1️ https://t.me/khohangkiemtien (Channel)\n" +
        "2️ https://t.me/khohangchatkiemtien (Nhóm chat)\n\n" +
        "Sau đó nhấn *Xác Nhận* để kiểm tra.",
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "1️⃣ Channel", url: "https://t.me/khohangkiemtien" }],
              [{ text: "2️⃣ Nhóm Chat", url: "https://t.me/khohangchatkiemtien" }],
              [{ text: "✅ Xác Nhận", callback_data: "check_groups" }]
            ]
          }
        }
      );
    }
  } catch (err) {
    console.error("Lỗi /start:", err);
    ctx.reply("⚠️ Có lỗi xảy ra!");
  }
});

// Xử lý callback
bot.on('callback_query', async (ctx) => {
  if (ctx.callbackQuery.data === 'check_groups') {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    
    await ctx.answerCbQuery("🔍 Đang kiểm tra...");
    const isMember = await checkUserMembership(userId);
    
    if (isMember) {
      const { data: userRecord } = await supabase.from('users').select('*').eq('id', userId).single();
      
      if (userRecord && userRecord.referrerId && userRecord.referrerId !== userId && !userRecord.referrerCounted) {
        const { data: refUser } = await supabase.from('users').select('validInvites').eq('id', userRecord.referrerId).single();
        if (refUser) {
          const newValid = (refUser.validInvites || 0) + 1;
          await supabase.from('users').update({ 
            validInvites: newValid,
            referrerCounted: true 
          }).eq('id', userId);
          
          await safeSendMessage(userRecord.referrerId,
            `✅ *${userName}* đã tham gia nhóm!\n Tổng hợp lệ: *${newValid}*`,
            { parse_mode: 'Markdown' }
          );
        }
      }
      
      await ctx.editMessageText(
        `Chào mừng ${userName}! 🎉\nXác minh thành công!`,
        {
          reply_markup: { 
            inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] 
          }
        }
      );
    } else {
      await ctx.answerCbQuery(" Bạn chưa tham gia đủ 2 nhóm!");
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
    `📊 *THỐNG KÊ:*\n\n` +
    `👥 User: *${totalUsers || 0}*\n` +
    `📺 QC hôm nay: *${totalAds}*\n` +
    `🔗 Smartlink: *${totalSmartlinks}*\n\n` +
    ` Chờ duyệt: *${totalPending.toLocaleString()} VNĐ*\n` +
    `✅ Đã duyệt: *${totalSuccess.toLocaleString()} VNĐ*`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('quantri', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
  const totalWithdrawn = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  
  ctx.reply(`📊 *Nhanh:*\n👥 User: *${totalUsers || 0}*\n💰 Đã duyệt: *${totalWithdrawn.toLocaleString()} VNĐ*`, { parse_mode: 'Markdown' });
});

bot.command('ban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ /ban <userId>");
  await supabase.from('users').update({ isBanned: true }).eq('id', targetId);
  ctx.reply(`✅ Đã ban ${targetId}`);
});

bot.command('unban', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ /unban <userId>");
  await supabase.from('users').update({ isBanned: false }).eq('id', targetId);
  ctx.reply(`✅ Đã unban ${targetId}`);
});

bot.command('congcoin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ /congcoin <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('coins').eq('id', targetId).single();
  if (!data) return ctx.reply("❌ Không tìm thấy user");
  await supabase.from('users').update({ coins: (data.coins || 0) + amount }).eq('id', targetId);
  ctx.reply(`✅ Cộng ${amount} coin cho ${targetId}`);
});

bot.command('trucoin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply(" /trucoin <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('coins').eq('id', targetId).single();
  if (!data) return ctx.reply(" Không tìm thấy user");
  await supabase.from('users').update({ coins: Math.max(0, (data.coins || 0) - amount) }).eq('id', targetId);
  ctx.reply(`✅ Trừ ${amount} coin của ${targetId}`);
});

bot.command('addspin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ /addspin <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('spins').eq('id', targetId).single();
  if (!data) return ctx.reply("❌ Không tìm thấy user");
  await supabase.from('users').update({ spins: (data.spins || 0) + amount }).eq('id', targetId);
  ctx.reply(`✅ Cộng ${amount} lượt mở rương`);
});

bot.command('adddonhang', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ /adddonhang <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('orders').eq('id', targetId).single();
  if (!data) return ctx.reply("❌ Không tìm thấy user");
  await supabase.from('users').update({ orders: (data.orders || 0) + amount }).eq('id', targetId);
  ctx.reply(`✅ Cộng ${amount} đơn hàng`);
});

bot.command('setlevel', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ /setlevel <userId> <cấp_độ>");
  const targetId = parts[1];
  const level = parseInt(parts[2]);
  if (level < 1 || level > 10) return ctx.reply("❌ Cấp độ 1-10");
  await supabase.from('users').update({ truckLevel: level }).eq('id', targetId);
  ctx.reply(`✅ Set level ${level} cho ${targetId}`);
});

bot.command('resetdaily', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ /resetdaily <userId>");
  await supabase.from('users').update({
    adsToday: 0, smartlinksToday: 0, deliveryCount: 0, smartlinkCount: 0, spinAdCount: 0, spinFree: 1
  }).eq('id', targetId);
  ctx.reply(`✅ Reset daily cho ${targetId}`);
});

bot.command('deleteuser', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ /deleteuser <userId>");
  await supabase.from('users').delete().eq('id', targetId);
  ctx.reply(`✅ Xóa user ${targetId}`);
});

bot.command('taocode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 6) return ctx.reply("❌ /taocode <mã> <coin> <orders> <spins> <limit>");
  const [, code, coin, orders, spins, limit] = parts;
  
  const { error } = await supabase.from('giftcodes').insert({
    code, rewardType: 'multi', rewardAmount: parseInt(coin),
    orders: parseInt(orders), spins: parseInt(spins), limitUses: parseInt(limit), usedCount: 0
  });
  
  if (error) return ctx.reply("❌ Code đã tồn tại");
  ctx.reply(`✅ Tạo code: ${code}\n🪙 ${coin} | 📦 ${orders} | 🎡 ${spins} | Limit: ${limit}`);
});

bot.command('listcodes', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { data } = await supabase.from('giftcodes').select('*');
  if (!data || data.length === 0) return ctx.reply("📭 Chưa có code");
  
  let msg = "📜 *Giftcodes:*\n";
  data.forEach(row => {
    msg += `\n🔹 \`${row.code}\` - 🪙${row.rewardAmount} | 📦${row.orders} | 🎡${row.spins} | ${row.usedCount}/${row.limitUses}\n`;
  });
  ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('delcode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const code = ctx.message.text.split(' ')[1];
  if (!code) return ctx.reply("❌ /delcode <mã>");
  await supabase.from('giftcodes').delete().eq('code', code);
  ctx.reply(`✅ Xóa code ${code}`);
});

bot.command('checkID', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ /checkID <userId>");
  
  const { data } = await supabase.from('users').select('*').eq('id', targetId).single();
  if (!data) return ctx.reply("❌ Không tìm thấy");
  
  const { data: withdraws } = await supabase.from('withdrawals').select('amount').eq('userId', targetId).eq('status', 'success');
  const totalWithdrawn = withdraws ? withdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  
  ctx.reply(
    `👤 *Info:*\n` +
    `ID: ${data.id}\n` +
    `Tên: ${data.name}\n` +
    `📦 Đơn: ${data.orders}\n` +
    `🪙 Coin: ${data.coins}\n` +
    `🚛 Level: ${data.truckLevel}\n` +
    `🌐 IP: ${data.ip || 'N/A'}\n` +
    `💰 Đã rút: ${totalWithdrawn.toLocaleString()} VNĐ\n` +
    `👥 Mời: ${data.invitedCount} (Hợp lệ: ${data.validInvites})`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('hoantra', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ /hoantra <userId>");
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có đơn chờ");
  
  let total = 0;
  for (const w of withdrawals) {
    const ordersToRefund = Math.floor((w.amount || 0) / 1000) * 10000;
    await supabase.from('withdrawals').update({ status: 'refunded' }).eq('id', w.id);
    const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
    await supabase.from('users').update({ orders: (userData?.orders || 0) + ordersToRefund }).eq('id', targetId);
    total += ordersToRefund;
    await safeSendMessage(targetId, `🔄 Hoàn trả ${ordersToRefund.toLocaleString()} đơn hàng`);
  }
  ctx.reply(`✅ Hoàn trả ${withdrawals.length} đơn. Tổng: ${total.toLocaleString()} đơn`);
});

bot.command('duyet', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply(" /duyet <userId>");
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có đơn chờ");
  
  let total = 0;
  for (const w of withdrawals) {
    await supabase.from('withdrawals').update({ status: 'success' }).eq('id', w.id);
    total += w.amount;
  }
  await safeSendMessage(targetId, `✅ Duyệt rút *${total.toLocaleString()} VNĐ*!`, { parse_mode: 'Markdown' });
  ctx.reply(`✅ Duyệt ${total.toLocaleString()} VNĐ cho ${targetId}`);
});

bot.command('huy', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ /huy <userId> <lý do>");
  const targetId = parts[1];
  const reason = parts.slice(2).join(' ');
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có đơn chờ");
  
  for (const w of withdrawals) {
    const ordersToRefund = Math.floor((w.amount || 0) / 1000) * 10000;
    await supabase.from('withdrawals').update({ status: 'rejected', reason }).eq('id', w.id);
    const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
    await supabase.from('users').update({ orders: (userData?.orders || 0) + ordersToRefund }).eq('id', targetId);
    await safeSendMessage(targetId, `❌ Hủy rút. Lý do: ${reason}\n📦 Hoàn ${ordersToRefund} đơn`);
  }
  ctx.reply(`✅ Hủy đơn của ${targetId}`);
});

bot.command('donrutall', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { data } = await supabase.from('withdrawals').select('*').eq('status', 'pending');
  if (!data || data.length === 0) return ctx.reply("📭 Không có đơn chờ");
  
  let msg = `📋 *${data.length} đơn chờ:*\n`;
  const ipMap = {};
  
  for (const w of data) {
    const { data: userData } = await supabase.from('users').select('ip, name').eq('id', w.userId).single();
    const ip = userData?.ip || 'N/A';
    const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
    
    if (!ipMap[ip]) ipMap[ip] = [];
    ipMap[ip].push({ name: userData?.name, id: w.userId });
    
    msg += `\n ${w.userId} | 👤 ${userData?.name}\n💰 ${w.amount.toLocaleString()} VNĐ | 📦 ${ordersDeducted.toLocaleString()}\n🌐 ${ip}\n---\n`;
  }
  
  for (const [ip, users] of Object.entries(ipMap)) {
    if (users.length >= 2) {
      await safeSendMessage(ADMIN_ID, `⚠️ *IP TRÙNG:* ${ip}\n${users.map(u => `${u.name} (${u.id})`).join(', ')}`, { parse_mode: 'Markdown' });
    }
  }
  
  ctx.reply(msg.substring(0, 4000), { parse_mode: 'Markdown' });
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const msg = ctx.message.text.substring(11).trim();
  if (!msg) return ctx.reply("❌ Nhập tin nhắn");
  
  ctx.reply("⏳ Đang gửi...");
  const { data: users } = await supabase.from('users').select('id');
  let count = 0;
  
  for (const u of users) {
    if (await safeSendMessage(u.id, `📢 *ADMIN:*\n\n${msg}`, { parse_mode: 'Markdown' })) count++;
    await new Promise(r => setTimeout(r, 50));
  }
  ctx.reply(`✅ Gửi ${count}/${users.length} user`);
});

bot.launch();
console.log("✅ Bot running...");

// ==================== API ====================
app.get('/api/verify/:id', async (req, res) => {
  const isMember = await checkUserMembership(req.params.id);
  res.json({ success: isMember });
});

app.post('/api/save-ip/:id', async (req, res) => {
  const { ip } = req.body;
  const { data: user } = await supabase.from('users').select('ip, name').eq('id', req.params.id).single();
  
  if (user && user.ip !== ip) {
    await supabase.from('users').update({ ip }).eq('id', req.params.id);
    
    const duplicates = await checkDuplicateIP(req.params.id, ip);
    if (duplicates.length > 0) {
      await safeSendMessage(ADMIN_ID, `⚠️ IP TRÙNG: ${user.name} (${req.params.id}) - IP: ${ip}`);
    }
  }
  res.json({ success: true });
});

app.get('/api/user/:id', async (req, res) => {
  const { data } = await supabase.from('users').select('*').eq('id', req.params.id).single();
  if (!data) return res.status(404).json({ error: "Not found" });
  
  if (data.referralMilestones && typeof data.referralMilestones === 'string') {
    data.referralMilestones = JSON.parse(data.referralMilestones);
  }
  res.json(data);
});

app.post('/api/user/:id', async (req, res) => {
  try {
    const updateData = { ...req.body };
    if (updateData.referralMilestones) {
      updateData.referralMilestones = JSON.stringify(updateData.referralMilestones);
    }
    
    const { error } = await supabase.from('users').update(updateData).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, method, accountInfo } = req.body;
  
  const { data: userData } = await supabase.from('users').select('orders').eq('id', userId).single();
  const ordersToDeduct = Math.floor(amount / 1000) * 10000;
  
  if (userData.orders < ordersToDeduct) {
    return res.status(400).json({ error: "Không đủ đơn" });
  }
  
  await supabase.from('withdrawals').insert({ userId, amount, method, accountInfo, status: 'pending' });
  await supabase.from('users').update({ orders: userData.orders - ordersToDeduct }).eq('id', userId);
  
  res.json({ success: true });
});

app.post('/api/redeem-code', async (req, res) => {
  const { userId, code } = req.body;
  const { data: gc } = await supabase.from('giftcodes').select('*').eq('code', code).single();
  
  if (!gc || gc.usedCount >= gc.limitUses) {
    return res.status(400).json({ error: "Code không hợp lệ" });
  }
  
  await supabase.from('giftcodes').update({ usedCount: gc.usedCount + 1 }).eq('code', code);
  
  const { data: u } = await supabase.from('users').select('coins, orders, spins').eq('id', userId).single();
  const updateData = {
    coins: (u.coins || 0) + (gc.rewardAmount || 0),
    orders: (u.orders || 0) + (gc.orders || 0),
    spins: (u.spins || 0) + (gc.spins || 0)
  };
  
  await supabase.from('users').update(updateData).eq('id', userId);
  res.json({ success: true, rewardAmount: gc.rewardAmount, orders: gc.orders, spins: gc.spins });
});

app.post('/api/admin/update-withdrawal', async (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(403).json({ error: "Denied" });
  const { id, status, reason } = req.body;
  await supabase.from('withdrawals').update({ status, reason }).eq('id', id);
  res.json({ success: true });
});

app.get('/admin', async (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(403).send('Denied');
  
  const { data: users } = await supabase.from('users').select('*');
  const { data: withdrawals } = await supabase.from('withdrawals').select('*').order('createdAt', { ascending: false });
  
  let html = `<!DOCTYPE html><html><head><title>Admin</title>
  <style>body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f2f2}.pending{color:orange}.success{color:green}.rejected{color:red}</style></head><body>
  <h1>Admin Panel</h1><h2>Withdrawals</h2><table><tr><th>ID</th><th>User</th><th>Amount</th><th>Status</th><th>Action</th></tr>`;
  
  withdrawals.forEach(w => {
    html += `<tr><td>${w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td class="${w.status}">${w.status}</td>
    <td><form onsubmit="updateWithdraw(event,'${w.id}')"><select name="status"><option value="pending" ${w.status==='pending'?'selected':''}>Pending</option>
    <option value="success" ${w.status==='success'?'selected':''}>Success</option><option value="rejected" ${w.status==='rejected'?'selected':''}>Rejected</option></select>
    <button type="submit">Update</button></form></td></tr>`;
  });
  
  html += `</table><script>async function updateWithdraw(e,id){e.preventDefault();const f=new FormData(e.target);await fetch('/api/admin/update-withdrawal?pass=${req.query.pass}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:f.get('status')})});location.reload();}</script></body></html>`;
  
  res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server port ${PORT}`));
