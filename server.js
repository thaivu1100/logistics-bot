const express = require('express');
const { Telegraf } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- CẤU HÌNH ---
const BOT_TOKEN = process.env.BOT_TOKEN || '8695768637:AAErM9TCikOmOoATmuIJCBLNF_SOzc5T34c';
const GROUP_1_ID = -1003980180530;
const GROUP_2_ID = -1003958491178;
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS || '8695768637:AAErM9TCikOmOoATmuIJCBLNF_SOzc5T34c';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-app-name.onrender.com';

const bot = new Telegraf(BOT_TOKEN);
const db = new sqlite3.Database('./database.sqlite');

// --- KHỞI TẠO DATABASE ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, 
        name TEXT, 
        coins INTEGER DEFAULT 0, 
        orders INTEGER DEFAULT 0, 
        spins INTEGER DEFAULT 1, 
        truckLevel INTEGER DEFAULT 1, 
        ip TEXT, 
        adsToday INTEGER DEFAULT 0, 
        smartlinksToday INTEGER DEFAULT 0, 
        isBanned INTEGER DEFAULT 0,
        referrerId TEXT, 
        invitedCount INTEGER DEFAULT 0, 
        validInvites INTEGER DEFAULT 0
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        userId TEXT, 
        amount INTEGER, 
        method TEXT, 
        status TEXT DEFAULT 'pending', 
        reason TEXT, 
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS giftcodes (
        code TEXT PRIMARY KEY, 
        rewardType TEXT, 
        rewardAmount INTEGER, 
        limitUses INTEGER, 
        usedCount INTEGER DEFAULT 0
    )`);
});

// --- TELEGRAM BOT LOGIC ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name || 'User';
    const referrerId = ctx.startPayload;

    db.get("SELECT * FROM users WHERE id = ?", [userId], async (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (id, name, referrerId) VALUES (?, ?, ?)`, [userId, userName, referrerId || null]);
            
            if (referrerId) {
                db.get("SELECT invitedCount FROM users WHERE id = ?", [referrerId], (err, referrer) => {
                    if (referrer) {
                        const newCount = (referrer.invitedCount || 0) + 1;
                        db.run("UPDATE users SET invitedCount = ? WHERE id = ?", [newCount, referrerId]);
                        bot.telegram.sendMessage(referrerId, `🎉 Chúc mừng! Bạn vừa mời thành công: ${userName}\n📊 Tổng số người đã mời: ${newCount}. Hãy tiếp tục để nhận thưởng!`);
                    }
                });
            }
        }

        try {
            const member1 = await ctx.telegram.getChatMember(GROUP_1_ID, userId);
            const member2 = await ctx.telegram.getChatMember(GROUP_2_ID, userId);
            
            const isMember1 = ['member', 'administrator', 'creator'].includes(member1.status);
            const isMember2 = ['member', 'administrator', 'creator'].includes(member2.status);
            
            if (isMember1 && isMember2) {
                if (referrerId) {
                    db.get("SELECT validInvites FROM users WHERE id = ?", [referrerId], (err, referrer) => {
                        if (referrer) {
                            const newValid = (referrer.validInvites || 0) + 1;
                            db.run("UPDATE users SET validInvites = ? WHERE id = ?", [newValid, referrerId]);
                        }
                    });
                }
                
                ctx.reply(`Chào mừng ${userName}! \nBạn đã xác minh thành công. Hãy nhấn nút bên dưới để vào Mini App!`, {
                    reply_markup: {
                        inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]]
                    }
                });
            } else {
                ctx.reply("⚠️ Bạn chưa tham gia đủ 2 nhóm bắt buộc!\nVui lòng tham gia 2 nhóm dưới đây và nhấn /start lại:\n1. https://t.me/khohangkiemtien\n2. https://t.me/khohangchatkiemtien");
            }
        } catch (error) {
            console.error("Lỗi kiểm tra thành viên:", error);
            ctx.reply("️ Lỗi kiểm tra thành viên. Vui lòng đảm bảo Bot đã là Admin của 2 nhóm và bạn đã tham gia nhóm.");
        }
    });
});

