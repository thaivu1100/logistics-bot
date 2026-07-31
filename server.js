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

// --- 1. CẤU HÌNH SUPABASE ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

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
        const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();

        if (!user) {
            await supabase.from('users').insert({
                id: userId, name: userName, referrerId: referrerId || null,
                coins: 0, orders: 0, spins: 1, truckLevel: 1, adsToday: 0, smartlinksToday: 0, invitedCount: 0, validInvites: 0, referralMilestones: []
            });
            if (referrerId) {
                const { data: ref } = await supabase.from('users').select('invitedCount').eq('id', referrerId).single();
                if (ref) {
                    await supabase.from('users').update({ invitedCount: (ref.invitedCount || 0) + 1 }).eq('id', referrerId);
                    bot.telegram.sendMessage(referrerId, `🎉 Chúc mừng! Bạn vừa mời thành công: ${userName}\n📊 Tổng số người đã mời: ${(ref.invitedCount || 0) + 1}. Hãy tiếp tục để nhận thưởng!`);
                }
            }
        }

        const m1 = await ctx.telegram.getChatMember(GROUP_1_ID, userId);
        const m2 = await ctx.telegram.getChatMember(GROUP_2_ID, userId);
        const isMember = ['member', 'administrator', 'creator'].includes(m1.status) && ['member', 'administrator', 'creator'].includes(m2.status);

        if (isMember) {
            if (referrerId) {
                const { data: ref } = await supabase.from('users').select('validInvites').eq('id', referrerId).single();
                if (ref) {
                    await supabase.from('users').update({ validInvites: (ref.validInvites || 0) + 1 }).eq('id', referrerId);
                }
            }
            ctx.reply(`Chào mừng ${userName}! 🎉\nXác minh thành công. Nhấn nút bên dưới để vào Mini App!`, {
                reply_markup: { inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]] }
            });
        } else {
            ctx.reply("⚠️ Bạn chưa tham gia đủ 2 nhóm bắt buộc!\nVui lòng tham gia và nhấn /start lại:\n1. https://t.me/khohangkiemtien\n2. https://t.me/khohangchatkiemtien");
        }
    } catch (err) {
        console.error("Lỗi bot start:", err);
        ctx.reply("⚠️ Có lỗi xảy ra, vui lòng thử lại sau!");
    }
});

// --- 4. LỆNH ADMIN BOT ---
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;
const checkAdmin = (ctx) => { if (!isAdmin(ctx)) return ctx.reply("❌ Bạn không có quyền!"); return true; };

