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

// --- 1. CẤU HÌNH SUPABASE (Giúp lưu dữ liệu vĩnh viễn, không bị mất khi restart) ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// --- 2. CẤU HÌNH BOT ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8695768637:AAErM9TCikOmOoATmuIJCBLNF_SOzc5T34c';
const GROUP_1_ID = -1003980180530;
const GROUP_2_ID = -1003958491178;
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS || '8695768637:AAErM9TCikOmOoATmuIJCBLNF_SOzc5T34c';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-app-name.onrender.com';

const bot = new Telegraf(BOT_TOKEN);
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

// --- 3. TELEGRAM BOT LOGIC ---
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const userName = ctx.from.first_name || 'User';
  const referrerId = ctx.startPayload;

  // 1. Kiểm tra và tạo user mới nếu chưa có
  const { data: existingUser } = await supabase.from('users').select('*').eq('id', userId).single();
  if (!existingUser) {
    await supabase.from('users').insert({
      id: userId, name: userName, referrerId: referrerId || null,
      coins: 0, orders: 0, spins: 1, truckLevel: 1, adsToday: 0, smartlinksToday: 0, invitedCount: 0, validInvites: 0, isBanned: false
    });
    if (referrerId) {
      const { data: ref } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
      if (ref) {
        const newCount = (ref.invitedCount || 0) + 1;
        await supabase.from('users').update({ invitedCount: newCount }).eq('id', referrerId);
        await ctx.reply(`🎉 Chúc mừng! Bạn vừa mời thành công: ${userName} (ID: ${userId}).\n⚠️ Điều kiện để nhận thưởng: Người mời phải tham gia đủ 2 nhóm và xác nhận thành công.`);
      }
    }
  } else if (existingUser.isBanned) {
    return ctx.reply("❌ Tài khoản của bạn đã bị khóa. Liên hệ admin để được hỗ trợ.");
  }

  // 2. Kiểm tra tham gia nhóm
  try {
    const member1 = await ctx.telegram.getChatMember(GROUP_1_ID, userId);
    const member2 = await ctx.telegram.getChatMember(GROUP_2_ID, userId);
    const isMember1 = ['member', 'administrator', 'creator'].includes(member1.status);
    const isMember2 = ['member', 'administrator', 'creator'].includes(member2.status);

    if (isMember1 && isMember2) {
      if (referrerId && !existingUser.referrerCounted) {
        const { data: ref } = await supabase.from('users').select('validInvites').eq('id', referrerId).single();
        if (ref) {
          const newValid = (ref.validInvites || 0) + 1;
          await supabase.from('users').update({ validInvites: newValid }).eq('id', referrerId);
          await supabase.from('users').update({ referrerCounted: true }).eq('id', userId);
          await ctx.telegram.sendMessage(referrerId, `✅ Xác nhận thành công! ${userName} đã tham gia đủ nhóm. Bạn đã được cộng 1 lượt mời hợp lệ.`);
        }
      }
      
      ctx.reply(`Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`, {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]]
        }
      });
    } else {
      ctx.reply("⚠️ Bạn chưa tham gia đủ 2 nhóm bắt buộc!\nVui lòng tham gia 2 nhóm dưới đây:\n1. https://t.me/khohangkiemtien\n2. https://t.me/khohangchatkiemtien\n\nSau khi tham gia, hãy nhấn nút 'Kiểm Tra, Xác Nhận' bên dưới.", {
        reply_markup: {
          inline_keyboard: [[{ text: "✅ Kiểm Tra, Xác Nhận", callback_data: "check_groups" }]]
        }
      });
    }
  } catch (error) {
    console.error("Lỗi kiểm tra thành viên:", error);
    ctx.reply("⚠️ Lỗi kiểm tra thành viên. Vui lòng đảm bảo Bot đã là Admin của 2 nhóm và bạn đã tham gia nhóm.", {
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Kiểm Tra, Xác Nhận", callback_data: "check_groups" }]]
      }
    });
  }
});