// --- ADMIN COMMANDS ---
const isAdmin = (ctx) => ctx.from.id === ADMIN_ID;

bot.command('ban', (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /ban <userId>");
    db.run("UPDATE users SET isBanned = 1 WHERE id = ?", [targetId], () => ctx.reply(`✅ Đã ban user ${targetId}`));
});

bot.command('unban', (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /unban <userId>");
    db.run("UPDATE users SET isBanned = 0 WHERE id = ?", [targetId], () => ctx.reply(`✅ Đã unban user ${targetId}`));
});

bot.command('congcoin', (ctx) => {
    if (!isAdmin(ctx)) return;
    const [_, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount) return ctx.reply("❌ Sử dụng: /congcoin <userId> <số_lượng>");
    db.run("UPDATE users SET coins = coins + ? WHERE id = ?", [parseInt(amount), targetId], () => ctx.reply(`✅ Đã cộng ${amount} coin cho ${targetId}`));
});

bot.command('trucoin', (ctx) => {
    if (!isAdmin(ctx)) return;
    const [_, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount) return ctx.reply("❌ Sử dụng: /trucoin <userId> <số_lượng>");
    db.run("UPDATE users SET coins = coins - ? WHERE id = ?", [parseInt(amount), targetId], () => ctx.reply(`✅ Đã trừ ${amount} coin của ${targetId}`));
});

bot.command('addspin', (ctx) => {
    if (!isAdmin(ctx)) return;
    const [_, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount) return ctx.reply("❌ Sử dụng: /addspin <userId> <số_lượng>");
    db.run("UPDATE users SET spins = spins + ? WHERE id = ?", [parseInt(amount), targetId], () => ctx.reply(`✅ Đã cộng ${amount} lượt mở rương cho ${targetId}`));
});

bot.command('addorders', (ctx) => {
    if (!isAdmin(ctx)) return;
    const [_, targetId, amount] = ctx.message.text.split(' ');
    if (!targetId || !amount) return ctx.reply("❌ Sử dụng: /addorders <userId> <số_lượng>");
    db.run("UPDATE users SET orders = orders + ? WHERE id = ?", [parseInt(amount), targetId], () => ctx.reply(`✅ Đã cộng ${amount} đơn hàng cho ${targetId}`));
});

bot.command('setlevel', (ctx) => {
    if (!isAdmin(ctx)) return;
    const [_, targetId, level] = ctx.message.text.split(' ');
    if (!targetId || !level) return ctx.reply(" Sử dụng: /setlevel <userId> <cấp_độ>");
    db.run("UPDATE users SET truckLevel = ? WHERE id = ?", [parseInt(level), targetId], () => ctx.reply(`✅ Đã đặt cấp độ xe của ${targetId} lên ${level}`));
});

bot.command('resetdaily', (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply(" Sử dụng: /resetdaily <userId>");
    db.run("UPDATE users SET adsToday = 0, smartlinksToday = 0 WHERE id = ?", [targetId], () => ctx.reply(`✅ Đã reset nhiệm vụ hàng ngày cho ${targetId}`));
});

bot.command('deleteuser', (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /deleteuser <userId>");
    db.run("DELETE FROM users WHERE id = ?", [targetId], () => ctx.reply(`✅ Đã xóa vĩnh viễn user ${targetId}`));
});

bot.command('createcode', (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 5) return ctx.reply(" Sử dụng: /createcode <mã> <loại> <số_lượng> <giới_hạn>");
    const [, code, type, amount, limit] = parts;
    
    db.run(`INSERT INTO giftcodes (code, rewardType, rewardAmount, limitUses) VALUES (?, ?, ?, ?)`, 
        [code, type, parseInt(amount), parseInt(limit)], 
        (err) => {
            if (err) return ctx.reply("❌ Lỗi: Mã code đã tồn tại hoặc dữ liệu không hợp lệ.");
            ctx.reply(`✅ Đã tạo code: \`${code}\` (Loại: ${type}, SL: ${amount}, Giới hạn: ${limit} lần)`, { parse_mode: 'Markdown' });
        }
    );
});