bot.command('ban', async (ctx) => { if(!checkAdmin(ctx)) return; const id = ctx.message.text.split(' ')[1]; if(!id) return ctx.reply("❌ /ban <userId>"); await supabase.from('users').update({isBanned: true}).eq('id', id); ctx.reply(`✅ Đã ban ${id}`); });
bot.command('unban', async (ctx) => { if(!checkAdmin(ctx)) return; const id = ctx.message.text.split(' ')[1]; if(!id) return ctx.reply("❌ /unban <userId>"); await supabase.from('users').update({isBanned: false}).eq('id', id); ctx.reply(`✅ Đã unban ${id}`); });
bot.command('congcoin', async (ctx) => { if(!checkAdmin(ctx)) return; const [_, id, amount] = ctx.message.text.split(' '); const {data} = await supabase.from('users').select('coins').eq('id', id).single(); await supabase.from('users').update({coins: (data?.coins||0) + parseInt(amount)}).eq('id', id); ctx.reply(`✅ Đã cộng ${amount} coin`); });
bot.command('trucoin', async (ctx) => { if(!checkAdmin(ctx)) return; const [_, id, amount] = ctx.message.text.split(' '); const {data} = await supabase.from('users').select('coins').eq('id', id).single(); await supabase.from('users').update({coins: Math.max(0, (data?.coins||0) - parseInt(amount))}).eq('id', id); ctx.reply(`✅ Đã trừ ${amount} coin`); });
bot.command('addspin', async (ctx) => { if(!checkAdmin(ctx)) return; const [_, id, amount] = ctx.message.text.split(' '); const {data} = await supabase.from('users').select('spins').eq('id', id).single(); await supabase.from('users').update({spins: (data?.spins||0) + parseInt(amount)}).eq('id', id); ctx.reply(`✅ Đã cộng ${amount} lượt mở rương`); });
bot.command('addorders', async (ctx) => { if(!checkAdmin(ctx)) return; const [_, id, amount] = ctx.message.text.split(' '); const {data} = await supabase.from('users').select('orders').eq('id', id).single(); await supabase.from('users').update({orders: (data?.orders||0) + parseInt(amount)}).eq('id', id); ctx.reply(`✅ Đã cộng ${amount} đơn hàng`); });
bot.command('setlevel', async (ctx) => { if(!checkAdmin(ctx)) return; const [_, id, level] = ctx.message.text.split(' '); await supabase.from('users').update({truckLevel: parseInt(level)}).eq('id', id); ctx.reply(`✅ Đã đặt level ${level} cho ${id}`); });
bot.command('resetdaily', async (ctx) => { if(!checkAdmin(ctx)) return; const id = ctx.message.text.split(' ')[1]; await supabase.from('users').update({adsToday: 0, smartlinksToday: 0}).eq('id', id); ctx.reply(`✅ Đã reset daily cho ${id}`); });
bot.command('deleteuser', async (ctx) => { if(!checkAdmin(ctx)) return; const id = ctx.message.text.split(' ')[1]; await supabase.from('users').delete().eq('id', id); ctx.reply(`✅ Đã xóa user ${id}`); });
bot.command('createcode', async (ctx) => { 
    if(!checkAdmin(ctx)) return; 
    const parts = ctx.message.text.split(' ');
    if (parts.length < 5) return ctx.reply("❌ /createcode <mã> <loại> <số_lượng> <giới_hạn>");
    const [, code, type, amount, limit] = parts;
    const {error} = await supabase.from('giftcodes').insert({code, rewardType: type, rewardAmount: parseInt(amount), limitUses: parseInt(limit)});
    if (error) ctx.reply("❌ Lỗi: Code đã tồn tại."); else ctx.reply(`✅ Đã tạo code: \`${code}\``);
});
bot.command('listcodes', async (ctx) => {
    if(!checkAdmin(ctx)) return;
    const {data} = await supabase.from('giftcodes').select('*');
    if (!data || data.length === 0) return ctx.reply("📭 Chưa có code.");
    let msg = "📜 Danh sách Code:\n";
    data.forEach(r => msg += `\n🔹 Mã: \`${r.code}\` | Loại: ${r.rewardType} | SL: ${r.rewardAmount} | Đã dùng: ${r.usedCount}/${r.limitUses}\n`);
    ctx.reply(msg, { parse_mode: 'Markdown' });
});
bot.command('delcode', async (ctx) => {
    if(!checkAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    await supabase.from('giftcodes').delete().eq('code', code);
    ctx.reply(`✅ Đã xóa code: ${code}`);
});
bot.command('quantri', async (ctx) => {
    if(!checkAdmin(ctx)) return;
    const {count: totalUsers} = await supabase.from('users').select('*', {count: 'exact', head: true});
    const {data: withdrawals} = await supabase.from('withdrawals').select('amount').eq('status', 'success');
    const totalWithdrawn = withdrawals ? withdrawals.reduce((sum, w) => sum + w.amount, 0) : 0;
    ctx.reply(`📊 Thống kê nhanh:\n👥 Tổng User: ${totalUsers || 0}\n💰 Tổng tiền đã duyệt rút: ${totalWithdrawn} VNĐ`);
});
bot.command('broadcast', async (ctx) => {
    if(!checkAdmin(ctx)) return;
    const msg = ctx.message.text.substring(11);
    if (!msg) return ctx.reply("❌ Nhập tin nhắn cần gửi!");
    ctx.reply("⏳ Đang gửi tin nhắn... (Có thể mất vài phút)");
    const {data: users} = await supabase.from('users').select('id');
    let successCount = 0;
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.id, `📢 **THÔNG BÁO TỪ ADMIN:**\n\n${msg}`, { parse_mode: 'Markdown' });
            successCount++;
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {}
    }
    ctx.reply(`✅ Đã gửi thành công đến ${successCount} người dùng.`);
});
bot.command('checkID', async (ctx) => {
    if(!checkAdmin(ctx)) return;
    const id = ctx.message.text.split(' ')[1];
    const {data} = await supabase.from('users').select('id, name, orders, coins, truckLevel, ip').eq('id', id).single();
    if (!data) return ctx.reply("❌ Không tìm thấy user.");
    ctx.reply(`👤 Thông tin user:\nID: ${data.id}\nTên: ${data.name}\nĐơn hàng: ${data.orders}\nCoin: ${data.coins}\nLevel xe: ${data.truckLevel}\nIP: ${data.ip || 'Chưa có'}`);
});

bot.launch();
console.log("✅ Bot is running...");

// --- 5. API CHO FRONTEND ---
app.post('/api/save-ip/:id', async (req, res) => {
    await supabase.from('users').update({ ip: req.body.ip }).eq('id', req.params.id);
    res.json({ success: true });
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
    await supabase.from('users').update({ orders: Math.max(0, (u?.orders || 0) - 10000) }).eq('id', userId);
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

// --- 6. ADMIN WEB PANEL ---
app.post('/api/admin/update-withdrawal', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).json({error: "Access Denied"});
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
        const isDup = ipCounts[u.ip] > 1;
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
                        <option value="rejected" ${w.status==='rejected'?'selected':''}>Lỗi</option>
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