// Xử lý nút bấm "Kiểm Tra, Xác Nhận"
bot.on('callback_query', async (ctx) => {
  if (ctx.callbackQuery.data === 'check_groups') {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    
    try {
      const member1 = await ctx.telegram.getChatMember(GROUP_1_ID, userId);
      const member2 = await ctx.telegram.getChatMember(GROUP_2_ID, userId);
      const isMember1 = ['member', 'administrator', 'creator'].includes(member1.status);
      const isMember2 = ['member', 'administrator', 'creator'].includes(member2.status);

      if (isMember1 && isMember2) {
        const { data: userData } = await supabase.from('users').select('referrerId, referrerCounted').eq('id', userId).single();
        if (userData && userData.referrerId && !userData.referrerCounted) {
          const { data: ref } = await supabase.from('users').select('validInvites').eq('id', userData.referrerId).single();
          if (ref) {
            const newValid = (ref.validInvites || 0) + 1;
            await supabase.from('users').update({ validInvites: newValid }).eq('id', userData.referrerId);
            await supabase.from('users').update({ referrerCounted: true }).eq('id', userId);
            await ctx.telegram.sendMessage(userData.referrerId, `✅ Xác nhận thành công! ${userName} đã tham gia đủ nhóm. Bạn đã được cộng 1 lượt mời hợp lệ.`);
          }
        }
        
        await ctx.editMessageText(`Chào mừng ${userName}! 🎉\nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`, {
          reply_markup: {
            inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]]
          }
        });
      } else {
        await ctx.answerCbQuery("⚠️ Bạn vẫn chưa tham gia đủ 2 nhóm!");
        await ctx.editMessageText("⚠️ Bạn vẫn chưa tham gia đủ 2 nhóm bắt buộc!\nVui lòng tham gia 2 nhóm dưới đây:\n1. https://t.me/khohangkiemtien\n2. https://t.me/khohangchatkiemtien\n\nSau khi tham gia, hãy nhấn nút 'Kiểm Tra, Xác Nhận' bên dưới.", {
          reply_markup: {
            inline_keyboard: [[{ text: "✅ Kiểm Tra, Xác Nhận", callback_data: "check_groups" }]]
          }
        });
      }
    } catch (error) {
      await ctx.answerCbQuery("⚠️ Lỗi kiểm tra!");
    }
  }
});

// --- 4. LỆNH ADMIN BOT ---
bot.command('thongke', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { data: pendingWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'pending');
  const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
  const { data: usersStats } = await supabase.from('users').select('adsToday, smartlinksToday');
  
  const totalPending = pendingWithdraws ? pendingWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  const totalSuccess = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  const totalAds = usersStats ? usersStats.reduce((sum, u) => sum + (u.adsToday || 0), 0) : 0;
  const totalSmartlinks = usersStats ? usersStats.reduce((sum, u) => sum + (u.smartlinksToday || 0), 0) : 0;

  ctx.reply(`📊 Thống kê chi tiết:\n👥 Tổng User: ${totalUsers || 0}\n📺 Tổng QC đã xem (hôm nay): ${totalAds}\n🔗 Tổng Smartlink đã ấn (hôm nay): ${totalSmartlinks}\n⏳ Tổng tiền chờ duyệt: ${totalPending} VNĐ\n✅ Tổng tiền đã duyệt: ${totalSuccess} VNĐ`);
});

bot.command('quantri', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
  const totalWithdrawn = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  ctx.reply(`📊 Thống kê nhanh:\n👥 Tổng User: ${totalUsers || 0}\n💰 Tổng tiền đã duyệt rút: ${totalWithdrawn} VNĐ`);
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
  const newCoins = (data?.coins || 0) + amount;
  await supabase.from('users').update({ coins: newCoins }).eq('id', targetId);
  ctx.reply(`✅ Đã cộng ${amount} coin cho ${targetId}`);
});

bot.command('trucoin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ Sử dụng: /trucoin <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('coins').eq('id', targetId).single();
  const newCoins = Math.max(0, (data?.coins || 0) - amount);
  await supabase.from('users').update({ coins: newCoins }).eq('id', targetId);
  ctx.reply(`✅ Đã trừ ${amount} coin của ${targetId}`);
});

bot.command('addspin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ Sử dụng: /addspin <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('spins').eq('id', targetId).single();
  const newSpins = (data?.spins || 0) + amount;
  await supabase.from('users').update({ spins: newSpins }).eq('id', targetId);
  ctx.reply(`✅ Đã cộng ${amount} lượt mở rương cho ${targetId}`);
});

bot.command('adddonhang', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ Sử dụng: /adddonhang <userId> <số_lượng>");
  const targetId = parts[1];
  const amount = parseInt(parts[2]);
  const { data } = await supabase.from('users').select('orders').eq('id', targetId).single();
  const newOrders = (data?.orders || 0) + amount;
  await supabase.from('users').update({ orders: newOrders }).eq('id', targetId);
  ctx.reply(`✅ Đã cộng ${amount} đơn hàng cho ${targetId}`);
});

bot.command('setlevel', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ Sử dụng: /setlevel <userId> <cấp_độ>");
  const targetId = parts[1];
  const level = parseInt(parts[2]);
  await supabase.from('users').update({ truckLevel: level }).eq('id', targetId);
  ctx.reply(`✅ Đã đặt cấp độ xe của ${targetId} lên ${level}`);
});

bot.command('resetdaily', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /resetdaily <userId>");
  await supabase.from('users').update({ adsToday: 0, smartlinksToday: 0 }).eq('id', targetId);
  ctx.reply(`✅ Đã reset nhiệm vụ hàng ngày cho ${targetId}`);
});

