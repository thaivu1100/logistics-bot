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
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://logistics-bot-vyxa.onrender.com';

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
        totalAds INTEGER DEFAULT 0,
        totalSmartlinks INTEGER DEFAULT 0,
        isBanned INTEGER DEFAULT 0,
        referrerId TEXT, 
        invitedCount INTEGER DEFAULT 0, 
        validInvites INTEGER DEFAULT 0,
        inviteCounted INTEGER DEFAULT 0
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
        }
    });

    // Luôn gửi nút Mini App để user vào web tự xác minh
    ctx.reply(`Chào mừng ${userName}! \nHãy nhấn nút bên dưới để vào Mini App và xác minh tham gia nhóm!`, {
        reply_markup: {
            inline_keyboard: [[{ text: "🚀 Vào Mini App", web_app: { url: WEB_APP_URL } }]]
        }
    });
});

// API để Web App xác minh nhóm và cập nhật người mời
app.get('/api/verify/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const member1 = await bot.telegram.getChatMember(GROUP_1_ID, userId);
        const member2 = await bot.telegram.getChatMember(GROUP_2_ID, userId);
        const isMember1 = ['member', 'administrator', 'creator'].includes(member1.status);
        const isMember2 = ['member', 'administrator', 'creator'].includes(member2.status);

        if (isMember1 && isMember2) {
            // Kiểm tra và cập nhật người mời nếu chưa tính
            const userRow = await new Promise((resolve, reject) => {
                db.get("SELECT referrerId, inviteCounted FROM users WHERE id = ?", [userId], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });

            if (userRow && userRow.referrerId && !userRow.inviteCounted) {
                const newValid = await new Promise((resolve, reject) => {
                    db.get("SELECT validInvites FROM users WHERE id = ?", [userRow.referrerId], (err, row) => {
                        if (err) reject(err); else resolve(row.validInvites || 0);
                    });
                });
                const updatedValid = newValid + 1;
                db.run("UPDATE users SET validInvites = ?, inviteCounted = 1 WHERE id = ?", [updatedValid, userRow.referrerId]);
                
                // Thông báo cho người mời
                bot.telegram.sendMessage(userRow.referrerId, `🎉 Bạn đã mời thành công: ${userRow.name || userId}!\n📊 Tổng số bạn hợp lệ: ${updatedValid}. Tiếp tục mời để nhận thưởng!`).catch(e => console.log(e));
            }
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    } catch (e) {
        res.json({ success: false });
    }
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
    if (!targetId || !level) return ctx.reply("❌ Sử dụng: /setlevel <userId> <cấp_độ>");
    db.run("UPDATE users SET truckLevel = ? WHERE id = ?", [parseInt(level), targetId], () => ctx.reply(`✅ Đã đặt cấp độ xe của ${targetId} lên ${level}`));
});
bot.command('resetdaily', (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("❌ Sử dụng: /resetdaily <userId>");
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
    if (parts.length < 5) return ctx.reply("❌ Sử dụng: /createcode <mã> <loại> <số_lượng> <giới_hạn>");
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
        if (err) return ctx.reply(" Lỗi lấy danh sách code.");
        if (rows.length === 0) return ctx.reply(" Chưa có giftcode nào.");
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
bot.command('broadcast', (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.substring(11);
    if (!msg) return ctx.reply("❌ Nhập tin nhắn cần gửi!");
    ctx.reply("⏳ Đang gửi tin nhắn... (Có thể mất vài phút)");
    db.all("SELECT id FROM users", [], (err, rows) => {
        if (err) return ctx.reply("❌ Lỗi lấy danh sách user.");
        let successCount = 0;
        rows.forEach(u => {
            bot.telegram.sendMessage(u.id, `📢 **THÔNG BÁO TỪ ADMIN:**\n\n${msg}`, { parse_mode: 'Markdown' }).then(() => {
                successCount++;
            }).catch(e => {});
        });
        setTimeout(() => {
            ctx.reply(`✅ Đã gửi thành công đến ${successCount} người dùng.`);
        }, 5000);
    });
});
bot.command('checkID', (ctx) => {
    if (!isAdmin(ctx)) return;
    const id = ctx.message.text.split(' ')[1];
    db.get("SELECT * FROM users WHERE id = ?", [id], (err, row) => {
        if (err || !row) return ctx.reply("❌ Không tìm thấy user.");
        ctx.reply(`👤 Thông tin user:\nID: ${row.id}\nTên: ${row.name}\nĐơn hàng: ${row.orders}\nCoin: ${row.coins}\nLevel xe: ${row.truckLevel}\nIP: ${row.ip || 'Chưa có'}\nLượt mời hợp lệ: ${row.validInvites}`);
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
                res.json({ success: true });
            });
        } else {
            res.status(400).json({ error: "Loại phần thưởng không hợp lệ" });
        }
    });
});

