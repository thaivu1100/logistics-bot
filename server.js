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

// --- 1. CẤU HÌNH SUPABASE (Lấy ở Giai đoạn 2) ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// --- 2. CẤU HÌNH BOT ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_1_ID = parseInt(process.env.GROUP_1_ID); 
const GROUP_2_ID = parseInt(process.env.GROUP_2_ID); 
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WEB_APP_URL = process.env.WEB_APP_URL;

const bot = new Telegraf(BOT_TOKEN);

// --- 3. TELEGRAM BOT LOGIC ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    const referrerId = ctx.startPayload;

    try {
        // Kiểm tra user có tồn tại chưa
        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();

        if (!user) {
            // Tạo user mới
            await supabase.from('users').insert({
                id: userId, name: userName, referrerId: referrerId || null,
                coins: 0, orders: 0, spins: 1, truckLevel: 1, adsToday: 0, smartlinksToday: 0, invitedCount: 0, validInvites: 0, referralMilestones: []
            });

            if (referrerId) {
                const { data: referrer } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
                if (referrer) {
                    const newCount = (referrer.invitedCount || 0) + 1;
                    await supabase.from('users').update({ invitedCount: newCount }).eq('id', referrerId);
                    bot.telegram.sendMessage(referrerId, `🎉 Chúc mừng! Bạn vừa mời thành công: ${userName}\n📊 Tổng số người đã mời: ${newCount}.`);
                }
            }
        }

        // Kiểm tra nhóm
        const member1 = await ctx.telegram.getChatMember(GROUP_1_ID, userId);
        const member2 = await ctx.telegram.getChatMember(GROUP_2_ID, userId);
        const isMember1 = ['member', 'administrator', 'creator'].includes(member1.status);
        const isMember2 = ['member', 'administrator', 'creator'].includes(member2.status);

        if (isMember1 && isMember2) {
            if (referrerId) {
                const { data: referrer } = await supabase.from('users').select('validInvites').eq('id', referrerId).single();
                if (referrer) {
                    await supabase.from('users').update({ validInvites: (referrer.validInvites || 0) + 1 }).eq('id', referrerId);
                }
            }
            ctx.reply(`Chào mừng ${userName}! 🎉\nXác minh thành công. Nhấn nút bên dưới để vào Mini App!`, {
                reply_markup: { inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] }
            });
        } else {
            ctx.reply("⚠️ Bạn chưa tham gia đủ 2 nhóm bắt buộc!\nVui lòng tham gia và nhấn /start lại:\n1. https://t.me/khohangkiemtien\n2. https://t.me/khohangchatkiemtien");
        }
    } catch (error) {
        console.error("Lỗi bot:", error);
        ctx.reply("⚠️ Có lỗi xảy ra, vui lòng thử lại sau!");
    }
});

// Các lệnh Admin Bot
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;
bot.command('ban', (ctx) => { if(!isAdmin(ctx)) return; const id = ctx.message.text.split(' ')[1]; supabase.from('users').update({isBanned: true}).eq('id', id).then(() => ctx.reply(`✅ Đã ban ${id}`)); });
bot.command('unban', (ctx) => { if(!isAdmin(ctx)) return; const id = ctx.message.text.split(' ')[1]; supabase.from('users').update({isBanned: false}).eq('id', id).then(() => ctx.reply(`✅ Đã unban ${id}`)); });
bot.command('congcoin', (ctx) => { if(!isAdmin(ctx)) return; const [_, id, amount] = ctx.message.text.split(' '); supabase.rpc('increment_field', { row_id: id, field_name: 'coins', amount: parseInt(amount) }).then(() => ctx.reply(`✅ Đã cộng ${amount} coin`)); });
// (Bạn có thể thêm các lệnh admin khác tương tự nếu cần)

bot.launch();
console.log("✅ Bot is running...");