bot.command('listcodes', (ctx) => {
    if (!isAdmin(ctx)) return;
    db.all("SELECT * FROM giftcodes", [], (err, rows) => {
        if (err) return ctx.reply("❌ Lỗi lấy danh sách code.");
        if (rows.length === 0) return ctx.reply("📭 Chưa có giftcode nào.");
        
        let msg = "📜 Danh sách Giftcode:\n";
        rows.forEach(row => {
            msg += `\n🔹 Mã: \`${row.code}\`\n   Loại: ${row.rewardType} | SL: ${row.rewardAmount} | Đã dùng: ${row.usedCount}/${row.limitUses}\n`;
        });
        ctx.reply(msg, { parse_mode: 'Markdown' });
    });
});

bot.command('delcode', (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("❌ Sử dụng: /delcode <mã_code>");
    
    db.run("DELETE FROM giftcodes WHERE code = ?", [code], (err) => {
        if (err) return ctx.reply("❌ Lỗi: Không tìm thấy code.");
        ctx.reply(`✅ Đã xóa code: ${code}`);
    });
});

bot.command('quantri', (ctx) => {
    if (!isAdmin(ctx)) return;
    db.get("SELECT COUNT(*) as total FROM users", (err, row) => {
        db.get("SELECT SUM(amount) as totalWithdrawn FROM withdrawals WHERE status = 'success'", (err2, row2) => {
            ctx.reply(`📊 Thống kê nhanh:\n👥 Tổng User: ${row.total}\n💰 Tổng tiền đã duyệt rút: ${row2.totalWithdrawn || 0} VNĐ`);
        });
    });
});

bot.launch();
console.log("✅ Bot is running...");

// --- API CHO FRONTEND ---
app.post('/api/save-ip/:id', (req, res) => {
    const { ip } = req.body;
    db.run("UPDATE users SET ip = ? WHERE id = ?", [ip, req.params.id], (err) => {
        res.json({ success: !err });
    });
});

app.get('/api/user/:id', (req, res) => {
    db.get("SELECT * FROM users WHERE id = ?", [req.params.id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "User not found" });
        res.json(row);
    });
});

app.post('/api/user/:id', (req, res) => {
    const data = req.body;
    db.run(`UPDATE users SET coins=?, orders=?, spins=?, truckLevel=?, adsToday=?, smartlinksToday=?, invitedCount=?, validInvites=? WHERE id=?`, 
        [data.coins, data.orders, data.spins, data.truckLevel, data.adsToday, data.smartlinksToday, data.invitedCount, data.validInvites, req.params.id], 
        (err) => res.json({ success: !err })
    );
});

app.post('/api/withdraw', (req, res) => {
    const { userId, amount, method } = req.body;
    db.run(`INSERT INTO withdrawals (userId, amount, method) VALUES (?, ?, ?)`, [userId, amount, method], (err) => {
        if (err) return res.status(500).json({ error: "Lỗi tạo yêu cầu rút tiền" });
        db.run("UPDATE users SET orders = orders - 10000 WHERE id = ?", [userId]);
        res.json({ success: true });
    });
});