// --- ADMIN WEB PANEL ---
app.post('/api/admin/update-withdrawal', (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).json({error: "Access Denied"});
    const { id, status, reason } = req.body;
    db.run("UPDATE withdrawals SET status = ?, reason = ? WHERE id = ?", [status, reason, id], (err) => {
        if (err) return res.status(500).json({ error: "Lỗi cập nhật" });
        res.json({ success: true });
    });
});

app.get('/admin', (req, res) => {
    if (req.query.pass !== ADMIN_PASS) {
        return res.status(403).send('<h1>Access Denied</h1>');
    }
    
    db.all("SELECT * FROM users", [], (err, users) => {
        db.all("SELECT * FROM withdrawals ORDER BY createdAt DESC", [], (err2, withdrawals) => {
            db.get("SELECT COUNT(*) as totalUsers, SUM(totalAds) as totalAds, SUM(totalSmartlinks) as totalSmartlinks FROM users", (err3, stats) => {
                db.get("SELECT SUM(amount) as totalWithdrawn FROM withdrawals WHERE status = 'success'", (err4, wStats) => {
                    db.get("SELECT SUM(amount) as totalPending FROM withdrawals WHERE status = 'pending'", (err5, pStats) => {
                        
                        const ipCounts = {};
                        users.forEach(u => { if (u.ip) ipCounts[u.ip] = (ipCounts[u.ip] || 0) + 1; });

                        let usersHtml = users.map(u => {
                            const isDup = ipCounts[u.ip] > 1;
                            return `<tr class="${isDup ? 'red-flag' : ''}">
                                <td>${u.id}</td><td>${u.name}</td><td>${u.orders}</td><td>${u.coins}</td><td>${u.truckLevel}</td><td>${u.ip || 'N/A'} ${isDup ? '(TRÙNG IP!)' : ''}</td><td>${u.validInvites}</td>
                            </tr>`;
                        }).join('');

                        let withdrawsHtml = withdrawals.map(w => {
                            const u = users.find(u => u.id === w.userId);
                            const isDup = u && u.ip && ipCounts[u.ip] > 1;
                            return `<tr class="${isDup ? 'red-flag' : ''}">
                                <td>${w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td>
                                <td>
                                    <select onchange="updateStatus(${w.id}, this.value, document.getElementById('reason-${w.id}').value)">
                                        <option value="pending" ${w.status==='pending'?'selected':''}>Chờ duyệt</option>
                                        <option value="success" ${w.status==='success'?'selected':''}>Đã duyệt</option>
                                        <option value="rejected" ${w.status==='rejected'?'selected':''}>Lỗi</option>
                                    </select>
                                </td>
                                <td><input type="text" id="reason-${w.id}" value="${w.reason || ''}" style="width:100px;"></td>
                                <td><button onclick="updateStatus(${w.id}, document.querySelector('#reason-${w.id}').parentElement.previousElementSibling.children[0].value, document.getElementById('reason-${w.id}').value)">Lưu</button></td>
                            </tr>`;
                        }).join('');

                        const html = `<!DOCTYPE html>
                        <html>
                        <head>
                            <title>Admin Panel - Logistics</title>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f9; }
                                h1, h2 { color: #333; }
                                .tabs { display: flex; margin-bottom: 20px; }
                                .tab { padding: 10px 20px; cursor: pointer; background: #ddd; margin-right: 5px; }
                                .tab.active { background: #fff; border-bottom: 2px solid #007bff; }
                                .tab-content { display: none; }
                                .tab-content.active { display: block; }
                                table { width: 100%; border-collapse: collapse; background: white; margin-top: 10px; }
                                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
                                th { background: #f2f2f2; }
                                .red-flag { background: #ffcccc !important; color: red; font-weight: bold; }
                                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
                                .stat-card { background: white; padding: 15px; border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
                                .stat-value { font-size: 24px; font-weight: bold; color: #007bff; }
                                .commands-list { background: white; padding: 15px; border-radius: 5px; }
                                .command-item { margin-bottom: 10px; padding: 5px; background: #f9f9f9; }
                            </style>
                            <script>
                                function switchTab(tabName) {
                                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                                    document.getElementById('tab-' + tabName).classList.add('active');
                                    document.getElementById('content-' + tabName).classList.add('active');
                                }
                                async function updateStatus(id, status, reason) {
                                    const res = await fetch('/api/admin/update-withdrawal?pass=${req.query.pass}', {
                                        method: 'POST',
                                        headers: {'Content-Type': 'application/json'},
                                        body: JSON.stringify({ id, status, reason })
                                    });
                                    if(res.ok) location.reload();
                                }
                            </script>
                        </head>
                        <body>
                            <h1>🛠️ Admin Panel - Logistics App</h1>
                            <div class="tabs">
                                <div class="tab active" onclick="switchTab('stats')">Thống kê</div>
                                <div class="tab" onclick="switchTab('users')">Người dùng</div>
                                <div class="tab" onclick="switchTab('commands')">Lệnh</div>
                                <div class="tab" onclick="switchTab('withdrawals')">Duyệt rút tiền</div>
                            </div>
                            
                            <div id="content-stats" class="tab-content active">
                                <div class="stats-grid">
                                    <div class="stat-card"><div>Tổng User</div><div class="stat-value">${stats.totalUsers || 0}</div></div>
                                    <div class="stat-card"><div>QC đã xem (Hôm nay)</div><div class="stat-value">${stats.totalAds || 0}</div></div>
                                    <div class="stat-card"><div>Smartlink đã ấn (Hôm nay)</div><div class="stat-value">${stats.totalSmartlinks || 0}</div></div>
                                    <div class="stat-card"><div>Tiền đã duyệt</div><div class="stat-value">${wStats.totalWithdrawn || 0} VNĐ</div></div>
                                    <div class="stat-card"><div>Tiền chờ duyệt</div><div class="stat-value">${pStats.totalPending || 0} VNĐ</div></div>
                                </div>
                            </div>
                            
                            <div id="content-users" class="tab-content">
                                <h2>👥 Danh sách User (Đỏ = Trùng IP)</h2>
                                <table><tr><th>ID</th><th>Tên</th><th>Đơn hàng</th><th>Coin</th><th>Level</th><th>IP</th><th>Mời hợp lệ</th></tr>${usersHtml || '<tr><td colspan="7">Không có dữ liệu</td></tr>'}</table>
                            </div>
                            
                            <div id="content-commands" class="tab-content">
                                <h2>📜 Danh sách Lệnh Admin</h2>
                                <div class="commands-list">
                                    <div class="command-item"><b>/ban &lt;userId&gt;</b> - Cấm user</div>
                                    <div class="command-item"><b>/unban &lt;userId&gt;</b> - Bỏ cấm user</div>
                                    <div class="command-item"><b>/congcoin &lt;userId&gt; &lt;số_lượng&gt;</b> - Cộng coin</div>
                                    <div class="command-item"><b>/trucoin &lt;userId&gt; &lt;số_lượng&gt;</b> - Trừ coin</div>
                                    <div class="command-item"><b>/addspin &lt;userId&gt; &lt;số_lượng&gt;</b> - Cộng lượt mở rương</div>
                                    <div class="command-item"><b>/addorders &lt;userId&gt; &lt;số_lượng&gt;</b> - Cộng đơn hàng</div>
                                    <div class="command-item"><b>/setlevel &lt;userId&gt; &lt;cấp_độ&gt;</b> - Đặt cấp xe</div>
                                    <div class="command-item"><b>/resetdaily &lt;userId&gt;</b> - Reset nhiệm vụ ngày</div>
                                    <div class="command-item"><b>/deleteuser &lt;userId&gt;</b> - Xóa user</div>
                                    <div class="command-item"><b>/createcode &lt;mã&gt; &lt;loại&gt; &lt;số_lượng&gt; &lt;giới_hạn&gt;</b> - Tạo code</div>
                                    <div class="command-item"><b>/listcodes</b> - Liệt kê code</div>
                                    <div class="command-item"><b>/delcode &lt;mã&gt;</b> - Xóa code</div>
                                    <div class="command-item"><b>/quantri</b> - Thống kê nhanh</div>
                                    <div class="command-item"><b>/broadcast &lt;tin nhắn&gt;</b> - Gửi thông báo</div>
                                    <div class="command-item"><b>/checkID &lt;userId&gt;</b> - Kiểm tra user</div>
                                </div>
                            </div>
                            
                            <div id="content-withdrawals" class="tab-content">
                                <h2>💸 Duyệt rút tiền (Đỏ = Trùng IP)</h2>
                                <table><tr><th>ID</th><th>User ID</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Lý do</th><th>Hành động</th></tr>${withdrawsHtml || '<tr><td colspan="7">Không có yêu cầu</td></tr>'}</table>
                            </div>
                        </body>
                        </html>`;
                        res.send(html);
                    });
                });
            });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