// --- 4. API CHO FRONTEND ---
app.get('/api/verify/:id', async (req, res) => {
    try {
        const m1 = await bot.telegram.getChatMember(GROUP_1_ID, req.params.id);
        const m2 = await bot.telegram.getChatMember(GROUP_2_ID, req.params.id);
        res.json({ success: ['member', 'administrator', 'creator'].includes(m1.status) && ['member', 'administrator', 'creator'].includes(m2.status) });
    } catch { res.json({ success: false }); }
});

app.get('/api/user/:id', async (req, res) => {
    const { data } = await supabase.from('users').select('*').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

app.post('/api/user/:id', async (req, res) => {
    const { error } = await supabase.from('users').update(req.body).eq('id', req.params.id);
    res.json({ success: !error });
});

app.post('/api/withdraw', async (req, res) => {
    const { userId, amount, method } = req.body;
    await supabase.from('withdrawals').insert({ userId, amount, method, status: 'pending' });
    const { data: u } = await supabase.from('users').select('orders').eq('id', userId).single();
    await supabase.from('users').update({ orders: (u.orders || 0) - 10000 }).eq('id', userId);
    res.json({ success: true });
});

app.post('/api/redeem-code', async (req, res) => {
    const { userId, code } = req.body;
    const { data: gc } = await supabase.from('giftcodes').select('*').eq('code', code).single();
    if (!gc || gc.usedCount >= gc.limitUses) return res.status(400).json({ error: "Code không hợp lệ hoặc hết lượt" });

    await supabase.from('giftcodes').update({ usedCount: gc.usedCount + 1 }).eq('code', code);
    
    const { data: u } = await supabase.from('users').select('coins, orders, spins').eq('id', userId).single();
    let updateData = { ...u };
    if (gc.rewardType === 'coin') updateData.coins += gc.rewardAmount;
    else if (gc.rewardType === 'orders') updateData.orders += gc.rewardAmount;
    else if (gc.rewardType === 'spins') updateData.spins += gc.rewardAmount;
    
    await supabase.from('users').update(updateData).eq('id', userId);
    res.json({ success: true });
});

// --- 5. ADMIN WEB PANEL ---
app.get('/admin', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).send('<h1>Access Denied</h1>');
    
    const { data: users } = await supabase.from('users').select('*');
    const { data: withdrawals } = await supabase.from('withdrawals').select('*').order('createdAt', { ascending: false });

    // Xử lý trùng IP
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
        let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : 'status-rejected');
        let statusText = w.status === 'success' ? 'Đã duyệt' : (w.status === 'pending' ? 'Chờ duyệt' : 'Lỗi');
        return `<tr><td>${w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td><td class="${statusClass}">${statusText}</td><td>${w.reason || '-'}</td></tr>`;
    }).join('');

    res.send(`<!DOCTYPE html><html><head><title>Admin Panel</title><style>body{font-family:Arial;padding:20px;background:#f4f4f9;}table{width:100%;border-collapse:collapse;background:white;margin-top:20px;}th,td{border:1px solid #ddd;padding:10px;text-align:left;}th{background:#f2f2f2;}.red-flag{background:#ffcccc!important;color:red;font-weight:bold;}.status-pending{color:orange;font-weight:bold;}.status-success{color:green;font-weight:bold;}.status-rejected{color:red;font-weight:bold;}</style></head><body><h1>🛠️ Admin Panel</h1><h2>📥 Yêu cầu rút tiền</h2><table><tr><th>ID</th><th>User ID</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Lý do</th></tr>${withdrawsHtml || '<tr><td colspan="6">Đang tải...</td></tr>'}</table><h2>👥 Danh sách User (Đỏ = Trùng IP)</h2><table><tr><th>ID</th><th>Tên</th><th>IP</th><th>Coin</th><th>Đơn hàng</th><th>Level</th><th>Mời hợp lệ</th></tr>${usersHtml || '<tr><td colspan="7">Đang tải...</td></tr>'}</table></body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));