app.post('/api/redeem-code', (req, res) => {
    const { userId, code } = req.body;
    db.get("SELECT * FROM giftcodes WHERE code = ?", [code], (err, row) => {
        if (err || !row) return res.status(404).json({ error: "Mã code không hợp lệ hoặc không tồn tại." });
        if (row.usedCount >= row.limitUses) return res.status(400).json({ error: "Mã code đã hết lượt sử dụng." });

        db.run("UPDATE giftcodes SET usedCount = usedCount + 1 WHERE code = ?", [code]);

        let updateQuery = "";
        if (row.rewardType === 'coin') updateQuery = "UPDATE users SET coins = coins + ? WHERE id = ?";
        else if (row.rewardType === 'orders') updateQuery = "UPDATE users SET orders = orders + ? WHERE id = ?";
        else if (row.rewardType === 'spins') updateQuery = "UPDATE users SET spins = spins + ? WHERE id = ?";

        if (updateQuery) {
            db.run(updateQuery, [row.rewardAmount, userId], (err) => {
                if (err) return res.status(500).json({ error: "Lỗi cộng thưởng" });
                res.json({ success: true, rewardType: row.rewardType, rewardAmount: row.rewardAmount });
            });
        } else {
            res.status(400).json({ error: "Loại phần thưởng không hợp lệ" });
        }
    });
});

// --- ADMIN WEB PANEL ---
app.get('/admin', (req, res) => {
    if (req.query.pass !== ADMIN_PASS) {
        return res.status(403).send('<h1>Access Denied</h1>');
    }
    
    const adminHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Admin Panel - Logistics</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f9; }
            h1, h2 { color: #333; }
            table { width: 100%; border-collapse: collapse; background: white; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            th { background: #f2f2f2; }
            .red-flag { background: #ffcccc !important; color: red; font-weight: bold; }
            .status-pending { color: orange; font-weight: bold; }
            .status-success { color: green; font-weight: bold; }
            .status-rejected { color: red; font-weight: bold; }
        </style>
    </head>
    <body>
        <h1>🛠️ Admin Panel - Logistics App</h1>
        <h2>📥 Danh sách yêu cầu rút tiền</h2>
        <table>
            <tr><th>ID</th><th>User ID</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Lý do</th></tr>
            ${req.app.locals.withdrawalsRows || '<tr><td colspan="6">Đang tải...</td></tr>'}
        </table>
        <h2>👥 Danh sách User (Cảnh báo đỏ = Trùng IP)</h2>
        <table>
            <tr><th>ID</th><th>Tên</th><th>IP</th><th>Coin</th><th>Đơn hàng</th><th>Level</th><th>Mời hợp lệ</th></tr>
            ${req.app.locals.usersTableRows || '<tr><td colspan="7">Đang tải...</td></tr>'}
        </table>
    </body>
    </html>`;
    
    res.send(adminHtml);
});

// Middleware để lấy dữ liệu cho admin panel
app.use((req, res, next) => {
    if (req.path === '/admin' && req.query.pass === ADMIN_PASS) {
        db.all("SELECT * FROM users", [], (err, rows) => {
            const ipCounts = {};
            rows.forEach(row => {
                if (row.ip) ipCounts[row.ip] = (ipCounts[row.ip] || 0) + 1;
            });
            
            req.app.locals.usersTableRows = rows.map(row => {
                const isDuplicate = ipCounts[row.ip] > 1;
                return `<tr class="${isDuplicate ? 'red-flag' : ''}">
                    <td>${row.id}</td><td>${row.name}</td><td>${row.ip || 'N/A'} ${isDuplicate ? '(TRÙNG IP!)' : ''}</td>
                    <td>${row.coins}</td><td>${row.orders}</td><td>${row.truckLevel}</td><td>${row.validInvites}</td>
                </tr>`;
            }).join('');
            
            db.all("SELECT * FROM withdrawals ORDER BY createdAt DESC", [], (err2, wRows) => {
                req.app.locals.withdrawalsRows = wRows.map(w => {
                    let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : 'status-rejected');
                    let statusText = w.status === 'success' ? 'Đã duyệt' : (w.status === 'pending' ? 'Chờ duyệt' : 'Lỗi');
                    return `<tr>
                        <td>${w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td>
                        <td class="${statusClass}">${statusText}</td><td>${w.reason || '-'}</td>
                    </tr>`;
                }).join('');
                next();
            });
        });
    } else {
        next();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