bot.command('deleteuser', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /deleteuser <userId>");
  await supabase.from('users').delete().eq('id', targetId);
  ctx.reply(`✅ Đã xóa vĩnh viễn user ${targetId}`);
});

bot.command('createcode', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 5) return ctx.reply("❌ Sử dụng: /createcode <mã> <loại> <số_lượng> <giới_hạn>");
  const [, code, type, amount, limit] = parts;
  const { error } = await supabase.from('giftcodes').insert({ code, rewardType: type, rewardAmount: parseInt(amount), limitUses: parseInt(limit), usedCount: 0 });
  if (error) return ctx.reply("❌ Lỗi: Mã code đã tồn tại hoặc dữ liệu không hợp lệ.");
  ctx.reply(`✅ Đã tạo code: \`${code}\` (Loại: ${type}, SL: ${amount}, Giới hạn: ${limit} lần)`, { parse_mode: 'Markdown' });
});

bot.command('listcodes', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { data, error } = await supabase.from('giftcodes').select('*');
  if (error) return ctx.reply("❌ Lỗi lấy danh sách code.");
  if (!data || data.length === 0) return ctx.reply("📭 Chưa có giftcode nào.");
  let msg = "📜 Danh sách Giftcode:\n";
  data.forEach(row => {
    msg += `\n🔹 Mã: \`${row.code}\`\n   Loại: ${row.rewardType} | SL: ${row.rewardAmount} | Đã dùng: ${row.usedCount}/${row.limitUses}\n`;
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
  
  const { data } = await supabase.from('users').select('id, name, orders, coins, truckLevel, ip').eq('id', targetId).single();
  if (!data) return ctx.reply("❌ Không tìm thấy user.");
  
  const { data: withdraws } = await supabase.from('withdrawals').select('amount').eq('userId', targetId).eq('status', 'success');
  const totalWithdrawn = withdraws ? withdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
  
  ctx.reply(`👤 Thông tin user:\nID: ${data.id}\nTên: ${data.name}\nĐơn hàng còn lại: ${data.orders}\nCoin còn lại: ${data.coins}\nLevel xe: ${data.truckLevel}\nIP: ${data.ip || 'Chưa có'}\nTổng tiền đã rút: ${totalWithdrawn} VNĐ`);
});

bot.command('donrutall', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const { data, error } = await supabase.from('withdrawals').select('id, userId, amount, method, status').eq('status', 'pending');
  if (error) return ctx.reply("❌ Lỗi lấy danh sách đơn rút.");
  if (!data || data.length === 0) return ctx.reply("📭 Không có đơn rút tiền nào đang chờ duyệt.");
  
  let msg = "📋 Danh sách đơn rút tiền CHỜ DUYỆT:\n";
  for (const w of data) {
    const { data: userData } = await supabase.from('users').select('ip').eq('id', w.userId).single();
    const ip = userData?.ip || 'Chưa có';
    const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
    msg += `\n🆔 ID User: ${w.userId}\n💳 Phương thức: ${w.method}\n💰 Số tiền: ${w.amount} VNĐ\n📦 Đơn hàng đã trừ: ${ordersDeducted}\n🌐 IP: ${ip}\n-------------------`;
  }
  
  if (msg.length > 4000) {
    msg = msg.substring(0, 4000) + "\n... (tin nhắn quá dài, hãy kiểm tra trên web admin)";
  }
  ctx.reply(msg);
});

bot.command('duyet', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const targetId = ctx.message.text.split(' ')[1];
  if (!targetId) return ctx.reply("❌ Sử dụng: /duyet <userId>");
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt cho user này.");
  
  for (const w of withdrawals) {
    await supabase.from('withdrawals').update({ status: 'success', reason: 'Đã duyệt bởi admin' }).eq('id', w.id);
  }
  
  ctx.reply(`✅ Đã duyệt thành công yêu cầu rút tiền cho ${targetId}`);
  await ctx.telegram.sendMessage(targetId, `✅ Yêu cầu rút tiền của bạn đã được DUYỆT thành công! Tiền sẽ sớm được chuyển vào tài khoản.`);
});

bot.command('huy', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) return ctx.reply("❌ Sử dụng: /huy <userId> <lý do>");
  const targetId = parts[1];
  const reason = parts.slice(2).join(' ');
  
  const { data: withdrawals } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
  if (!withdrawals || withdrawals.length === 0) return ctx.reply("❌ Không có yêu cầu rút tiền nào đang chờ duyệt cho user này.");
  
  let totalRefunded = 0;
  for (const w of withdrawals) {
    const ordersDeducted = Math.floor((w.amount || 0) / 1000) * 10000;
    await supabase.from('withdrawals').update({ status: 'rejected', reason: reason }).eq('id', w.id);
    
    const { data: userData } = await supabase.from('users').select('orders').eq('id', targetId).single();
    const newOrders = (userData?.orders || 0) + ordersDeducted;
    await supabase.from('users').update({ orders: newOrders }).eq('id', targetId);
    
    totalRefunded += ordersDeducted;
  }
  
  ctx.reply(`✅ Đã hủy yêu cầu rút tiền của ${targetId}. Lý do: ${reason}`);
  await ctx.telegram.sendMessage(targetId, `❌ Yêu cầu rút tiền của bạn đã bị HỦY.\nLý do: ${reason}\nSố đơn hàng đã được hoàn trả: ${totalRefunded}`);
});

bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const msg = ctx.message.text.substring(11);
  if (!msg) return ctx.reply("❌ Nhập tin nhắn cần gửi!");
  
  ctx.reply("⏳ Đang gửi tin nhắn... (Có thể mất vài phút)");
  const { data: users } = await supabase.from('users').select('id');
  let successCount = 0;
  for (const u of users) {
    try {
      await ctx.telegram.sendMessage(u.id, `📢 **THÔNG BÁO TỪ ADMIN:**\n\n${msg}`, { parse_mode: 'Markdown' });
      successCount++;
      await new Promise(r => setTimeout(r, 50)); // Delay tránh bị Telegram block spam
    } catch (e) {}
  }
  ctx.reply(`✅ Đã gửi thành công đến ${successCount} người dùng.`);
});

bot.launch();
console.log("✅ Bot is running...");

// --- 5. API CHO FRONTEND ---
app.post('/api/save-ip/:id', async (req, res) => {
  const { ip } = req.body;
  await supabase.from('users').update({ ip }).eq('id', req.params.id);
  res.json({ success: true });
});

app.get('/api/user/:id', async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: "User not found" });
  res.json(data);
});

app.post('/api/user/:id', async (req, res) => {
  const { error } = await supabase.from('users').update(req.body).eq('id', req.params.id);
  res.json({ success: !error });
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, method } = req.body;
  const { error } = await supabase.from('withdrawals').insert({ userId, amount, method, status: 'pending' });
  if (error) return res.status(500).json({ error: "Lỗi tạo yêu cầu rút tiền" });
  
  const { data: u } = await supabase.from('users').select('orders').eq('id', userId).single();
  const newOrders = Math.max(0, (u?.orders || 0) - 10000);
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
  if (gc.rewardType === 'coin') updateData.coins += gc.rewardAmount;
  else if (gc.rewardType === 'orders') updateData.orders += gc.rewardAmount;
  else if (gc.rewardType === 'spins') updateData.spins += gc.rewardAmount;
  
  await supabase.from('users').update(updateData).eq('id', userId);
  res.json({ success: true });
});

// --- 6. ADMIN WEB PANEL ---
app.get('/admin', async (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(403).send('<h1>Access Denied</h1>');
  
  const { data: users } = await supabase.from('users').select('*');
  const { data: withdrawals } = await supabase.from('withdrawals').select('*').order('createdAt', { ascending: false });
  
  const ipCounts = {};
  users.forEach(u => { if (u.ip) ipCounts[u.ip] = (ipCounts[u.ip] || 0) + 1; });
  
  let usersHtml = users.map(u => {
    const isDup = ipCounts[u.ip] > 1;
    return `<tr class="${isDup ? 'red-flag' : ''}">
        <td>${u.id}</td><td>${u.name}</td><td>${u.ip || 'N/A'} ${isDup ? '(TRÙNG IP!)' : ''}</td>
        <td>${u.coins}</td><td>${u.orders}</td><td>${u.truckLevel}</td><td>${u.validInvites}</td>
    </tr>`;
  }).join('');
  
  let withdrawsHtml = withdrawals.map(w => {
    let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : (w.status === 'rejected' ? 'status-rejected' : 'status-refunded'));
    let statusText = w.status === 'success' ? 'Đã duyệt' : (w.status === 'pending' ? 'Chờ duyệt' : (w.status === 'rejected' ? 'Lỗi: ' + (w.reason || '') : 'Hoàn trả'));
    return `<tr>
        <td>${w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td>
        <td class="${statusClass}">${statusText}</td><td>${w.reason || '-'}</td>
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
  <table><tr><th>ID</th><th>User ID</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Lý do</th></tr>${withdrawsHtml || '<tr><td colspan="6">Đang tải...</td></tr>'}</table>
  <h2>👥 Danh sách User (Nền đỏ = Trùng IP)</h2>
  <table><tr><th>ID</th><th>Tên</th><th>IP</th><th>Coin</th><th>Đơn hàng</th><th>Level</th><th>Mời hợp lệ</th></tr>${usersHtml || '<tr><td colspan="7">Đang tải...</td></tr>'}</table>
  </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
