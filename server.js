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
// FIX Lá»–I "1 Sá» USER Bá» Káº¸T PHIĂN Báº¢N CÅ¨/DEMO": trÆ°á»›c Ä‘Ă¢y express.static dĂ¹ng cache máº·c Ä‘á»‹nh cá»§a trĂ¬nh
// duyá»‡t/Telegram WebView cho file index.html, khiáº¿n sau khi deploy báº£n má»›i, má»™t sá»‘ thiáº¿t bá»‹ váº«n tiáº¿p tá»¥c
// Ä‘á»c báº£n HTML/JS Ä‘Ă£ lÆ°u cache cá»¥c bá»™ trÆ°á»›c Ä‘Ă³ thay vĂ¬ táº£i láº¡i. Ă‰p index.html luĂ´n "no-store" (khĂ´ng lÆ°u
// cache) Ä‘á»ƒ Má»ŒI thiáº¿t bá»‹ luĂ´n nháº­n Ä‘Ăºng 1 phiĂªn báº£n má»›i nháº¥t ngay khi má»Ÿ láº¡i Mini App, khĂ´ng cáº§n xoĂ¡ cache
// thá»§ cĂ´ng ná»¯a. CĂ¡c file tÄ©nh khĂ¡c (náº¿u cĂ³) váº«n cache bĂ¬nh thÆ°á»ng Ä‘á»ƒ khĂ´ng tá»‘n bÄƒng thĂ´ng.
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

// ==================== Cáº¦N CHáº Y 1 Láº¦N TRĂN SUPABASE (SQL Editor) TRÆ¯á»C KHI DEPLOY ====================
// 1) Báº£ng quáº£n lĂ½ admin phá»¥:
//    create table if not exists admins (id text primary key, addedBy text, createdAt timestamptz default now());
// 2) ThĂªm cá»™t "pháº¡m vi" + "ngÆ°á»i táº¡o" cho báº£ng giftcodes:
//    alter table giftcodes add column if not exists scope text default 'nguoidung';
//    alter table giftcodes add column if not exists createdBy text;
// 3) ThĂªm cá»™t snapshot pháº§n thÆ°á»Ÿng + thá»i gian + tĂªn cho báº£ng giftcode_redemptions
//    (Ä‘á»ƒ hiá»ƒn thá»‹ lá»‹ch sá»­ nháº­p code riĂªng tÆ° cá»§a tá»«ng user vĂ  cho /thuhoi, /listnguoinhapcode hoáº¡t Ä‘á»™ng):
//    alter table giftcode_redemptions add column if not exists rewardCoin integer default 0;
//    alter table giftcode_redemptions add column if not exists rewardOrders integer default 0;
//    alter table giftcode_redemptions add column if not exists rewardSpins integer default 0;
//    alter table giftcode_redemptions add column if not exists userName text;
//    alter table giftcode_redemptions add column if not exists createdAt timestamptz default now();
// =======================================================================================================

// --- Cáº¤U HĂŒNH ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ==================== TÆ¯Æ NG THĂCH SCHEMA SUPABASE (CHá»NG Máº¤T Dá»® LIá»†U) ====================
// NGUYĂN NHĂ‚N Lá»–I 42703 ("column users.quizDate does not exist", "users.weeklyAdsCount does not exist"...):
// code ghi/Ä‘á»c má»™t sá»‘ cá»™t mĂ  báº£ng "users" trĂªn Supabase tháº­t KHĂ”NG cĂ³. Postgres tá»« chá»‘i TOĂ€N Bá»˜ cĂ¢u lá»‡nh
// Ä‘Ă³, nĂªn chá»‰ cáº§n 1 cá»™t thiáº¿u lĂ  máº¥t luĂ´n cáº£ láº§n lÆ°u coin/Ä‘Æ¡n hĂ ng/nhiá»‡m vá»¥ -> chĂ­nh lĂ  lá»—i "máº¥t dá»¯ liá»‡u".
// CĂCH Sá»¬A: lĂºc cháº¡y, Ä‘á»c danh sĂ¡ch cá»™t THáº¬T cá»§a báº£ng users; cá»™t nĂ o cĂ³ tháº­t thĂ¬ ghi tháº³ng vĂ o users,
// cá»™t nĂ o chÆ°a cĂ³ thĂ¬ lÆ°u an toĂ n vĂ o báº£ng app_settings (khĂ³a user_extra_state) vĂ  ghĂ©p láº¡i khi Ä‘á»c user.
// Nhá» váº­y KHĂ”NG máº¥t báº¥t ká»³ dá»¯ liá»‡u nĂ o vĂ  KHĂ”NG cáº§n cháº¡y migration SQL nĂ o trĂªn Supabase.
// ==================== Má»C NGĂ€Y THEO GIá»œ VIá»†T NAM (0h00) ====================
// Má»i giá»›i háº¡n theo ngĂ y (nhiá»‡m vá»¥, cĂ¢u há»i, SmartLink, rĂºt tiá»n) Ä‘á»u tĂ­nh theo 0h00 giá» Viá»‡t Nam,
// KHĂ”NG phá»¥ thuá»™c giá» mĂ¡y chá»§ hay giá» Ä‘iá»‡n thoáº¡i (trÆ°á»›c Ä‘Ă¢y dĂ¹ng giá» thiáº¿t bá»‹ nĂªn chá»‰nh giá» mĂ¡y
// hoáº·c táº£i láº¡i app lĂ  cĂ³ thĂªm lÆ°á»£t).
function vietnamDayKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}
function isCurrentVietnamDay(value) {
    if (!value) return false;
    const today = vietnamDayKey();
    if (value === today) return true;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && vietnamDayKey(parsed) === today;
}
function vietnamDayStartIso(date = new Date()) {
    return `${vietnamDayKey(date)}T00:00:00+07:00`;
}
function vietnamTimeText(date = new Date()) {
    const dayPart = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(date);
    const timePart = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
    return `${dayPart} ${timePart}`;
}
// CĂ¡c field Ä‘Æ°á»£c Ä‘Æ°a vá» 0 khi sang ngĂ y má»›i (0h00 giá» Viá»‡t Nam)
function dailyResetFields() {
    return {
        adsToday: 0, smartlinksToday: 0, bonusAdsToday: 0,
        deliveryCount: 0, smartlinkCount: 0, usedSmartlinks: [],
        spinAdCount: 0, spinAdProgress: 0, chestOpensToday: 0,
        quizDate: vietnamDayKey(), quizFreeUsed: false, quizAdUnlocked: 0, quizUsedIds: [],
        dailyTasks: null, allTasksClaimed: false, withdrawRemain: 1,
        lastResetDate: vietnamDayKey()
    };
}

const USER_EXTRA_KEY = 'user_extra_state';
const CORE_USER_COLUMNS = ['id', 'name', 'coins', 'orders', 'spins', 'truckLevel', 'isBanned', 'walletUpdatedAt'];
let userColumnsCache = null;
let userColumnsAt = 0;
async function getUserColumns(forceRefresh = false) {
    if (!forceRefresh && userColumnsCache && Date.now() - userColumnsAt < 5 * 60 * 1000) return userColumnsCache;
    try {
        const { data, error } = await supabase.from('users').select('*').limit(1);
        if (error) throw error;
        if (Array.isArray(data) && data.length > 0) {
            userColumnsCache = new Set(Object.keys(data[0]));
            userColumnsAt = Date.now();
            return userColumnsCache;
        }
    } catch (e) {
        console.error('KhĂ´ng Ä‘á»c Ä‘Æ°á»£c danh sĂ¡ch cá»™t báº£ng users:', e.message);
    }
    if (!userColumnsCache) { userColumnsCache = new Set(CORE_USER_COLUMNS); userColumnsAt = Date.now(); }
    return userColumnsCache;
}

// Bá»™ nhá»› Ä‘á»‡m cho pháº§n dá»¯ liá»‡u lÆ°u ngoĂ i báº£ng users: Ä‘á»c tá»©c thĂ¬, ghi gá»™p má»—i 3 giĂ¢y Ä‘á»ƒ khĂ´ng
// náº·ng database vĂ  khĂ´ng cĂ³ 2 request nĂ o ghi Ä‘Ă¨ máº¥t dá»¯ liá»‡u cá»§a nhau.
let userExtraCache = null;
let userExtraDirty = false;
let userExtraFlushTimer = null;
async function loadUserExtraAll() {
    try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', USER_EXTRA_KEY).maybeSingle();
        if (error) throw error;
        const value = data?.value;
        if (!value) return {};
        if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return {}; } }
        return (typeof value === 'object' && !Array.isArray(value)) ? value : {};
    } catch (e) {
        console.error('KhĂ´ng Ä‘á»c Ä‘Æ°á»£c user_extra_state:', e.message);
        return {};
    }
}
async function getUserExtraAll() {
    if (!userExtraCache) userExtraCache = await loadUserExtraAll();
    return userExtraCache;
}
async function flushUserExtra() {
    if (!userExtraDirty || !userExtraCache) return;
    userExtraDirty = false;
    const { error } = await supabase.from('app_settings')
        .upsert({ key: USER_EXTRA_KEY, value: userExtraCache }, { onConflict: 'key' });
    if (error) {
        userExtraDirty = true; // Giá»¯ láº¡i cá» Ä‘á»ƒ láº§n ghi sau thá»­ láº¡i, khĂ´ng máº¥t dá»¯ liá»‡u
        console.error('KhĂ´ng lÆ°u Ä‘Æ°á»£c user_extra_state:', error.message);
    }
}
function scheduleUserExtraFlush() {
    if (userExtraFlushTimer) return;
    userExtraFlushTimer = setTimeout(() => {
        userExtraFlushTimer = null;
        flushUserExtra().catch(() => {});
    }, 3000);
}
async function getUserExtra(userId) {
    const all = await getUserExtraAll();
    return all[String(userId)] || {};
}
async function saveUserExtra(userId, values) {
    const all = await getUserExtraAll();
    const key = String(userId);
    all[key] = { ...(all[key] || {}), ...values };
    userExtraDirty = true;
    scheduleUserExtraFlush();
}
async function saveUserExtraAll(all) {
    userExtraCache = all || {};
    userExtraDirty = true;
    return flushUserExtra();
}
// Náº¿u má»™t field Ä‘Ă£ Ä‘Æ°á»£c ghi vĂ o cá»™t tháº­t thĂ¬ xoĂ¡ báº£n sao cÅ© trong kho lÆ°u táº¡m, trĂ¡nh trÆ°á»ng há»£p
// sau nĂ y thĂªm cá»™t vĂ o Supabase mĂ  váº«n Ä‘á»c nháº§m giĂ¡ trá»‹ cÅ©.
async function pruneUserExtra(userId, keys) {
    if (!keys || keys.length === 0) return;
    const all = await getUserExtraAll();
    const entry = all[String(userId)];
    if (!entry) return;
    let changed = false;
    keys.forEach(k => { if (k in entry) { delete entry[k]; changed = true; } });
    if (changed) { userExtraDirty = true; scheduleUserExtraFlush(); }
}
async function clearUserExtra(userId) {
    if (userId === null) return saveUserExtraAll({});
    const all = await getUserExtraAll();
    delete all[String(userId)];
    userExtraDirty = true;
    return flushUserExtra();
}
setInterval(() => { flushUserExtra().catch(() => {}); }, 15000);
// Render gá»­i SIGTERM trÆ°á»›c khi táº¯t instance cÅ© -> ghi ná»‘t dá»¯ liá»‡u cĂ²n trong bá»™ Ä‘á»‡m Ä‘á»ƒ khĂ´ng máº¥t.
process.on('SIGTERM', () => { flushUserExtra().catch(() => {}); });

// Láº¥y tĂªn cá»™t bá»‹ thiáº¿u tá»« thĂ´ng bĂ¡o lá»—i cá»§a Postgres/PostgREST (42703 hoáº·c PGRST204)
function extractMissingColumn(error) {
    const text = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
    const m = text.match(/find the ['"]([A-Za-z_][A-Za-z0-9_]*)['"] column/i)
        || text.match(/column ['"]?(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)['"]? (?:of|does)/i);
    return m ? m[1] : null;
}
// Ghi 1 dĂ²ng vĂ o báº£ng báº¥t ká»³: náº¿u báº£ng tháº­t thiáº¿u cá»™t nĂ o thĂ¬ bá» cá»™t Ä‘Ă³ rá»“i ghi láº¡i, Ä‘á»ƒ 1 cá»™t thiáº¿u
// khĂ´ng lĂ m máº¥t TOĂ€N Bá»˜ báº£n ghi (Ä‘Æ¡n rĂºt tiá»n, lá»‹ch sá»­ giao dá»‹ch...).
async function insertRowSafe(table, row) {
    const payload = { ...row };
    for (let i = 0; i < 12; i++) {
        const { error } = await supabase.from(table).insert(payload);
        if (!error) return { error: null };
        const missing = extractMissingColumn(error);
        if (!missing || !(missing in payload)) return { error };
        console.warn(`Báº£ng ${table} chÆ°a cĂ³ cá»™t "${missing}" -> bá» qua cá»™t nĂ y khi ghi.`);
        delete payload[missing];
    }
    return { error: { message: `KhĂ´ng ghi Ä‘Æ°á»£c dá»¯ liá»‡u vĂ o báº£ng ${table}` } };
}
async function splitUserFields(values = {}) {
    const cols = await getUserColumns();
    const known = {}, extra = {};
    Object.entries(values || {}).forEach(([k, v]) => { (cols.has(k) ? known : extra)[k] = v; });
    return { known, extra };
}
// LÆ°u dá»¯ liá»‡u user an toĂ n vá»›i má»i schema: cá»™t cĂ³ tháº­t -> báº£ng users, cá»™t chÆ°a cĂ³ -> app_settings.
async function saveUserFields(userId, values = {}) {
    let { known, extra } = await splitUserFields(values);
    if (Object.keys(known).length > 0) {
        let { error } = await supabase.from('users').update(known).eq('id', userId);
        if (error && error.code === '42703') {
            // Schema vá»«a thay Ä‘á»•i (hoáº·c cache Ä‘Ă£ cÅ©) -> Ä‘á»c láº¡i danh sĂ¡ch cá»™t rá»“i thá»­ láº¡i 1 láº§n
            await getUserColumns(true);
            ({ known, extra } = await splitUserFields(values));
            error = Object.keys(known).length > 0
                ? (await supabase.from('users').update(known).eq('id', userId)).error
                : null;
        }
        if (error) return { error };
        await pruneUserExtra(userId, Object.keys(known));
    }
    if (Object.keys(extra).length > 0) await saveUserExtra(userId, extra);
    return { error: null };
}
// Äá»c user Ä‘áº§y Ä‘á»§ = dá»¯ liá»‡u báº£ng users + cĂ¡c field Ä‘ang lÆ°u táº¡m trong app_settings
async function readUserRow(userId) {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (error || !data) return { data: null, error: error || null };
    const extra = await getUserExtra(userId);
    return { data: { ...extra, ...data }, error: null };
}
getUserColumns().then(cols => console.log(`âœ… ÄĂ£ Ä‘á»c schema báº£ng users: ${cols.size} cá»™t`)).catch(() => {});

const BOT_TOKEN = process.env.BOT_TOKEN;
const GROUP_1_ID = parseInt(process.env.GROUP_1_ID); // KĂªnh thĂ´ng bĂ¡o
const GROUP_2_ID = parseInt(process.env.GROUP_2_ID); // NhĂ³m chat
const ADMIN_ID = 6327666718;
const ADMIN_PASS = process.env.ADMIN_PASS;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://logistics-bot-vyxa.onrender.com';

const bot = new Telegraf(BOT_TOKEN);

// ==================== Há»† THá»NG Cáº¤P Äá»˜ VĂ€ CĂ”NG THá»¨C (LEVEL 1-500) ====================
/**
 * TĂ­nh toĂ¡n táº¥t cáº£ thá»‘ng kĂª xe theo cáº¥p Ä‘á»™ (cĂ´ng thá»©c LOCKED)
 * Level 1-500 tuĂ¢n theo cĂ´ng thá»©c chĂ­nh xĂ¡c:
 * - Thá»i gian: 30 phĂºt á»Ÿ cáº¥p 1, giáº£m Ä‘á»u xuá»‘ng Ä‘Ăºng 2 phĂºt á»Ÿ cáº¥p 500
 * - Sáº£n pháº©m/láº§n: tÄƒng Ä‘á»u tá»« 100, tá»‘i Ä‘a Ä‘Ăºng 5.000 Ä‘Æ¡n á»Ÿ cáº¥p 500
 * - Kho max: báº±ng Ä‘Ăºng 1 máº» hĂ ng
 * - Chi phĂ­ nĂ¢ng cáº¥p: 300 + (level-1)*300 coin (tá»•ng ~37,4 triá»‡u coin Ä‘á»ƒ Ä‘áº¡t cáº¥p 500)
 * - Láº§n giao/ngĂ y: floor(1440 / thá»i gian)
 * - ÄÆ¡n hĂ ng/ngĂ y: láº§n_giao * sáº£n_pháº©m
 */
const MAX_TRUCK_LEVEL = 500;
function calculateLevelStats(level) {
    level = Math.max(1, Math.min(MAX_TRUCK_LEVEL, parseInt(level) || 1));

    // Thá»i gian sáº£n xuáº¥t giáº£m Ä‘á»u tá»« 30 phĂºt (cáº¥p 1) xuá»‘ng ÄĂNG 2 phĂºt á»Ÿ cáº¥p 500, khĂ´ng tháº¥p hÆ¡n 2 phĂºt.
    const productionMinutes = level >= MAX_TRUCK_LEVEL
        ? 2
        : Math.max(2, 30 * Math.pow(2 / 30, (level - 1) / (MAX_TRUCK_LEVEL - 1)));
    const productsPerDelivery = Math.round(100 + (level - 1) * (4900 / (MAX_TRUCK_LEVEL - 1))); // Cáº¥p 500: Ä‘Ăºng 5.000 Ä‘Æ¡n
    const maxWarehouse = productsPerDelivery;             // Kho chá»©a Ä‘Ăºng 1 máº» hĂ ng
    // Chi phĂ­ nĂ¢ng cáº¥p tÄƒng Ä‘á»u: cáº¥p 1->2 háº¿t 300 coin, cáº¥p 499->500 háº¿t 149.700 coin
    // (tá»•ng ~37 triá»‡u coin) -> lĂªn cáº¥p 500 khĂ¡ khĂ³, pháº£i chÆ¡i lĂ¢u dĂ i chá»© khĂ´ng Ä‘áº¡t trong vĂ i ngĂ y.
    const upgradeCost = level < MAX_TRUCK_LEVEL ? 300 + (level - 1) * 300 : 0;
    const deliveriesPerDay = Math.floor(1440 / productionMinutes);
    const ordersPerDay = deliveriesPerDay * productsPerDelivery;
    
    return {
        level,
        maxLevel: MAX_TRUCK_LEVEL,
        productionTime: Math.round(productionMinutes * 100) / 100,
        productionMs: Math.round(productionMinutes * 60 * 1000),
        productsPerDelivery,
        maxWarehouse,
        upgradeCost,
        deliveriesPerDay,
        ordersPerDay
    };
}

// ==================== Há»† THá»NG ADMIN PHá»¤ (SUB-ADMIN) ====================
// ADMIN_ID (hardcode) luĂ´n lĂ  "Admin chĂ­nh" - cĂ³ toĂ n quyá»n, khĂ´ng ai xoĂ¡ Ä‘Æ°á»£c.
// Admin chĂ­nh cĂ³ thá»ƒ phong thĂªm "admin phá»¥" báº±ng /addadmin <ID>, admin phá»¥ dĂ¹ng Ä‘Æ°á»£c Táº¤T Cáº¢ lá»‡nh admin
// (trá»« /addadmin vĂ  /xoaadmin - 2 lá»‡nh nĂ y CHá»ˆ Admin chĂ­nh má»›i dĂ¹ng Ä‘Æ°á»£c, Ä‘á»ƒ trĂ¡nh admin phá»¥ tá»± phong
// thĂªm admin khĂ¡c hoáº·c xoĂ¡ quyá»n láº«n nhau). Danh sĂ¡ch admin phá»¥ lÆ°u á»Ÿ báº£ng "admins" trĂªn Supabase Ä‘á»ƒ
// khĂ´ng bá»‹ máº¥t khi Render restart, Ä‘á»“ng thá»i cache vĂ o bá»™ nhá»› (Set) Ä‘á»ƒ kiá»ƒm tra quyá»n cá»±c nhanh má»—i lá»‡nh.
// Cáº¦N Táº O Báº¢NG NĂ€Y 1 Láº¦N TRĂN SUPABASE (SQL Editor):
//   create table if not exists admins (id text primary key, addedBy text, createdAt timestamptz default now());
let subAdminIds = new Set();

async function loadAdmins() {
    try {
        const { data, error } = await supabase.from('admins').select('id');
        if (error) throw error;
        subAdminIds = new Set((data || []).map(r => String(r.id)));
    } catch (e) {
        console.error('Lá»—i táº£i danh sĂ¡ch admin phá»¥ (báº£ng "admins" cĂ³ thá»ƒ chÆ°a tá»“n táº¡i):', e.message);
        subAdminIds = new Set();
    }
}
loadAdmins();

// Admin chĂ­nh: chá»‰ Ä‘Ăºng 1 ID hardcode, khĂ´ng thá»ƒ bá»‹ xoĂ¡ quyá»n.
const isMainAdmin = (ctx) => String(ctx.from?.id || '') === String(ADMIN_ID);
// Admin (chĂ­nh hoáº·c phá»¥): dĂ¹ng cho háº§u háº¿t lá»‡nh quáº£n trá»‹.
const isAdmin = (ctx) => String(ctx.from?.id || '') === String(ADMIN_ID) || subAdminIds.has(String(ctx.from?.id || ''));

// ==================== KHOĂ BOT / MINI APP (Báº¢O TRĂŒ) ====================
// Tráº¡ng thĂ¡i khoĂ¡ Ä‘Æ°á»£c lÆ°u á»Ÿ báº£ng "app_settings" (key/value) Ä‘á»ƒ KHĂ”NG bá»‹ máº¥t khi Render restart/deploy láº¡i
// server (khĂ¡c vá»›i biáº¿n in-memory thĂ´ng thÆ°á»ng sáº½ tá»± reset vá» false má»—i láº§n khá»Ÿi Ä‘á»™ng láº¡i).
// Cáº¦N Táº O Báº¢NG NĂ€Y 1 Láº¦N TRĂN SUPABASE (SQL Editor):
//   create table if not exists app_settings (key text primary key, value jsonb);
let BOT_LOCKED = false;
const MAINTENANCE_MESSAGE = "đŸ”’ Bot Äang Bá»‹ KhoĂ¡ Äá»ƒ Báº£o TrĂ¬. Vui LĂ²ng Thá»­ Láº¡i Sau!!";

async function loadBotLockState() {
    try {
        const { data } = await supabase.from('app_settings').select('value').eq('key', 'bot_locked').single();
        BOT_LOCKED = data?.value === true;
    } catch (e) {
        BOT_LOCKED = false; // Báº£ng chÆ°a tá»“n táº¡i hoáº·c chÆ°a cĂ³ dĂ²ng nĂ o -> máº·c Ä‘á»‹nh KHĂ”NG khoĂ¡
    }
}
loadBotLockState();

async function setBotLocked(locked) {
    BOT_LOCKED = locked;
    try {
        await supabase.from('app_settings').upsert({ key: 'bot_locked', value: locked });
    } catch (e) {
        console.error('Lá»—i lÆ°u tráº¡ng thĂ¡i khoĂ¡ bot (Ä‘Ă£ Ă¡p dá»¥ng táº¡m thá»i trong bá»™ nhá»›):', e.message);
    }
}

// TÄƒng 1 field sá»‘ nguyĂªn trĂªn báº£ng "users" 1 cĂ¡ch AN TOĂ€N (atomic) báº±ng compare-and-swap cĂ³ thá»­ láº¡i.
// FIX Lá»–I "Sá» Báº N ÄĂƒ Má»œI THáº¤P HÆ N Sá» Báº N Há»¢P Lá»†": trÆ°á»›c Ä‘Ă¢y invitedCount Ä‘Æ°á»£c tÄƒng báº±ng cĂ¡ch Äá»ŒC rá»“i GHI
// (Ä‘á»c invitedCount hiá»‡n táº¡i, +1, rá»“i update) â€” náº¿u 2 ngÆ°á»i Ä‘Æ°á»£c má»i cĂ¹ng báº¥m /start gáº§n nhÆ° Ä‘á»“ng thá»i cho
// CĂ™NG 1 ngÆ°á»i má»i, cáº£ 2 lá»‡nh gá»i cĂ³ thá»ƒ cĂ¹ng Ä‘á»c Ä‘Æ°á»£c giĂ¡ trá»‹ invitedCount CÅ¨ trÆ°á»›c khi lá»‡nh kia ká»‹p ghi
// xong, khiáº¿n 1 trong 2 lÆ°á»£t má»i bá»‹ "máº¥t" (invitedCount chá»‰ tÄƒng 1 thay vĂ¬ 2) trong khi validInvites (sá»‘
// báº¡n há»£p lá»‡) váº«n Ä‘Æ°á»£c tĂ­nh Ä‘Ăºng cho cáº£ 2 ngÆ°á»i á»Ÿ bÆ°á»›c xĂ¡c nháº­n sau nĂ y -> dáº«n Ä‘áº¿n invitedCount < validInvites
// (vĂ´ lĂ½ vĂ¬ pháº£i má»i Ä‘Æ°á»£c thĂ¬ má»›i cĂ³ thá»ƒ trá»Ÿ thĂ nh há»£p lá»‡). CĂ¡ch fix: dĂ¹ng UPDATE cĂ³ Ä‘iá»u kiá»‡n
// WHERE field = giĂ¡_trá»‹_vá»«a_Ä‘á»c, náº¿u 0 dĂ²ng bá»‹ áº£nh hÆ°á»Ÿng (do cĂ³ lÆ°á»£t ghi khĂ¡c xen vĂ o) thĂ¬ Ä‘á»c láº¡i vĂ  thá»­
// láº¡i, Ä‘áº£m báº£o khĂ´ng lÆ°á»£t tÄƒng nĂ o bá»‹ máº¥t dĂ¹ cĂ³ nhiá»u request cháº¡y Ä‘á»“ng thá»i.
async function atomicIncrement(userId, field, amount = 1, maxRetries = 6) {
    const cols = await getUserColumns();
    if (!cols.has(field)) {
        // Cá»™t nĂ y chÆ°a cĂ³ trong báº£ng users -> cá»™ng dá»“n trong app_settings, tuyá»‡t Ä‘á»‘i khĂ´ng máº¥t lÆ°á»£t
        const extra = await getUserExtra(userId);
        const newVal = Number(extra[field] || 0) + amount;
        await saveUserExtra(userId, { [field]: newVal });
        return newVal;
    }
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
        // CĂ³ request khĂ¡c vá»«a ghi Ä‘Ă¨ giá»¯a lĂºc Ä‘á»c vĂ  ghi -> thá»­ láº¡i vá»›i giĂ¡ trá»‹ má»›i nháº¥t
    }
    console.error(`atomicIncrement: háº¿t sá»‘ láº§n thá»­ cho ${userId}.${field}`);
    return null;
}

// FIX Lá»–I "BOT KHĂ”NG PHáº¢N Há»’I GĂŒ Cáº¢": trÆ°á»›c Ä‘Ă¢y bot KHĂ”NG cĂ³ bot.catch() toĂ n cá»¥c, nĂªn báº¥t ká»³ lá»—i nĂ o
// xáº£y ra bĂªn trong /start hoáº·c cĂ¡c lá»‡nh admin (vd: Supabase timeout, Telegram API rate-limit khi kiá»ƒm
// tra thĂ nh viĂªn nhĂ³m, dá»¯ liá»‡u JSON há»ng...) Ä‘á»u khiáº¿n Telegraf Ă¢m tháº§m nuá»‘t lá»—i, chá»‰ log ra console mĂ 
// KHĂ”NG tráº£ lá»i gĂ¬ cho ngÆ°á»i dĂ¹ng -> nhĂ¬n nhÆ° bot bá»‹ "im láº·ng"/"treo". bot.catch() Ä‘áº£m báº£o má»i lá»—i Ä‘á»u
// Ä‘Æ°á»£c ghi log VĂ€ luĂ´n cĂ³ pháº£n há»“i bĂ¡o lá»—i cho ngÆ°á»i dĂ¹ng thay vĂ¬ im láº·ng.
bot.catch((err, ctx) => {
    console.error(`â ï¸ Lá»—i khi xá»­ lĂ½ update (${ctx.updateType}) tá»« user ${ctx.from?.id}:`, err);
    ctx.reply('âŒ ÄĂ£ cĂ³ lá»—i xáº£y ra, vui lĂ²ng thá»­ láº¡i sau Ă­t giĂ¢y. Náº¿u lá»—i tiáº¿p diá»…n hĂ£y liĂªn há»‡ Admin.').catch(() => {});
});

// HĂ m gá»­i tin nháº¯n Telegram an toĂ n
async function safeSendMessage(chatId, text, options = {}) {
    try {
        await bot.telegram.sendMessage(chatId, text, options);
        return true;
    } catch (e) {
        console.error(`Lá»—i gá»­i tin nháº¯n tá»›i ${chatId}:`, e.message);
        return false;
    }
}

// HĂ m kiá»ƒm tra thĂ nh viĂªn nhĂ³m
async function checkUserMembership(userId) {
    try {
        // Sá»­ dá»¥ng Promise.all Ä‘á»ƒ kiá»ƒm tra song song, tiáº¿t kiá»‡m thá»i gian
        const [m1, m2] = await Promise.all([
            bot.telegram.getChatMember(GROUP_1_ID, userId).catch(() => ({ status: 'left' })),
            bot.telegram.getChatMember(GROUP_2_ID, userId).catch(() => ({ status: 'left' }))
        ]);
        const validStatuses = ['member', 'administrator', 'creator'];
        return validStatuses.includes(m1.status) && validStatuses.includes(m2.status);
    } catch (e) {
        console.error(`Lá»—i check member ${userId}:`, e.message);
        return false;
    }
}

// HĂ m kiá»ƒm tra IP trĂ¹ng
async function checkDuplicateIP(userId, ip) {
    if (!ip) return [];
    const { data } = await supabase.from('users').select('id, name').eq('ip', ip).neq('id', userId);
    return data || [];
}


// Frontend sáº½ so sĂ¡nh má»‘c nĂ y vá»›i má»‘c nĂ³ biáº¿t Ä‘á»ƒ trĂ¡nh viá»‡c tá»± lÆ°u game Ä‘Ă¨ máº¥t thay Ä‘á»•i cá»§a admin.
async function touchWallet(userId, extraFields = {}) {
    const { error } = await saveUserFields(userId, {
        ...extraFields,
        walletUpdatedAt: new Date().toISOString()
    });
    if (error) console.error(`Lá»—i touchWallet ${userId}:`, error);
    return !error;
}

// Che 1 pháº§n tĂªn Ä‘á»ƒ Ä‘Äƒng cĂ´ng khai lĂªn banner toĂ n server mĂ  khĂ´ng lá»™ danh tĂ­nh Ä‘áº§y Ä‘á»§ (vd top 3 BXH tuáº§n)
function maskName(name) {
    if (!name || typeof name !== 'string') return 'NgÆ°á»i dĂ¹ng';
    const clean = name.trim();
    if (clean.length <= 2) return clean + '***';
    return clean.slice(0, 2) + '***';
}

// Ghi 1 sá»± kiá»‡n cĂ´ng khai (top 3 BXH tuáº§n...) lĂªn banner cháº¡y chá»¯ toĂ n server. KhĂ´ng cháº·n luá»“ng chĂ­nh náº¿u lá»—i
// (vd báº£ng activity_log chÆ°a tá»“n táº¡i trĂªn DB tháº­t do chÆ°a cháº¡y migration cÅ©).
async function logActivity(message) {
    try {
        await insertRowSafe('activity_log', { message });
    } catch (e) {
        console.error('Lá»—i ghi activity_log:', e.message);
    }
}

// Ghi 1 dĂ²ng lá»‹ch sá»­ biáº¿n Ä‘á»™ng coin/Ä‘Æ¡n hĂ ng cá»§a user (dĂ¹ng cho lá»‡nh /saoke). type: 'coin' | 'orders'.
// amount cĂ³ thá»ƒ Ă¢m (bá»‹ trá»«) hoáº·c dÆ°Æ¡ng (Ä‘Æ°á»£c cá»™ng). Chá»‰ ghi Ä‘Æ°á»£c cho cĂ¡c thao tĂ¡c SERVER BIáº¾T Ä‘Æ°á»£c lĂ½ do
// cá»¥ thá»ƒ (lá»‡nh admin, nháº­p code, má»i báº¡n, rĂºt tiá»n, thÆ°á»Ÿng BXH tuáº§n, /thuhoi...) - cĂ¡c khoáº£n coin/Ä‘Æ¡n hĂ ng
// ngÆ°á»i dĂ¹ng tá»± kiáº¿m trong game (giao hĂ ng, nhiá»‡m vá»¥, má»Ÿ rÆ°Æ¡ng...) Ä‘Æ°á»£c tĂ­nh hoĂ n toĂ n á»Ÿ CLIENT vĂ  chá»‰
// Ä‘á»“ng bá»™ Tá»”NG sá»‘ cuá»‘i cĂ¹ng lĂªn server má»—i ~30s, nĂªn server KHĂ”NG biáº¿t chĂ­nh xĂ¡c lĂ½ do riĂªng cá»§a khoáº£n Ä‘Ă³.
async function logTransaction(userId, type, amount, reason) {
    try {
        await insertRowSafe('transactions', { userId, type, amount, reason });
    } catch (e) {
        console.error('Lá»—i ghi transactions:', e.message);
    }
}

// Thá»­ xĂ¡c nháº­n 1 lÆ°á»£t má»i báº¡n há»£p lá»‡. Äiá»u kiá»‡n Ä‘áº§y Ä‘á»§:
// 1) NgÆ°á»i Ä‘Æ°á»£c má»i Ä‘Ă£ tham gia Ä‘á»§ nhĂ³m Telegram báº¯t buá»™c
// 2) NgÆ°á»i Ä‘Æ°á»£c má»i Ä‘Ă£ xem tá»‘i thiá»ƒu 5 quáº£ng cĂ¡o (lifetimeAdsWatched >= 5)
// 3) NgÆ°á»i Ä‘Æ°á»£c má»i Ä‘Ă£ báº¥m tá»‘i thiá»ƒu 2 SmartLink (lifetimeSmartlinks >= 2)
// 4) ChÆ°a tá»«ng Ä‘Æ°á»£c tĂ­nh há»£p lá»‡ trÆ°á»›c Ä‘Ă³ (referrerCounted = false)
// CĂ³ thá»ƒ Ä‘Æ°á»£c gá»i tá»« nhiá»u nÆ¡i (bot /start, callback_query, API xem QC) nĂªn hĂ m tá»± kiá»ƒm tra láº¡i tá»« DB,
// khĂ´ng tin tÆ°á»Ÿng dá»¯ liá»‡u client gá»­i lĂªn.
async function tryFinalizeReferral(userId, precomputedIsMember = null) {
    const { data: userRecord, error: userError } = await readUserRow(userId);
    if (userError || !userRecord) return { ok: false, reason: 'user_not_found' };
    if (!userRecord.referrerId || userRecord.referrerId === userId) return { ok: false, reason: 'no_referrer' };
    if (userRecord.referrerCounted) return { ok: false, reason: 'already_counted' };
    if (userRecord.isBanned) return { ok: false, reason: 'banned' };

    const isMember = precomputedIsMember !== null ? precomputedIsMember : await checkUserMembership(userId);
    if (!isMember) return { ok: false, reason: 'not_member' };

    if ((userRecord.lifetimeAdsWatched || 0) < 5) return { ok: false, reason: 'not_enough_ads' };
    if ((userRecord.lifetimeSmartlinks || 0) < 2) return { ok: false, reason: 'not_enough_smartlinks' };

    // FIX Lá»–I "Má»œI 1 Báº N NHÆ¯NG BĂO 2 Há»¢P Lá»†" (race condition): hĂ m nĂ y cĂ³ thá»ƒ bá»‹ gá»i gáº§n nhÆ° Ä‘á»“ng thá»i tá»«
    // nhiá»u nÆ¡i (bot /start, nĂºt "XĂ¡c Nháº­n" callback_query, vĂ  API /api/check-referral gá»i má»—i láº§n user
    // xem xong 1 QC). TrÆ°á»›c Ä‘Ă¢y, Táº¤T Cáº¢ cĂ¡c lá»‡nh gá»i Ä‘á»u Ä‘á»c referrerCounted=false rá»“i má»›i ghi true á»Ÿ CUá»I
    // cĂ¹ng -> náº¿u 2 lá»‡nh gá»i trĂ¹ng thá»i Ä‘iá»ƒm, cáº£ 2 Ä‘á»u "lá»t qua" Ä‘iá»u kiá»‡n referrerCounted=false phĂ­a trĂªn
    // vĂ  Ä‘á»u cá»™ng thÆ°á»Ÿng cho ngÆ°á»i má»i -> user tháº¥y 2 tin nháº¯n xĂ¡c nháº­n há»£p lá»‡ dĂ¹ chá»‰ má»i Ä‘Ăºng 1 báº¡n.
    // CĂ¡ch fix: "khĂ³a" (claim) NGAY LĂC NĂ€Y báº±ng 1 lá»‡nh UPDATE cĂ³ Ä‘iá»u kiá»‡n WHERE referrerCounted = false.
    // Do Postgres xá»­ lĂ½ UPDATE tuáº§n tá»± cho tá»«ng dĂ²ng, chá»‰ DUY NHáº¤T 1 lá»‡nh gá»i trĂºng Ä‘iá»u kiá»‡n vĂ  nháº­n Ä‘Æ°á»£c
    // dĂ²ng tráº£ vá»; cĂ¡c lá»‡nh gá»i thua cuá»™c (dĂ¹ Ä‘á»c tháº¥y referrerCounted=false trÆ°á»›c Ä‘Ă³) sáº½ nháº­n máº£ng Rá»–NG á»Ÿ
    // Ä‘Ă¢y vĂ  dá»«ng láº¡i ngay, khĂ´ng cá»™ng thÆ°á»Ÿng láº§n 2.
    const { data: claimRows, error: claimError } = await supabase.from('users')
        .update({ referrerCounted: true })
        .eq('id', userId)
        .eq('referrerCounted', false)
        .select('id');
    if (claimError) {
        console.error(`Lá»—i claim referral cho ${userId}:`, claimError);
        return { ok: false, reason: 'claim_error' };
    }
    if (!claimRows || claimRows.length === 0) {
        // Má»™t lá»‡nh gá»i khĂ¡c Ä‘Ă£ claim vĂ  xá»­ lĂ½ xong trong lĂºc hĂ m nĂ y Ä‘ang cháº¡y cĂ¡c bÆ°á»›c kiá»ƒm tra á»Ÿ trĂªn
        return { ok: false, reason: 'already_counted' };
    }

    const { data: refUser, error: refError } = await readUserRow(userRecord.referrerId);
    if (refError || !refUser) {
        // ÄĂ£ claim (referrerCounted=true) nhÆ°ng khĂ´ng cá»™ng thÆ°á»Ÿng Ä‘Æ°á»£c -> hoĂ n tĂ¡c claim Ä‘á»ƒ khĂ´ng máº¥t
        // vÄ©nh viá»…n lÆ°á»£t há»£p lá»‡ nĂ y, cho phĂ©p há»‡ thá»‘ng tá»± thá»­ láº¡i á»Ÿ láº§n gá»i tiáº¿p theo.
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId);
        return { ok: false, reason: 'referrer_not_found' };
    }

    const INSTANT_REF_COINS = 1000;
    const INSTANT_REF_ORDERS = 2000;

    // FIX Lá»–I "Sá» Báº N Há»¢P Lá»† CAO HÆ N Sá» Báº N ÄĂƒ Má»œI": tÄƒng validInvites báº±ng atomicIncrement (thay vĂ¬
    // Ä‘á»c-rá»“i-ghi) Ä‘á»ƒ khĂ´ng bá»‹ máº¥t lÆ°á»£t tÄƒng khi nhiá»u referral cá»§a CĂ™NG 1 ngÆ°á»i má»i hoĂ n táº¥t gáº§n nhÆ°
    // Ä‘á»“ng thá»i. Äá»“ng thá»i chá»‘t cháº·n an toĂ n: validInvites khĂ´ng bao giá» Ä‘Æ°á»£c vÆ°á»£t quĂ¡ invitedCount
    // (vá» logic khĂ´ng thá»ƒ cĂ³ nhiá»u báº¡n "há»£p lá»‡" hÆ¡n sá»‘ báº¡n thá»±c táº¿ Ä‘Ă£ má»i).
    const newValid = await atomicIncrement(userRecord.referrerId, 'validInvites', 1);
    if (newValid === null) {
        await supabase.from('users').update({ referrerCounted: false }).eq('id', userId);
        return { ok: false, reason: 'update_failed' };
    }
    // Äáº¿m riĂªng cho BXH TUáº¦N (Ä‘Æ°á»£c reset vá» 0 má»—i tuáº§n bá»Ÿi weeklyLeaderboardReset(), khĂ¡c vá»›i validInvites
    // lĂ  tá»•ng trá»n Ä‘á»i dĂ¹ng cho má»‘c thÆ°á»Ÿng má»i báº¡n, khĂ´ng bao giá» reset).
    await atomicIncrement(userRecord.referrerId, 'weeklyValidInvites', 1);
    if (newValid > (refUser.invitedCount || 0)) {
        // Dá»¯ liá»‡u invitedCount cÅ© (trÆ°á»›c khi vĂ¡ lá»—i) cĂ³ thá»ƒ váº«n cĂ²n tháº¥p hÆ¡n thá»±c táº¿ -> tá»± sá»­a láº¡i cho khá»›p
        await saveUserFields(userRecord.referrerId, { invitedCount: newValid });
    }

    await touchWallet(userRecord.referrerId, {
        coins: (refUser.coins || 0) + INSTANT_REF_COINS,
        orders: (refUser.orders || 0) + INSTANT_REF_ORDERS
    });
    logTransaction(userRecord.referrerId, 'coin', INSTANT_REF_COINS, `Má»i báº¡n thĂ nh cĂ´ng: ${userRecord.name}`);
    logTransaction(userRecord.referrerId, 'orders', INSTANT_REF_ORDERS, `Má»i báº¡n thĂ nh cĂ´ng: ${userRecord.name}`);

    const milestonesData = refUser.referralMilestones ? JSON.parse(refUser.referralMilestones) : [];
    const nextMilestone = milestonesData.find(m => m.friends > newValid);
    const progressText = nextMilestone
        ? `đŸ¯ Tiáº¿n Ä‘á»™: ${newValid}/${nextMilestone.friends} báº¡n (Pháº§n thÆ°á»Ÿng má»‘c: ${nextMilestone.reward})`
        : 'đŸ† ÄĂ£ Ä‘áº¡t táº¥t cáº£ cĂ¡c má»‘c!';

    await safeSendMessage(userRecord.referrerId,
        `âœ… *XĂ¡c nháº­n há»£p lá»‡!* ${userRecord.name} Ä‘Ă£ tham gia Ä‘á»§ nhĂ³m vĂ  xem Ä‘á»§ QC.\nđŸ Nháº­n ngay: *+${INSTANT_REF_COINS.toLocaleString()} Coin + ${INSTANT_REF_ORDERS.toLocaleString()} ÄÆ¡n HĂ ng*\nđŸ“ Tá»•ng há»£p lá»‡: *${newValid}*\n${progressText}`,
        { parse_mode: 'Markdown' }
    );

    return { ok: true, validInvites: newValid };
}

// ==================== BOT LOGIC ====================

// Middleware cháº·n TOĂ€N Bá»˜ tÆ°Æ¡ng tĂ¡c cá»§a user thÆ°á»ng khi bot Ä‘ang bá»‹ khoĂ¡ báº£o trĂ¬ (admin váº«n dĂ¹ng Ä‘Æ°á»£c
// bĂ¬nh thÆ°á»ng Ä‘á»ƒ cĂ³ thá»ƒ tá»± /mokhoabot má»Ÿ láº¡i). Äáº·t TRÆ¯á»C má»i lá»‡nh/handler khĂ¡c Ä‘á»ƒ cháº·n sá»›m nháº¥t.
bot.use(async (ctx, next) => {
    if (BOT_LOCKED && !isMainAdmin(ctx)) {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(MAINTENANCE_MESSAGE, { show_alert: true }).catch(() => {});
        }
        return ctx.reply(MAINTENANCE_MESSAGE).catch(() => {});
    }
    return next();
});

// /khoabot - KhoĂ¡ Bot & Mini App Ä‘á»ƒ báº£o trĂ¬ (chá»‰ Admin)
bot.command('khoabot', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await setBotLocked(true);
    ctx.reply("đŸ”’ ÄĂ£ khoĂ¡ Bot & Mini App Ä‘á»ƒ báº£o trĂ¬.\nNgÆ°á»i dĂ¹ng sáº½ nháº­n thĂ´ng bĂ¡o: \"" + MAINTENANCE_MESSAGE + "\"\nDĂ¹ng /mokhoabot Ä‘á»ƒ má»Ÿ khoĂ¡ láº¡i.");
});

// /mokhoabot - Má»Ÿ khoĂ¡ Bot & Mini App (chá»‰ Admin)
bot.command('mokhoabot', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await setBotLocked(false);
    ctx.reply("đŸ”“ ÄĂ£ má»Ÿ khoĂ¡ Bot & Mini App. NgÆ°á»i dĂ¹ng cĂ³ thá»ƒ sá»­ dá»¥ng bĂ¬nh thÆ°á»ng trá»Ÿ láº¡i.");
});

// /addadmin <ID> - Phong 1 user lĂ m admin phá»¥ (CHá»ˆ Admin chĂ­nh Ä‘Æ°á»£c dĂ¹ng lá»‡nh nĂ y)
// Admin phá»¥ dĂ¹ng Ä‘Æ°á»£c táº¥t cáº£ lá»‡nh admin khĂ¡c nhÆ°ng KHĂ”NG thá»ƒ tá»± thĂªm/xoĂ¡ admin (váº«n dÆ°á»›i quyá»n Admin chĂ­nh).
bot.command('addadmin', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /addadmin <ID>");
    if (targetId === String(ADMIN_ID)) return ctx.reply("â ï¸ ID nĂ y Ä‘Ă£ lĂ  Admin chĂ­nh.");
    if (subAdminIds.has(targetId)) return ctx.reply("â ï¸ User nĂ y Ä‘Ă£ lĂ  admin phá»¥ rá»“i.");

    const { error } = await supabase.from('admins').upsert({ id: targetId, addedBy: String(ctx.from.id) });
    if (error) {
        console.error('Lá»—i thĂªm admin phá»¥:', error);
        return ctx.reply("âŒ Lá»—i khi thĂªm admin (kiá»ƒm tra Ä‘Ă£ táº¡o báº£ng \"admins\" trĂªn Supabase chÆ°a).");
    }
    await loadAdmins(); // Náº¡p láº¡i cache ngay Ä‘á»ƒ cĂ³ hiá»‡u lá»±c tá»©c thĂ¬
    ctx.reply(`âœ… ÄĂ£ phong user ${targetId} lĂ m *Admin phá»¥*.\nUser nĂ y giá» dĂ¹ng Ä‘Æ°á»£c táº¥t cáº£ lá»‡nh admin (trá»« /addadmin, /xoaadmin).`, { parse_mode: 'Markdown' });
    safeSendMessage(targetId, "đŸ‰ Báº¡n vá»«a Ä‘Æ°á»£c phong lĂ m *Admin phá»¥*! Giá» báº¡n cĂ³ thá»ƒ dĂ¹ng cĂ¡c lá»‡nh quáº£n trá»‹ cá»§a bot.", { parse_mode: 'Markdown' });
});

// /xoaadmin <ID> - Háº¡ 1 admin phá»¥ xuá»‘ng láº¡i thĂ nh user thÆ°á»ng (CHá»ˆ Admin chĂ­nh Ä‘Æ°á»£c dĂ¹ng lá»‡nh nĂ y)
bot.command('xoaadmin', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /xoaadmin <ID>");
    if (targetId === String(ADMIN_ID)) return ctx.reply("âŒ KhĂ´ng thá»ƒ xoĂ¡ quyá»n Admin chĂ­nh.");
    if (!subAdminIds.has(targetId)) return ctx.reply("â ï¸ User nĂ y khĂ´ng pháº£i admin phá»¥.");

    const { error } = await supabase.from('admins').delete().eq('id', targetId);
    if (error) {
        console.error('Lá»—i xoĂ¡ admin phá»¥:', error);
        return ctx.reply("âŒ Lá»—i khi xoĂ¡ admin.");
    }
    await loadAdmins();
    ctx.reply(`âœ… ÄĂ£ háº¡ user ${targetId} xuá»‘ng láº¡i thĂ nh ngÆ°á»i dĂ¹ng thÆ°á»ng.`);
    safeSendMessage(targetId, "â„¹ï¸ Báº¡n Ä‘Ă£ bá»‹ gá»¡ quyá»n *Admin phá»¥*.", { parse_mode: 'Markdown' });
});

// /listadmins - Xem danh sĂ¡ch admin hiá»‡n táº¡i
bot.command('listadmin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    let msg = `đŸ‘‘ *Admin chĂ­nh:* \`${ADMIN_ID}\`\n\n`;
    if (subAdminIds.size === 0) {
        msg += "đŸ“­ ChÆ°a cĂ³ admin phá»¥ nĂ o.";
    } else {
        msg += `đŸ›¡ï¸ *Admin phá»¥ (${subAdminIds.size}):*\n` + [...subAdminIds].map(id => `\`${id}\``).join('\n');
    }
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /start - Kiá»ƒm tra tham gia nhĂ³m Báº®T BUá»˜C TRÆ¯á»C khi cho vĂ o miniapp
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
                    { friends: 5, reward: '1,000 Coin + 500 ÄÆ¡n HĂ ng', coins: 1000, orders: 500, spins: 0, claimed: false },
                    { friends: 10, reward: '1,500 Coin + 2 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 1500, orders: 0, spins: 2, claimed: false },
                    { friends: 20, reward: '2,000 Coin + 1,500 ÄÆ¡n HĂ ng', coins: 2000, orders: 1500, spins: 0, claimed: false },
                    { friends: 30, reward: '5,000 ÄÆ¡n HĂ ng + 2 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 0, orders: 5000, spins: 2, claimed: false },
                    { friends: 50, reward: '5,000 Coin + 7,000 ÄÆ¡n HĂ ng', coins: 5000, orders: 7000, spins: 0, claimed: false },
                    { friends: 75, reward: '10,000 ÄÆ¡n HĂ ng + 5 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 0, orders: 10000, spins: 5, claimed: false },
                    { friends: 100, reward: '20,000 ÄÆ¡n HĂ ng + 10 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 0, orders: 20000, spins: 10, claimed: false }
                ]),
                isBanned: false,
                referrerCounted: false, // ThĂªm trÆ°á»ng nĂ y Ä‘á»ƒ kiá»ƒm soĂ¡t viá»‡c Ä‘Ă£ Ä‘áº¿m há»£p lá»‡ cho ngÆ°á»i má»i hay chÆ°a
                lifetimeAdsWatched: 0, // Tá»•ng sá»‘ QC Ä‘Ă£ xem trá»n Ä‘á»i (khĂ´ng reset theo ngĂ y) - Ä‘iá»u kiá»‡n xĂ©t má»i báº¡n há»£p lá»‡
                bonusAdsToday: 0, // Sá»‘ lÆ°á»£t QC Rewarded nhiá»‡m vá»¥ hĂ´m nay
                quizDate: '',
                quizFreeUsed: false,
                quizAdUnlocked: 0,
                quizUsedIds: [],
                chestOpensTotal: 0, // Tá»•ng sá»‘ lÆ°á»£t Ä‘Ă£ má»Ÿ rÆ°Æ¡ng (trá»n Ä‘á»i) - dĂ¹ng cho /checkID
                chestOpensToday: 0, // Sá»‘ lÆ°á»£t Ä‘Ă£ má»Ÿ rÆ°Æ¡ng hĂ´m nay - dĂ¹ng cho /checkID, reset má»—i ngĂ y
                walletUpdatedAt: new Date().toISOString() // Má»‘c thá»i gian admin sá»­a vĂ­ gáº§n nháº¥t, dĂ¹ng Ä‘á»ƒ chá»‘ng ghi Ä‘Ă¨ dá»¯ liá»‡u
            };
            const { known: newUserRow, extra: newUserExtra } = await splitUserFields(newUser);
            const { data: insertedUser, error: insertError } = await supabase.from('users').insert(newUserRow).select().single();
            if (insertError) {
                console.error("Lá»—i táº¡o user má»›i:", insertError);
                return ctx.reply("â ï¸ CĂ³ lá»—i xáº£y ra khi táº¡o tĂ i khoáº£n, vui lĂ²ng thá»­ láº¡i sau!");
            }
            if (Object.keys(newUserExtra).length > 0) await saveUserExtra(userId, newUserExtra);
            userRecord = { ...newUserExtra, ...insertedUser };
            
            // TÄƒng invitedCount cho ngÆ°á»i má»i (chÆ°a tĂ­nh há»£p lá»‡)
            // DĂ¹ng atomicIncrement thay vĂ¬ Ä‘á»c-rá»“i-ghi Ä‘á»ƒ khĂ´ng bá»‹ "máº¥t lÆ°á»£t má»i" khi nhiá»u ngÆ°á»i cĂ¹ng
            // vĂ o báº±ng chung 1 link giá»›i thiá»‡u gáº§n nhÆ° Ä‘á»“ng thá»i (xem giáº£i thĂ­ch chi tiáº¿t á»Ÿ atomicIncrement).
            if (referrerId && referrerId !== userId) { // Äáº£m báº£o ngÆ°á»i má»i khĂ´ng pháº£i chĂ­nh mĂ¬nh
                const newCount = await atomicIncrement(referrerId, 'invitedCount', 1);
                if (newCount !== null) {
                    // FIX: trÆ°á»›c Ä‘Ă¢y thĂ´ng bĂ¡o ghi "đŸ‰ Báº¡n vá»«a má»i thĂ nh cĂ´ng" ngay khi báº¡n bĂ¨ chá»‰ má»›i Báº¤M
                    // VĂ€O LINK (chÆ°a tham gia Ä‘á»§ nhĂ³m, chÆ°a xem QC nĂ o) khiáº¿n ngÆ°á»i má»i hiá»ƒu láº§m lĂ  Ä‘Ă£ nháº­n
                    // thÆ°á»Ÿng. Äá»•i thĂ nh thĂ´ng bĂ¡o trung thá»±c: chá»‰ bĂ¡o cĂ³ ngÆ°á»i vĂ o báº±ng link, CHÆ¯A thĂ nh
                    // cĂ´ng, kĂ¨m nháº¯c nhá»Ÿ Ä‘Ăºng 2 Ä‘iá»u kiá»‡n cáº§n hoĂ n táº¥t. ThÆ°á»Ÿng + thĂ´ng bĂ¡o "thĂ nh cĂ´ng" tháº­t
                    // sá»± chá»‰ Ä‘Æ°á»£c gá»­i trong tryFinalizeReferral() khi báº¡n bĂ¨ ÄĂƒ Ä‘á»§ Ä‘iá»u kiá»‡n.
                    await safeSendMessage(referrerId, 
                        `đŸ‘‹ *${userName}* vá»«a vĂ o Mini App báº±ng link giá»›i thiá»‡u cá»§a báº¡n!\nâ ï¸ LÆ°á»£t má»i nĂ y *CHÆ¯A Ä‘Æ°á»£c tĂ­nh thĂ nh cĂ´ng*.\nđŸ“‹ HĂ£y nháº¯c báº¡n áº¥y hoĂ n táº¥t 2 Ä‘iá»u kiá»‡n sau Ä‘á»ƒ báº¡n nháº­n Ä‘Æ°á»£c thÆ°á»Ÿng má»i báº¡n:\n1ï¸âƒ£ Tham gia Ä‘áº§y Ä‘á»§ nhĂ³m Telegram báº¯t buá»™c\n2ï¸âƒ£ Xem Ă­t nháº¥t 5 quáº£ng cĂ¡o Rewarded/In-App trong Mini App (ngoáº¡i trá»« SmartLink)\n\nâœ… Khi báº¡n áº¥y hoĂ n táº¥t, bot sáº½ tá»± Ä‘á»™ng thĂ´ng bĂ¡o cho báº¡n kĂ¨m pháº§n thÆ°á»Ÿng.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            }
        } else {
            userRecord = existingUser;
            if (userRecord.isBanned) {
                return ctx.reply("âŒ TĂ i khoáº£n cá»§a báº¡n Ä‘Ă£ bá»‹ khĂ³a. LiĂªn há»‡ admin Ä‘á»ƒ Ä‘Æ°á»£c há»— trá»£.");
            }
            // FIX Lá»–I TĂN Bá» GHI ÄĂˆ SAI (vd hiá»‡n "đŸ« BANNED - RESET đŸ«" thay vĂ¬ tĂªn tháº­t): trÆ°á»ng "name"
            // trÆ°á»›c Ä‘Ă¢y chá»‰ Ä‘Æ°á»£c ghi 1 Láº¦N DUY NHáº¤T lĂºc táº¡o tĂ i khoáº£n, khĂ´ng bao giá» tá»± lĂ m má»›i láº¡i tá»«
            // Telegram. Náº¿u dá»¯ liá»‡u "name" tá»«ng bá»‹ chá»‰nh sai (vd admin sá»­a tay trong Supabase lĂ m dáº¥u
            // ghi chĂº ná»™i bá»™ rá»“i quĂªn Ä‘á»•i láº¡i) thĂ¬ tĂªn sai Ä‘Ă³ tá»“n táº¡i vÄ©nh viá»…n. Giá» má»—i láº§n user gĂµ
            // /start, tá»± Ä‘á»“ng bá»™ láº¡i Ä‘Ăºng tĂªn tháº­t hiá»‡n táº¡i tá»« Telegram (ctx.from.first_name) náº¿u khĂ¡c
            // vá»›i tĂªn Ä‘ang lÆ°u, giĂºp tá»± "chá»¯a lĂ nh" má»i trÆ°á»ng há»£p tĂªn bá»‹ sai mĂ  khĂ´ng cáº§n admin sá»­a tay.
            if (userName && userRecord.name !== userName) {
                await supabase.from('users').update({ name: userName }).eq('id', userId);
                userRecord.name = userName;
            }
        }

        // Kiá»ƒm tra tham gia nhĂ³m
        const isMember = await checkUserMembership(userId);

        if (isMember) {
            // Náº¿u cĂ³ referrer vĂ  chÆ°a Ä‘Æ°á»£c Ä‘áº¿m há»£p lá»‡ -> thá»­ xĂ¡c nháº­n (cáº§n Ä‘á»§ nhĂ³m + Ä‘á»§ 3 QC Ä‘Ă£ xem)
            await tryFinalizeReferral(userId, true);

            // Gá»­i nĂºt má»Ÿ Mini App
            ctx.reply(`ChĂ o má»«ng ${userName}! đŸ‰\nBáº¡n Ä‘Ă£ xĂ¡c minh thĂ nh cĂ´ng. HĂ£y nháº¥n nĂºt bĂªn dÆ°á»›i Ä‘á»ƒ vĂ o Mini App!`, {
                reply_markup: { 
                    inline_keyboard: [[{ text: "đŸ€ VĂ o Mini App", web_app: { url: WEB_APP_URL } }]] 
                }
            });
        } else {
            // YĂªu cáº§u tham gia nhĂ³m TRÆ¯á»C khi cho vĂ o miniapp
            ctx.reply(
                "â ï¸ *Báº¡n chÆ°a tham gia Ä‘á»§ 2 nhĂ³m báº¯t buá»™c!*\n\n" +
                "Vui lĂ²ng tham gia 2 nhĂ³m dÆ°á»›i Ä‘Ă¢y:\n" +
                "1ï¸âƒ£ https://t.me/khohangkiemtien (KĂªnh thĂ´ng bĂ¡o)\n" +
                "2ï¸âƒ£ https://t.me/khohangchatkiemtien (NhĂ³m chat)\n\n" +
                "Sau khi tham gia xong, nháº¥n nĂºt *XĂ¡c Nháº­n* bĂªn dÆ°á»›i Ä‘á»ƒ bot kiá»ƒm tra.",
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "1ï¸âƒ£ Tham gia KĂªnh", url: "https://t.me/khohangkiemtien" }],
                            [{ text: "2ï¸âƒ£ Tham gia NhĂ³m Chat", url: "https://t.me/khohangchatkiemtien" }],
                            [{ text: "âœ… XĂ¡c Nháº­n Bot Kiá»ƒm Tra", callback_data: "check_groups" }]
                        ]
                    }
                }
            );
        }
    } catch (err) {
        console.error("Lá»—i /start:", err);
        ctx.reply("â ï¸ CĂ³ lá»—i xáº£y ra, vui lĂ²ng thá»­ láº¡i sau!");
    }
});

// Xá»­ lĂ½ nĂºt "XĂ¡c Nháº­n Bot Kiá»ƒm Tra"
bot.on('callback_query', async (ctx) => {
    if (ctx.callbackQuery.data === 'check_groups') {
        const userId = ctx.from.id.toString();
        const userName = ctx.from.first_name || 'User';
        
        await ctx.answerCbQuery("đŸ” Äang kiá»ƒm tra...");
        
        const isMember = await checkUserMembership(userId);
        
        if (isMember) {
            const { data: userRecord, error: userError } = await supabase.from('users').select('*').eq('id', userId).single();
            if (userError) {
                console.error("Lá»—i láº¥y user trong callback:", userError);
                return ctx.editMessageText("â ï¸ CĂ³ lá»—i xáº£y ra, vui lĂ²ng thá»­ láº¡i sau!");
            }

            // Náº¿u cĂ³ referrer vĂ  chÆ°a Ä‘Æ°á»£c Ä‘áº¿m há»£p lá»‡ -> thá»­ xĂ¡c nháº­n (cáº§n Ä‘á»§ nhĂ³m + Ä‘á»§ 3 QC Ä‘Ă£ xem)
            await tryFinalizeReferral(userId, true);
            
            await ctx.editMessageText(
                `ChĂ o má»«ng ${userName}! đŸ‰\nBáº¡n Ä‘Ă£ xĂ¡c minh thĂ nh cĂ´ng. HĂ£y nháº¥n nĂºt bĂªn dÆ°á»›i Ä‘á»ƒ vĂ o Mini App!`,
                {
                    reply_markup: { 
                        inline_keyboard: [[{ text: "đŸ€ VĂ o Mini App", web_app: { url: WEB_APP_URL } }]] 
                    }
                }
            );
        } else {
            await ctx.answerCbQuery("âŒ Báº¡n váº«n chÆ°a tham gia Ä‘á»§ 2 nhĂ³m! Vui lĂ²ng tham gia cáº£ KĂªnh vĂ  NhĂ³m Chat rá»“i nháº¥n láº¡i.");
        }
    }
});

// ==================== Lá»†NH ADMIN ====================

// /thongke
bot.command('thongke', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: usersStats } = await supabase.from('users').select('adsToday, smartlinksToday');
    const { data: pendingWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'pending');
    const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
    const { data: rejectedWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'rejected');
    const { data: refundedWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'refunded'); // ThĂªm thá»‘ng kĂª hoĂ n tráº£
    
    const totalAds = usersStats ? usersStats.reduce((sum, u) => sum + (u.adsToday || 0), 0) : 0;
    const totalSmartlinks = usersStats ? usersStats.reduce((sum, u) => sum + (u.smartlinksToday || 0), 0) : 0;
    const totalPending = pendingWithdraws ? pendingWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalSuccess = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalRejected = rejectedWithdraws ? rejectedWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    const totalRefunded = refundedWithdraws ? refundedWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    
    ctx.reply(
        `đŸ“ *THá»NG KĂ CHI TIáº¾T*\n\n` +
        `đŸ‘¥ Tá»•ng User: *${totalUsers || 0}*\n` +
        `đŸ“º Tá»•ng QC Ä‘Ă£ xem (hĂ´m nay): *${totalAds}*\n` +
        `đŸ”— Tá»•ng Smartlink Ä‘Ă£ áº¥n (hĂ´m nay): *${totalSmartlinks}*\n\n` +
        `đŸ’° *TĂ€I CHĂNH:*\n` +
        `â³ Chá» duyá»‡t: *${totalPending.toLocaleString()} VNÄ*\n` +
        `âœ… ÄĂ£ duyá»‡t: *${totalSuccess.toLocaleString()} VNÄ*\n` +
        `âŒ ÄĂ£ tá»« chá»‘i: *${totalRejected.toLocaleString()} VNÄ*\n` +
        `đŸ”„ ÄĂ£ hoĂ n tráº£: *${totalRefunded.toLocaleString()} VNÄ*`,
        { parse_mode: 'Markdown' }
    );
});

// /quantri - thá»‘ng kĂª nhanh
bot.command('quantri', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: successWithdraws } = await supabase.from('withdrawals').select('amount').eq('status', 'success');
    const totalWithdrawn = successWithdraws ? successWithdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    ctx.reply(`đŸ“ *Thá»‘ng kĂª nhanh:*\nđŸ‘¥ Tá»•ng User: *${totalUsers || 0}*\nđŸ’° Tá»•ng tiá»n Ä‘Ă£ duyá»‡t: *${totalWithdrawn.toLocaleString()} VNÄ*`, { parse_mode: 'Markdown' });
});

// /ban
bot.command('ban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /ban <userId>");
    await touchWallet(targetId, { isBanned: true });
    ctx.reply(`âœ… ÄĂ£ ban user ${targetId}`);
});

// /unban
bot.command('unban', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /unban <userId>");
    await touchWallet(targetId, { isBanned: false });
    ctx.reply(`âœ… ÄĂ£ unban user ${targetId}`);
});

// /congcoin
bot.command('congcoin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /congcoin <userId> <sá»‘_lÆ°á»£ng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('coins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    await touchWallet(targetId, { coins: (data.coins || 0) + amount });
    logTransaction(targetId, 'coin', amount, `Admin ${ctx.from.id} cá»™ng coin (/congcoin)`);
    ctx.reply(`âœ… ÄĂ£ cá»™ng ${amount} coin cho ${targetId}. Sá»‘ dÆ° má»›i: ${(data.coins || 0) + amount}`);
});

// /trucoin
bot.command('trucoin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /trucoin <userId> <sá»‘_lÆ°á»£ng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('coins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    const newCoins = Math.max(0, (data.coins || 0) - amount);
    await touchWallet(targetId, { coins: newCoins });
    logTransaction(targetId, 'coin', -amount, `Admin ${ctx.from.id} trá»« coin (/trucoin)`);
    ctx.reply(`âœ… ÄĂ£ trá»« ${amount} coin cá»§a ${targetId}. Sá»‘ dÆ° má»›i: ${newCoins}`);
});

// /addspin
bot.command('addspin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /addspin <userId> <sá»‘_lÆ°á»£ng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('spins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    await touchWallet(targetId, { spins: (data.spins || 0) + amount });
    ctx.reply(`âœ… ÄĂ£ cá»™ng ${amount} lÆ°á»£t má»Ÿ rÆ°Æ¡ng cho ${targetId}`);
});

// /adddonhang
bot.command('adddonhang', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /adddonhang <userId> <sá»‘_lÆ°á»£ng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('orders').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    await touchWallet(targetId, { orders: (data.orders || 0) + amount });
    logTransaction(targetId, 'orders', amount, `Admin ${ctx.from.id} cá»™ng Ä‘Æ¡n hĂ ng (/adddonhang)`);
    ctx.reply(`âœ… ÄĂ£ cá»™ng ${amount} Ä‘Æ¡n hĂ ng cho ${targetId}`);
});

// /trudonhang - Trá»« Ä‘Æ¡n hĂ ng cá»§a 1 user (khĂ´ng cho Ă¢m)
bot.command('trudonhang', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /trudonhang <userId> <sá»‘_lÆ°á»£ng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('orders').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    const newOrders = Math.max(0, (data.orders || 0) - amount);
    await touchWallet(targetId, { orders: newOrders });
    logTransaction(targetId, 'orders', -amount, `Admin ${ctx.from.id} trá»« Ä‘Æ¡n hĂ ng (/trudonhang)`);
    ctx.reply(`âœ… ÄĂ£ trá»« ${amount} Ä‘Æ¡n hĂ ng cá»§a ${targetId}. Sá»‘ dÆ° má»›i: ${newOrders}`);
});

// /truspin - Trá»« lÆ°á»£t má»Ÿ rÆ°Æ¡ng cá»§a 1 user (khĂ´ng cho Ă¢m)
bot.command('truspin', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /truspin <userId> <sá»‘_lÆ°á»£ng>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    const { data, error } = await supabase.from('users').select('spins').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    const newSpins = Math.max(0, (data.spins || 0) - amount);
    await touchWallet(targetId, { spins: newSpins });
    ctx.reply(`âœ… ÄĂ£ trá»« ${amount} lÆ°á»£t má»Ÿ rÆ°Æ¡ng cá»§a ${targetId}. Sá»‘ dÆ° má»›i: ${newSpins}`);
});

// /addref <userId> <sá»‘_ref> - Cá»™ng thĂªm N lÆ°á»£t má»i Báº N Há»¢P Lá»† cho user (dĂ¹ng khi cáº§n bĂ¹ thá»§ cĂ´ng, vd báº¡n
// bĂ¨ lá»¡ khĂ´ng tá»± xĂ¡c nháº­n Ä‘Æ°á»£c, hoáº·c tri Ă¢n sá»± kiá»‡n...). Cá»™ng validInvites VĂ€ invitedCount (Ä‘áº£m báº£o
// invitedCount luĂ´n >= validInvites, Ä‘Ăºng báº¥t biáº¿n cá»§a há»‡ thá»‘ng má»i báº¡n), Ä‘á»“ng thá»i cá»™ng tháº³ng vĂ o vĂ­ TOĂ€N
// Bá»˜ pháº§n thÆ°á»Ÿng "há»£p lá»‡ tá»©c thĂ¬" mĂ  user sáº½ nháº­n Ä‘Æ°á»£c Tá»° Äá»˜NG cho má»—i lÆ°á»£t má»i há»£p lá»‡ tháº­t (1.000 Coin +
// 2.000 ÄÆ¡n HĂ ng / báº¡n) nhĂ¢n vá»›i N. CĂ¡c má»‘c thÆ°á»Ÿng lá»›n hÆ¡n (5/10/20/30/50/75/100 báº¡n) váº«n do chĂ­nh user tá»±
// báº¥m "Nháº­n" trong Mini App nhÆ° bĂ¬nh thÆ°á»ng khi validInvites cháº¡m má»‘c, khĂ´ng tá»± phĂ¡t á»Ÿ Ä‘Ă¢y Ä‘á»ƒ khĂ´ng phĂ¡ vá»¡
// luá»“ng nháº­n má»‘c thÆ°á»Ÿng Ä‘Ă£ cĂ³ sáºµn.
bot.command('addref', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /addref <userId> <sá»‘_ref>");
    const targetId = parts[1];
    const amount = parseInt(parts[2]);
    if (!amount || amount <= 0) return ctx.reply("âŒ Sá»‘ ref pháº£i lĂ  sá»‘ nguyĂªn dÆ°Æ¡ng.");

    const { data, error } = await supabase.from('users')
        .select('validInvites, invitedCount, coins, orders').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");

    const INSTANT_REF_COINS = 1000;
    const INSTANT_REF_ORDERS = 2000;
    const newValid = (data.validInvites || 0) + amount;
    const newInvited = Math.max(data.invitedCount || 0, newValid);
    const bonusCoins = INSTANT_REF_COINS * amount;
    const bonusOrders = INSTANT_REF_ORDERS * amount;

    const ok = await touchWallet(targetId, {
        validInvites: newValid,
        invitedCount: newInvited,
        coins: (data.coins || 0) + bonusCoins,
        orders: (data.orders || 0) + bonusOrders
    });
    if (!ok) return ctx.reply("âŒ Lá»—i khi cáº­p nháº­t dá»¯ liá»‡u user.");

    ctx.reply(`âœ… ÄĂ£ cá»™ng ${amount} lÆ°á»£t má»i há»£p lá»‡ cho ${targetId}.\nđŸ“ Tá»•ng há»£p lá»‡ má»›i: ${newValid}\nđŸ ÄĂ£ cá»™ng thÆ°á»Ÿng: +${bonusCoins.toLocaleString()} Coin + ${bonusOrders.toLocaleString()} ÄÆ¡n HĂ ng`);
    safeSendMessage(targetId, `đŸ‰ Admin vá»«a cá»™ng thĂªm *${amount}* lÆ°á»£t má»i báº¡n há»£p lá»‡ cho báº¡n!\nđŸ Nháº­n thĂªm: *+${bonusCoins.toLocaleString()} Coin + ${bonusOrders.toLocaleString()} ÄÆ¡n HĂ ng*\nđŸ“ Tá»•ng há»£p lá»‡ hiá»‡n táº¡i: *${newValid}*`, { parse_mode: 'Markdown' });
});

// /setlevel
bot.command('setlevel', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /setlevel <userId> <cáº¥p_Ä‘á»™>");
    const targetId = parts[1];
    const level = parseInt(parts[2]);
    if (level < 1 || level > MAX_TRUCK_LEVEL) return ctx.reply(`âŒ Cáº¥p Ä‘á»™ pháº£i tá»« 1-${MAX_TRUCK_LEVEL}`);
    await touchWallet(targetId, { truckLevel: level });
    ctx.reply(`âœ… ÄĂ£ Ä‘áº·t cáº¥p Ä‘á»™ xe cá»§a ${targetId} lĂªn ${level}`);
});

// /resetdaily
bot.command('resetdaily', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /resetdaily <userId>");
    await touchWallet(targetId, { 
        adsToday: 0, 
        smartlinksToday: 0,
        bonusAdsToday: 0,
        deliveryCount: 0,
        smartlinkCount: 0,
        spinAdCount: 0,
        spinFree: 1,
        chestOpensToday: 0,
        lastResetDate: new Date(new Date().setDate(new Date().getDate() - 1)).toDateString() // Äáº·t ngĂ y reset vá» hĂ´m qua Ä‘á»ƒ kĂ­ch hoáº¡t reset khi mini app load
    });
    ctx.reply(`âœ… ÄĂ£ reset nhiá»‡m vá»¥ hĂ ng ngĂ y cho ${targetId}`);
});

// ToĂ n bá»™ field cáº§n Ä‘Æ°a vá» 0 / tráº¡ng thĂ¡i khá»Ÿi Ä‘áº§u khi reset 1 user hoáº·c táº¥t cáº£ user
// (Ä‘Æ¡n hĂ ng, coin, lÆ°á»£t má»Ÿ rÆ°Æ¡ng, sá»‘ báº¡n má»i Ä‘Æ°á»£c, sá»‘ qc Ä‘Ă£ xem, sá»‘ smartlink Ä‘Ă£ áº¥n, sá»‘ lv xe)
function fullResetFields() {
    return {
        coins: 0,
        orders: 0,
        spins: 0,
        truckLevel: 1, // Cáº¥p xe tháº¥p nháº¥t há»‡ thá»‘ng há»— trá»£ (khĂ´ng cĂ³ cáº¥p 0)
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
        quizDate: '',
        quizFreeUsed: false,
        quizAdUnlocked: 0,
        quizUsedIds: [],
        chestOpensTotal: 0,
        chestOpensToday: 0,
        lifetimeAdsWatched: 0,
        invitedCount: 0,
        validInvites: 0,
        deliveryCount: 0,
        referralMilestones: JSON.stringify([
            { friends: 5, reward: '1,000 Coin + 500 ÄÆ¡n HĂ ng', coins: 1000, orders: 500, spins: 0, claimed: false },
            { friends: 10, reward: '1,500 Coin + 2 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 1500, orders: 0, spins: 2, claimed: false },
            { friends: 20, reward: '2,000 Coin + 1,500 ÄÆ¡n HĂ ng', coins: 2000, orders: 1500, spins: 0, claimed: false },
            { friends: 30, reward: '5,000 ÄÆ¡n HĂ ng + 2 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 0, orders: 5000, spins: 2, claimed: false },
            { friends: 50, reward: '5,000 Coin + 7,000 ÄÆ¡n HĂ ng', coins: 5000, orders: 7000, spins: 0, claimed: false },
            { friends: 75, reward: '10,000 ÄÆ¡n HĂ ng + 5 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 0, orders: 10000, spins: 5, claimed: false },
            { friends: 100, reward: '20,000 ÄÆ¡n HĂ ng + 10 LÆ°á»£t Má»Ÿ RÆ°Æ¡ng', coins: 0, orders: 20000, spins: 10, claimed: false }
        ]),
        lastResetDate: new Date(new Date().setDate(new Date().getDate() - 1)).toDateString()
    };
}

// XĂ³a lá»‹ch sá»­ nháº­p giftcode Ä‘á»ƒ (cĂ¡c) user cĂ³ thá»ƒ NHáº¬P Láº I nhá»¯ng code Ä‘Ă£ tá»«ng nháº­p trÆ°á»›c khi bá»‹ admin
// reset (theo yĂªu cáº§u). Äá»“ng thá»i hoĂ n tráº£ láº¡i Ä‘Ăºng sá»‘ lÆ°á»£t Ä‘Ă£ dĂ¹ng (usedCount) cho tá»«ng code tÆ°Æ¡ng á»©ng,
// trĂ¡nh viá»‡c quá»¹ lÆ°á»£t nháº­p cá»§a code bá»‹ hao há»¥t oan khi cho phĂ©p nháº­p láº¡i.
// userId = null -> Ă¡p dá»¥ng cho Táº¤T Cáº¢ user (dĂ¹ng cho /resetall). userId cá»¥ thá»ƒ -> chá»‰ 1 user (dĂ¹ng cho /reset).
async function resetGiftcodeRedemptions(userId = null) {
    let query = supabase.from('giftcode_redemptions').select('code, userId');
    if (userId) query = query.eq('userId', userId);
    const { data: redemptions, error } = await query;
    if (error) {
        console.error('Lá»—i láº¥y giftcode_redemptions Ä‘á»ƒ reset:', error);
        return;
    }
    if (!redemptions || redemptions.length === 0) return;

    // Gá»™p sá»‘ lÆ°á»£t cáº§n hoĂ n tráº£ theo tá»«ng code
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
    if (delError) console.error('Lá»—i xĂ³a giftcode_redemptions:', delError);
}


// /reset <userId> - Reset TOĂ€N Bá»˜ dá»¯ liá»‡u cá»§a 1 user vá» 0
bot.command('reset', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /reset <userId>");
    const ok = await touchWallet(targetId, fullResetFields());
    await saveWeeklyAdsCounts({ ...(await getWeeklyAdsCounts()), [String(targetId)]: 0 });
    await resetGiftcodeRedemptions(targetId); // Cho phĂ©p user nháº­p láº¡i cĂ¡c code Ä‘Ă£ nháº­p trÆ°á»›c khi reset
    if (ok) ctx.reply(`âœ… ÄĂ£ reset toĂ n bá»™ dá»¯ liá»‡u cá»§a user ${targetId} vá» 0 (ká»ƒ cáº£ lá»‹ch sá»­ nháº­p code).`);
    else ctx.reply(`âŒ Lá»—i khi reset dá»¯ liá»‡u user ${targetId}.`);
});

// /resetall - Reset TOĂ€N Bá»˜ dá»¯ liá»‡u cá»§a Táº¤T Cáº¢ user vá» 0
bot.command('resetall', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { known: resetRow } = await splitUserFields({
        ...fullResetFields(),
        walletUpdatedAt: new Date().toISOString()
    });
    const { error } = await supabase.from('users').update(resetRow).not('id', 'is', null);
    if (error) {
        console.error("Lá»—i /resetall:", error);
        return ctx.reply("âŒ Lá»—i khi reset toĂ n bá»™ dá»¯ liá»‡u: " + error.message);
    }
    await clearUserExtra(null); // XoĂ¡ luĂ´n pháº§n dá»¯ liá»‡u Ä‘ang lÆ°u táº¡m ngoĂ i báº£ng users
    await saveWeeklyAdsCounts({}); // Reset cáº£ BXH Xem QC tuáº§n cho khá»›p Ă½ nghÄ©a "reset toĂ n bá»™"
    await resetGiftcodeRedemptions(null); // Cho phĂ©p Táº¤T Cáº¢ user nháº­p láº¡i cĂ¡c code Ä‘Ă£ nháº­p trÆ°á»›c khi reset
    ctx.reply(`âœ… ÄĂ£ reset toĂ n bá»™ dá»¯ liá»‡u cá»§a Táº¤T Cáº¢ user vá» 0 (ká»ƒ cáº£ lá»‹ch sá»­ nháº­p code).`);
});

// /deleteuser
bot.command('deleteuser', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /deleteuser <userId>");
    await supabase.from('users').delete().eq('id', targetId);
    ctx.reply(`âœ… ÄĂ£ xĂ³a vÄ©nh viá»…n user ${targetId}`);
});

// /doiten - Sá»­a tĂªn hiá»ƒn thá»‹ cá»§a 1 user thá»§ cĂ´ng (dĂ¹ng khi tĂªn bá»‹ lá»—i/ghi sai, khĂ´ng cáº§n chá» user gĂµ láº¡i /start)
bot.command('doiten', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /doiten <userId> <tĂªn má»›i>");
    const targetId = parts[1];
    const newName = parts.slice(2).join(' ');
    const { error } = await supabase.from('users').update({ name: newName }).eq('id', targetId);
    if (error) return ctx.reply("âŒ Lá»—i: " + error.message);
    ctx.reply(`âœ… ÄĂ£ Ä‘á»•i tĂªn user ${targetId} thĂ nh: ${newName}`);
});

// /taocode - Táº¡o code (sá»‘ Ä‘Æ¡n hĂ ng + coin + má»Ÿ rÆ°Æ¡ng + sá»‘ lÆ°á»£t nháº­p + pháº¡m vi Ă¡p dá»¥ng)
// CĂº phĂ¡p: /taocode <mĂ£> <coin> <orders> <spins> <giá»›i_háº¡n> <pháº¡m_vi>
// <pháº¡m_vi> = "admin" (chá»‰ Admin chĂ­nh/phá»¥ má»›i nháº­p Ä‘Æ°á»£c, dĂ¹ng Ä‘á»ƒ test code ná»™i bá»™)
//           hoáº·c "nguoidung" (ai cÅ©ng nháº­p Ä‘Æ°á»£c - máº·c Ä‘á»‹nh dĂ¹ng cho sá»± kiá»‡n public)
bot.command('taocode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.trim().split(/\s+/);
    if (parts.length < 7) return ctx.reply("âŒ Sá»­ dá»¥ng: /taocode <mĂ£> <coin> <orders> <spins> <giá»›i_háº¡n> <pháº¡m_vi>\nPháº¡m vi: admin hoáº·c nguoidung\nVĂ­ dá»¥: /taocode TET2024 500 1000 2 100 nguoidung");

    const [, code, coin, orders, spins, limit, scopeRaw] = parts;
    const scope = scopeRaw.toLowerCase() === 'admin' ? 'admin' : 'nguoidung';
    const baseRow = {
        code: code,
        rewardType: 'multi',
        rewardAmount: parseInt(coin) || 0,
        orders: parseInt(orders) || 0,
        spins: parseInt(spins) || 0,
        limitUses: parseInt(limit) || 0,
        usedCount: 0
    };

    // Thá»­ insert Ä‘áº§y Ä‘á»§ (kĂ¨m scope/createdBy) trÆ°á»›c. Náº¿u báº£ng "giftcodes" trĂªn Supabase CHÆ¯A Ä‘Æ°á»£c thĂªm 2
    // cá»™t nĂ y (chÆ°a cháº¡y SQL migration), Postgres sáº½ bĂ¡o lá»—i "column does not exist" (mĂ£ 42703 hoáº·c
    // PGRST204) -> tá»± Ä‘á»™ng fallback insert KHĂ”NG kĂ¨m scope/createdBy Ä‘á»ƒ code váº«n Ä‘Æ°á»£c táº¡o bĂ¬nh thÆ°á»ng
    // (khi Ä‘Ă³ pháº¡m vi sáº½ máº·c Ä‘á»‹nh lĂ  "NgÆ°á»i dĂ¹ng" cho tá»›i khi admin cháº¡y SQL migration Ä‘á»ƒ báº­t Ä‘Æ°á»£c tĂ­nh
    // nÄƒng pháº¡m vi "Chá»‰ Admin"). Nhá» váº­y lá»‡nh /taocode KHĂ”NG BAO GIá»œ bá»‹ lá»—i vĂ¬ thiáº¿u cá»™t ná»¯a.
    let { error } = await supabase.from('giftcodes').insert({ ...baseRow, scope, createdBy: String(ctx.from.id) });
    let scopeSaved = true;

    if (error && (error.code === '42703' || error.code === 'PGRST204' || /column|scope|createdBy/i.test(error.message || ''))) {
        scopeSaved = false;
        const retry = await supabase.from('giftcodes').insert(baseRow);
        error = retry.error;
    }

    if (error) {
        console.error("Lá»—i táº¡o code:", error);
        return ctx.reply(`âŒ Lá»—i: MĂ£ code \`${code}\` Ä‘Ă£ tá»“n táº¡i hoáº·c dá»¯ liá»‡u khĂ´ng há»£p lá»‡.\n${error.message ? 'Chi tiáº¿t: ' + error.message : ''}`, { parse_mode: 'Markdown' });
    }
    let msg = `âœ… ÄĂ£ táº¡o code: \`${code}\`\nđŸª™ Coin: ${coin}\nđŸ“¦ ÄÆ¡n hĂ ng: ${orders}\nđŸ¡ LÆ°á»£t má»Ÿ rÆ°Æ¡ng: ${spins}\nđŸ”¢ Giá»›i háº¡n: ${limit} láº§n\nđŸ”’ Pháº¡m vi: *${scope === 'admin' ? 'Chá»‰ Admin' : 'NgÆ°á»i dĂ¹ng'}*`;
    if (!scopeSaved) {
        msg += `\n\nâ ï¸ *LÆ°u Ă½:* chÆ°a lÆ°u Ä‘Æ°á»£c pháº¡m vi (báº£ng \`giftcodes\` thiáº¿u cá»™t \`scope\`/\`createdBy\`) nĂªn code nĂ y táº¡m thá»i Ă¡p dá»¥ng cho *NgÆ°á»i dĂ¹ng*. Cháº¡y SQL migration á»Ÿ Ä‘áº§u file server.js rá»“i táº¡o láº¡i code Ä‘á»ƒ báº­t Ä‘Ăºng pháº¡m vi *Chá»‰ Admin*.`;
    }
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /listcodes
bot.command('listcodes', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const { data, error } = await supabase.from('giftcodes').select('*');
    if (error) {
        console.error("Lá»—i láº¥y danh sĂ¡ch code:", error);
        return ctx.reply("âŒ Lá»—i láº¥y danh sĂ¡ch code.");
    }
    if (!data || data.length === 0) return ctx.reply("đŸ“­ ChÆ°a cĂ³ giftcode nĂ o.");
    
    let msg = "đŸ“œ *Danh sĂ¡ch Giftcode:*\n";
    data.forEach(row => {
        msg += `\nđŸ”¹ MĂ£: \`${row.code}\`\n`;
        msg += `   Loáº¡i: ${row.rewardType}\n`;
        if (row.rewardType === 'multi') {
            msg += `   đŸª™ ${row.rewardAmount || 0} Coin | đŸ“¦ ${row.orders || 0} ÄH | đŸ¡ ${row.spins || 0} lÆ°á»£t\n`;
        } else { // Fallback if rewardType is not multi (e.g., just coin, orders, spins)
            msg += `   SL: ${row.rewardAmount}\n`;
        }
        msg += `   ÄĂ£ dĂ¹ng: ${row.usedCount}/${row.limitUses}\n`;
        msg += `   đŸ”’ Pháº¡m vi: ${row.scope === 'admin' ? 'Chá»‰ Admin' : 'NgÆ°á»i dĂ¹ng'}\n`;
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /delcode
bot.command('delcode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("âŒ Sá»­ dá»¥ng: /delcode <mĂ£_code>");
    const { error } = await supabase.from('giftcodes').delete().eq('code', code);
    if (error) {
        console.error("Lá»—i xĂ³a code:", error);
        return ctx.reply("âŒ Lá»—i: KhĂ´ng tĂ¬m tháº¥y code hoáº·c lá»—i database.");
    }
    ctx.reply(`âœ… ÄĂ£ xĂ³a code: ${code}`);
});

// /listnguoinhapcode <mĂ£> - Xem Táº¤T Cáº¢ ngÆ°á»i dĂ¹ng Ä‘Ă£ tá»«ng nháº­p 1 mĂ£ code cá»¥ thá»ƒ (ID, tĂªn, pháº§n thÆ°á»Ÿng
// nháº­n, thá»i gian) - hoáº¡t Ä‘á»™ng ÄÆ¯á»¢C ká»ƒ cáº£ khi admin Ä‘Ă£ /delcode xoĂ¡ mĂ£ Ä‘Ă³ rá»“i, vĂ¬ lá»‡nh nĂ y Ä‘á»c tá»« lá»‹ch sá»­
// nháº­p (giftcode_redemptions) chá»© khĂ´ng phá»¥ thuá»™c mĂ£ code cĂ²n tá»“n táº¡i trong báº£ng giftcodes hay khĂ´ng.
bot.command('listnguoinhapcode', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("âŒ Sá»­ dá»¥ng: /listnguoinhapcode <mĂ£_code>");

    let { data: redemptions, error } = await supabase.from('giftcode_redemptions')
        .select('*').eq('code', code).order('createdAt', { ascending: false });
    if (error) {
        // Báº£ng chÆ°a cĂ³ cá»™t "createdAt" (chÆ°a cháº¡y SQL migration) -> thá»­ láº¡i KHĂ”NG sáº¯p xáº¿p theo thá»i gian
        const retry = await supabase.from('giftcode_redemptions').select('*').eq('code', code);
        redemptions = retry.data;
        error = retry.error;
    }
    if (error) {
        console.error("Lá»—i láº¥y danh sĂ¡ch ngÆ°á»i nháº­p code:", error);
        return ctx.reply("âŒ Lá»—i khi láº¥y dá»¯ liá»‡u tá»« database.");
    }
    if (!redemptions || redemptions.length === 0) return ctx.reply(`đŸ“­ ChÆ°a cĂ³ ai nháº­p mĂ£ \`${code}\`.`, { parse_mode: 'Markdown' });

    let msg = `đŸ“œ *Danh sĂ¡ch ngÆ°á»i Ä‘Ă£ nháº­p code \`${code}\`* (${redemptions.length} lÆ°á»£t)\n`;
    redemptions.slice(0, 50).forEach(r => {
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString('vi-VN') : 'N/A';
        msg += `\nđŸ‘¤ ID: \`${r.userId}\`${r.userName ? ` (${r.userName})` : ''}\n`;
        msg += `   đŸª™ +${r.rewardCoin || 0} Coin | đŸ“¦ +${r.rewardOrders || 0} ÄH | đŸ¡ +${r.rewardSpins || 0} lÆ°á»£t\n`;
        msg += `   đŸ•’ ${time}\n`;
    });
    if (redemptions.length > 50) msg += `\n... vĂ  ${redemptions.length - 50} lÆ°á»£t khĂ¡c (Ä‘Ă£ áº©n bá»›t Ä‘á»ƒ trĂ¡nh tin nháº¯n quĂ¡ dĂ i).`;
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

// /thuhoi <mĂ£> - Thu há»“i TOĂ€N Bá»˜ pháº§n thÆ°á»Ÿng mĂ  mĂ£ code nĂ y Ä‘Ă£ phĂ¡t cho ngÆ°á»i dĂ¹ng (Coin, ÄÆ¡n hĂ ng, LÆ°á»£t má»Ÿ rÆ°Æ¡ng)
// CĂ¡ch hoáº¡t Ä‘á»™ng: trá»« láº¡i Ä‘Ăºng sá»‘ Coin/ÄÆ¡n hĂ ng/LÆ°á»£t má»Ÿ rÆ°Æ¡ng mĂ  code Ä‘Ă£ cá»™ng cho tá»«ng user, giá»›i háº¡n khĂ´ng
// cho Ă¢m (vĂ¬ Coin/ÄÆ¡n hĂ ng lĂ  1 quá»¹ chung dĂ¹ng chung cho nhiá»u hoáº¡t Ä‘á»™ng khĂ¡c nhau, khĂ´ng thá»ƒ tĂ¡ch riĂªng
// "Ä‘á»“ng nĂ o Ä‘áº¿n tá»« code" má»™t khi Ä‘Ă£ tiĂªu - nĂªn náº¿u user Ä‘Ă£ tiĂªu háº¿t, sá»‘ dÆ° sáº½ vá» 0 thay vĂ¬ Ă¢m). Náº¿u user
// khĂ´ng cĂ²n Ä‘á»§ LÆ°á»£t má»Ÿ rÆ°Æ¡ng Ä‘á»ƒ trá»« (Ä‘Ă£ dĂ¹ng Ä‘á»ƒ má»Ÿ rÆ°Æ¡ng rá»“i) thĂ¬ lÆ°á»£t má»Ÿ rÆ°Æ¡ng cÅ©ng chá»‰ vá» tá»‘i thiá»ƒu 0 -
// tÆ°Æ¡ng Ä‘Æ°Æ¡ng thu há»“i láº¡i cĂ¡c lÆ°á»£t má»Ÿ rÆ°Æ¡ng CHÆ¯A DĂ™NG; nhá»¯ng pháº§n thÆ°á»Ÿng Ä‘Ă£ nháº­n Ä‘Æ°á»£c Tá»ª cĂ¡c lÆ°á»£t má»Ÿ rÆ°Æ¡ng
// Ä‘Ă³ (vĂ­ dá»¥ váº­t pháº©m ngáº«u nhiĂªn, hay Ä‘Æ¡n hĂ ng dĂ¹ng Ä‘á»ƒ nĂ¢ng cáº¥p xe) khĂ´ng thá»ƒ truy ngÆ°á»£c chĂ­nh xĂ¡c 100% vĂ¬
// há»‡ thá»‘ng khĂ´ng lÆ°u "pháº£ há»‡" cá»§a tá»«ng Ä‘á»“ng Coin/ÄÆ¡n hĂ ng - Ä‘Ă¢y lĂ  giá»›i háº¡n chung cá»§a má»i há»‡ thá»‘ng cĂ³ quá»¹
// tiá»n tá»‡ dĂ¹ng chung (fungible), khĂ´ng riĂªng gĂ¬ bot nĂ y. Sau khi thu há»“i, xoĂ¡ lá»‹ch sá»­ nháº­p code Ä‘á»ƒ user cĂ³
// thá»ƒ nháº­p láº¡i tá»« Ä‘áº§u náº¿u admin má»Ÿ láº¡i mĂ£, vĂ  tráº£ láº¡i Ä‘Ăºng usedCount cho code.
bot.command('thuhoi', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const code = ctx.message.text.split(' ')[1];
    if (!code) return ctx.reply("âŒ Sá»­ dá»¥ng: /thuhoi <mĂ£_code>");

    const { data: redemptions, error: redErr } = await supabase.from('giftcode_redemptions').select('*').eq('code', code);
    if (redErr) {
        console.error("Lá»—i láº¥y redemptions Ä‘á»ƒ thu há»“i:", redErr);
        return ctx.reply("âŒ Lá»—i khi láº¥y dá»¯ liá»‡u ngÆ°á»i Ä‘Ă£ nháº­p code.");
    }
    if (!redemptions || redemptions.length === 0) return ctx.reply(`đŸ“­ ChÆ°a cĂ³ ai nháº­p mĂ£ \`${code}\`, khĂ´ng cĂ³ gĂ¬ Ä‘á»ƒ thu há»“i.`, { parse_mode: 'Markdown' });

    ctx.reply(`â³ Äang thu há»“i mĂ£ \`${code}\` tá»« ${redemptions.length} ngÆ°á»i dĂ¹ng, vui lĂ²ng Ä‘á»£i...`, { parse_mode: 'Markdown' });

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
            if (r.rewardCoin) logTransaction(r.userId, 'coin', -(r.rewardCoin || 0), `Admin thu há»“i code "${code}" (/thuhoi)`);
            if (r.rewardOrders) logTransaction(r.userId, 'orders', -(r.rewardOrders || 0), `Admin thu há»“i code "${code}" (/thuhoi)`);
            safeSendMessage(r.userId,
                `â ï¸ MĂ£ code \`${code}\` báº¡n Ä‘Ă£ nháº­p trÆ°á»›c Ä‘Ă¢y vá»«a bá»‹ *Admin thu há»“i*.\nđŸª™ -${r.rewardCoin || 0} Coin | đŸ“¦ -${r.rewardOrders || 0} ÄÆ¡n hĂ ng | đŸ¡ -${r.rewardSpins || 0} LÆ°á»£t má»Ÿ rÆ°Æ¡ng\n(Sá»‘ dÆ° khĂ´ng thá»ƒ Ă¢m nĂªn náº¿u báº¡n Ä‘Ă£ tiĂªu háº¿t, pháº§n Ä‘Ă£ tiĂªu khĂ´ng thá»ƒ trá»« thĂªm).`,
                { parse_mode: 'Markdown' }
            );
        } else {
            failCount++;
        }
    }

    // XoĂ¡ lá»‹ch sá»­ nháº­p + tráº£ usedCount vá» 0 Ä‘á»ƒ mĂ£ cĂ³ thá»ƒ Ä‘Æ°á»£c nháº­p láº¡i tá»« Ä‘áº§u náº¿u admin muá»‘n má»Ÿ láº¡i
    await supabase.from('giftcode_redemptions').delete().eq('code', code);
    await supabase.from('giftcodes').update({ usedCount: 0 }).eq('code', code);

    ctx.reply(`âœ… ÄĂ£ thu há»“i mĂ£ \`${code}\`.\nđŸ‘¥ ThĂ nh cĂ´ng: ${successCount} user\nâŒ Lá»—i: ${failCount} user\nđŸ“‹ ÄĂ£ xoĂ¡ lá»‹ch sá»­ nháº­p, mĂ£ cĂ³ thá»ƒ Ä‘Æ°á»£c nháº­p láº¡i tá»« Ä‘áº§u.`, { parse_mode: 'Markdown' });
});

// /saoke <userId> <coin|donhang> - Xem lá»‹ch sá»­ biáº¿n Ä‘á»™ng coin/Ä‘Æ¡n hĂ ng cá»§a 1 user, tá»« nhá»¯ng viá»‡c nĂ o.
// LÆ¯U Ă: chá»‰ hiá»ƒn thá»‹ cĂ¡c khoáº£n mĂ  SERVER biáº¿t rĂµ lĂ½ do (lá»‡nh admin, nháº­p code, má»i báº¡n, rĂºt tiá»n, thÆ°á»Ÿng
// BXH tuáº§n, /thuhoi...). CĂ¡c khoáº£n user tá»± kiáº¿m trong game (giao hĂ ng, nhiá»‡m vá»¥, má»Ÿ rÆ°Æ¡ng, xem QC...) Ä‘Æ°á»£c
// tĂ­nh hoĂ n toĂ n á»Ÿ CLIENT, server chá»‰ nháº­n tá»•ng sá»‘ cuá»‘i cĂ¹ng má»—i ~30s nĂªn KHĂ”NG cĂ³ lĂ½ do chi tiáº¿t Ä‘á»ƒ hiá»ƒn thá»‹.
bot.command('saoke', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3 || !['coin', 'donhang'].includes(parts[2])) {
        return ctx.reply("âŒ Sá»­ dá»¥ng: /saoke <userId> <coin|donhang>");
    }
    const targetId = parts[1];
    const type = parts[2] === 'donhang' ? 'orders' : 'coin';
    const typeLabel = type === 'orders' ? 'ÄÆ¡n HĂ ng' : 'Coin';

    const { data: user } = await supabase.from('users').select('name, coins, orders').eq('id', targetId).single();
    if (!user) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user.");

    const { data: rows, error } = await supabase.from('transactions')
        .select('amount, reason, createdAt').eq('userId', targetId).eq('type', type)
        .order('createdAt', { ascending: false }).limit(100);
    if (error) {
        console.error('Lá»—i láº¥y transactions cho /saoke:', error.message);
        return ctx.reply("âŒ Lá»—i láº¥y sao kĂª (cĂ³ thá»ƒ DB chÆ°a cháº¡y migration báº£ng transactions).");
    }
    if (!rows || rows.length === 0) {
        return ctx.reply(`đŸ“­ KhĂ´ng cĂ³ lá»‹ch sá»­ biáº¿n Ä‘á»™ng ${typeLabel} nĂ o Ä‘Æ°á»£c ghi nháº­n cho user ${targetId} (${user.name || 'N/A'}).\n\nLÆ°u Ă½: chá»‰ cĂ¡c khoáº£n admin/há»‡ thá»‘ng biáº¿t rĂµ lĂ½ do (lá»‡nh admin, nháº­p code, má»i báº¡n, rĂºt tiá»n, thÆ°á»Ÿng tuáº§n...) má»›i Ä‘Æ°á»£c ghi láº¡i - cĂ¡c khoáº£n tá»± kiáº¿m trong game (giao hĂ ng, nhiá»‡m vá»¥, má»Ÿ rÆ°Æ¡ng) khĂ´ng cĂ³ chi tiáº¿t riĂªng.`);
    }

    const currentBalance = type === 'orders' ? (user.orders || 0) : (user.coins || 0);
    const header = `đŸ“ *Sao kĂª ${typeLabel} cá»§a ${user.name || 'N/A'} (${targetId})*\nđŸ’° Sá»‘ dÆ° hiá»‡n táº¡i: *${currentBalance.toLocaleString()}*\nđŸ“‹ ${rows.length} biáº¿n Ä‘á»™ng gáº§n nháº¥t (má»›i nháº¥t trÆ°á»›c):\n\n`;

    const entries = rows.map(r => {
        const sign = r.amount >= 0 ? 'â•' : 'â–';
        const time = r.createdAt ? new Date(r.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'N/A';
        return `${sign} ${Math.abs(r.amount).toLocaleString()} - ${r.reason || 'KhĂ´ng rĂµ'}\nđŸ•’ ${time}\n---\n`;
    });

    // Chia thĂ nh nhiá»u tin nháº¯n nhá» (dĂ¹ng láº¡i cĂ¡ch xá»­ lĂ½ Ä‘Ă£ sá»­a á»Ÿ /donrutall) Ä‘á»ƒ khĂ´ng bao giá» bá»‹ cáº¯t cá»¥t dá»¯ liá»‡u
    const chunks = [];
    let current = header;
    for (const entry of entries) {
        if ((current + entry).length > 3500) {
            chunks.push(current);
            current = entry;
        } else {
            current += entry;
        }
    }
    if (current.trim()) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
        const pageInfo = chunks.length > 1 ? `\nđŸ“„ (Trang ${i + 1}/${chunks.length})` : '';
        await ctx.reply(chunks[i] + pageInfo, { parse_mode: 'Markdown' }).catch(async () => {
            await ctx.reply(chunks[i] + pageInfo).catch(() => {});
        });
    }
});

// /checkID
bot.command('checkID', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /checkID <userId>");
    
    const { data, error } = await supabase.from('users').select('*').eq('id', targetId).single();
    if (error || !data) return ctx.reply("âŒ KhĂ´ng tĂ¬m tháº¥y user hoáº·c lá»—i database.");
    
    const { data: withdraws } = await supabase.from('withdrawals').select('amount').eq('userId', targetId).eq('status', 'success');
    const totalWithdrawn = withdraws ? withdraws.reduce((sum, w) => sum + (w.amount || 0), 0) : 0;
    
    // Check IP trĂ¹ng
    const duplicates = await checkDuplicateIP(targetId, data.ip);
    const dupText = duplicates.length > 0 
        ? `\nâ ï¸ *IP TRĂ™NG Vá»I:*\n${duplicates.map(d => `- ${d.name} (${d.id})`).join('\n')}`
        : '';
    
    ctx.reply(
        `đŸ‘¤ *ThĂ´ng tin user:*\n` +
        `đŸ†” ID: ${data.id}\n` +
        `đŸ‘¤ TĂªn: ${data.name}\n` +
        `đŸ“¦ ÄÆ¡n hĂ ng: ${data.orders}\n` +
        `đŸª™ Coin: ${data.coins}\n` +
        `đŸ› Level xe: ${data.truckLevel}\n` +
        `đŸ LÆ°á»£t má»Ÿ rÆ°Æ¡ng cĂ²n láº¡i: ${data.spins || 0}\n` +
        `đŸ Tá»•ng sá»‘ lÆ°á»£t Ä‘Ă£ má»Ÿ rÆ°Æ¡ng: ${(data.chestOpensTotal || 0).toLocaleString()}\n` +
        `đŸ Sá»‘ lÆ°á»£t má»Ÿ rÆ°Æ¡ng hĂ´m nay: ${(data.chestOpensToday || 0).toLocaleString()}\n` +
        `đŸŒ IP: ${data.ip || 'ChÆ°a cĂ³'}\n` +
        `đŸ’° Tá»•ng tiá»n Ä‘Ă£ rĂºt: ${totalWithdrawn.toLocaleString()} VNÄ\n` +
        `đŸ‘¥ ÄĂ£ má»i: ${data.invitedCount} (Há»£p lá»‡: ${data.validInvites})` +
        dupText,
        { parse_mode: 'Markdown' }
    );
});

// /hoantra - HoĂ n tráº£ Ä‘Æ¡n rĂºt tiá»n chÆ°a duyá»‡t
bot.command('hoantra', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) return ctx.reply("âŒ Sá»­ dá»¥ng: /hoantra <userId> (hoĂ n tráº£ táº¥t cáº£ Ä‘Æ¡n chÆ°a duyá»‡t cá»§a user)");
    const targetId = parts[1];
    
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (withdrawError) {
        console.error("Lá»—i láº¥y Ä‘Æ¡n rĂºt Ä‘á»ƒ hoĂ n tráº£:", withdrawError);
        return ctx.reply("âŒ Lá»—i database khi láº¥y Ä‘Æ¡n rĂºt.");
    }
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("âŒ KhĂ´ng cĂ³ Ä‘Æ¡n chá» duyá»‡t cá»§a user nĂ y.");
    
    let totalRefundedOrdersValue = 0;
    for (const w of withdrawals) {
        // TĂ­nh láº¡i sá»‘ Ä‘Æ¡n hĂ ng Ä‘Ă£ bá»‹ trá»« khi user yĂªu cáº§u rĂºt (1000 VNÄ = 10000 Ä‘Æ¡n hĂ ng)
        const ordersToRefund = Math.floor((w.amount || 0) / 1000) * 10000; 
        
        await supabase.from('withdrawals').update({ status: 'refunded', reason: 'HoĂ n tráº£ bá»Ÿi admin' }).eq('id', w.id);
        
        const { data: userData, error: userError } = await supabase.from('users').select('orders').eq('id', targetId).single();
        if (userError) {
            console.error("Lá»—i láº¥y user Ä‘á»ƒ hoĂ n tráº£ Ä‘Æ¡n hĂ ng:", userError);
            continue; // Bá» qua náº¿u lá»—i, cá»‘ gáº¯ng xá»­ lĂ½ cĂ¡c yĂªu cáº§u rĂºt khĂ¡c
        }
        const newOrders = (userData?.orders || 0) + ordersToRefund;
        await touchWallet(targetId, { orders: newOrders });
        
        totalRefundedOrdersValue += ordersToRefund; // ÄĂ¢y lĂ  giĂ¡ trá»‹ Ä‘Æ¡n hĂ ng, khĂ´ng pháº£i sá»‘ tiá»n
        await safeSendMessage(targetId, `đŸ”„ YĂªu cáº§u rĂºt tiá»n cá»§a báº¡n Ä‘Ă£ Ä‘Æ°á»£c HOĂ€N TRáº¢.\nđŸ“¦ Sá»‘ Ä‘Æ¡n hĂ ng Ä‘Æ°á»£c hoĂ n: ${ordersToRefund.toLocaleString()}`);
    }
    
    ctx.reply(`âœ… ÄĂ£ hoĂ n tráº£ ${withdrawals.length} Ä‘Æ¡n cá»§a ${targetId}.\nđŸ“¦ Tá»•ng giĂ¡ trá»‹ Ä‘Æ¡n hĂ ng hoĂ n tráº£: ${totalRefundedOrdersValue.toLocaleString()}`);
});

// /duyet + ID
bot.command('duyet', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetId = ctx.message.text.split(' ')[1];
    if (!targetId) return ctx.reply("âŒ Sá»­ dá»¥ng: /duyet <userId>");
    
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (withdrawError) {
        console.error("Lá»—i láº¥y Ä‘Æ¡n rĂºt Ä‘á»ƒ duyá»‡t:", withdrawError);
        return ctx.reply("âŒ Lá»—i database khi láº¥y Ä‘Æ¡n rĂºt.");
    }
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("âŒ KhĂ´ng cĂ³ yĂªu cáº§u rĂºt tiá»n nĂ o Ä‘ang chá» duyá»‡t cho user nĂ y.");
    
    let totalApprovedAmount = 0;
    for (const w of withdrawals) {
        await supabase.from('withdrawals').update({ status: 'success', reason: 'ÄĂ£ duyá»‡t bá»Ÿi admin' }).eq('id', w.id);
        totalApprovedAmount += w.amount;
    }
    
    await safeSendMessage(targetId, `âœ… YĂªu cáº§u rĂºt tiá»n cá»§a báº¡n Ä‘Ă£ Ä‘Æ°á»£c *DUYá»†T*!\nđŸ’° Tá»•ng sá»‘ tiá»n: ${totalApprovedAmount.toLocaleString()} VNÄ\nTiá»n sáº½ sá»›m Ä‘Æ°á»£c chuyá»ƒn vĂ o tĂ i khoáº£n.`, { parse_mode: 'Markdown' });
    ctx.reply(`âœ… ÄĂ£ duyá»‡t ${withdrawals.length} yĂªu cáº§u rĂºt cá»§a ${targetId}. Tá»•ng: ${totalApprovedAmount.toLocaleString()} VNÄ`);
});

// /huy + ID + lĂ½ do
bot.command('huy', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const parts = ctx.message.text.split(' ');
    if (parts.length < 3) return ctx.reply("âŒ Sá»­ dá»¥ng: /huy <userId> <lĂ½ do>");
    const targetId = parts[1];
    const reason = parts.slice(2).join(' ');
    
    const { data: withdrawals, error: withdrawError } = await supabase.from('withdrawals').select('id, amount').eq('userId', targetId).eq('status', 'pending');
    if (withdrawError) {
        console.error("Lá»—i láº¥y Ä‘Æ¡n rĂºt Ä‘á»ƒ há»§y:", withdrawError);
        return ctx.reply("âŒ Lá»—i database khi láº¥y Ä‘Æ¡n rĂºt.");
    }
    if (!withdrawals || withdrawals.length === 0) return ctx.reply("âŒ KhĂ´ng cĂ³ yĂªu cáº§u rĂºt tiá»n nĂ o Ä‘ang chá» duyá»‡t.");
    
    let totalRefundedOrdersValue = 0;
    for (const w of withdrawals) {
        // TĂ­nh láº¡i sá»‘ Ä‘Æ¡n hĂ ng Ä‘Ă£ bá»‹ trá»« khi user yĂªu cáº§u rĂºt (1000 VNÄ = 10000 Ä‘Æ¡n hĂ ng)
        const ordersToRefund = Math.floor((w.amount || 0) / 1000) * 10000; 

        await supabase.from('withdrawals').update({ status: 'rejected', reason: reason }).eq('id', w.id);
        
        const { data: userData, error: userError } = await supabase.from('users').select('orders').eq('id', targetId).single();
        if (userError) {
            console.error("Lá»—i láº¥y user Ä‘á»ƒ hoĂ n tráº£ Ä‘Æ¡n hĂ ng khi há»§y:", userError);
            continue;
        }
        const newOrders = (userData?.orders || 0) + ordersToRefund;
        await touchWallet(targetId, { orders: newOrders });
        
        totalRefundedOrdersValue += ordersToRefund;
        await safeSendMessage(targetId, `âŒ YĂªu cáº§u rĂºt tiá»n cá»§a báº¡n Ä‘Ă£ bá»‹ *Há»¦Y*.\nđŸ“ LĂ½ do: ${reason}\nđŸ“¦ Sá»‘ Ä‘Æ¡n hĂ ng Ä‘Ă£ Ä‘Æ°á»£c hoĂ n tráº£: ${ordersToRefund.toLocaleString()}`, { parse_mode: 'Markdown' });
    }
    
    ctx.reply(`âœ… ÄĂ£ há»§y yĂªu cáº§u rĂºt tiá»n cá»§a ${targetId}.\nđŸ“ LĂ½ do: ${reason}\nđŸ“¦ Tá»•ng giĂ¡ trá»‹ Ä‘Æ¡n hĂ ng hoĂ n tráº£: ${totalRefundedOrdersValue.toLocaleString()}`);
});

// /donrutall - Thá»‘ng kĂª Ä‘Æ¡n rĂºt chÆ°a duyá»‡t + check IP trĂ¹ng
bot.command('donrutall', async (ctx) => {
    if (!isAdmin(ctx)) return;
    
    const { data, error } = await supabase.from('withdrawals').select('id, userId, amount, ordersAmount, method, accountInfo, bankName, accountName, accountNumber, status, createdAt').eq('status', 'pending').order('createdAt', { ascending: true });
    if (error) {
        console.error("Lá»—i láº¥y danh sĂ¡ch Ä‘Æ¡n rĂºt:", error);
        return ctx.reply("âŒ Lá»—i láº¥y danh sĂ¡ch Ä‘Æ¡n rĂºt.");
    }
    if (!data || data.length === 0) return ctx.reply("đŸ“­ KhĂ´ng cĂ³ Ä‘Æ¡n rĂºt tiá»n nĂ o Ä‘ang chá» duyá»‡t.");
    
    let msg = `đŸ“‹ *Danh sĂ¡ch ${data.length} Ä‘Æ¡n rĂºt CHá»œ DUYá»†T:*\n`;
    
    for (const w of data) {
        const { data: userData, error: userError } = await supabase.from('users').select('ip, name').eq('id', w.userId).single();
        if (userError) {
            console.error("Lá»—i láº¥y user data cho donrutall:", userError);
            continue;
        }

        const ip = userData?.ip || 'ChÆ°a cĂ³';
        const ordersDeducted = w.ordersAmount || (Math.floor((w.amount || 0) / 1000) * 10000);
        const stkSdt = w.accountNumber || w.accountInfo || 'N/A';
        const chuTK = w.accountName || 'KhĂ´ng cĂ³';
        const thoiGian = w.createdAt ? new Date(w.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'N/A';
        
        // Check IP trĂ¹ng
        const duplicates = await checkDuplicateIP(w.userId, userData?.ip);
        const dupText = duplicates.length > 0 ? `\nâ ï¸ *IP TRĂ™NG:* ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}` : '';
        
        msg += `\nđŸ†” ID: ${w.userId}\nđŸ‘¤ TĂªn: ${userData?.name || 'N/A'}\nđŸ’³ PhÆ°Æ¡ng Thá»©c: ${w.method}\nđŸ“± STK/SÄT: ${stkSdt}\nđŸ‘¤ Chá»§ TK: ${chuTK}\nđŸ’° Sá»‘ Tiá»n: ${w.amount.toLocaleString()} VNÄ\nđŸ“¦ ÄÆ¡n HĂ ng ÄĂ£ Trá»«: ${ordersDeducted.toLocaleString()}\nđŸŒ IP: ${ip}\nđŸ•’ Thá»i Gian RĂºt Tiá»n: ${thoiGian}${dupText}\n---\n`;
        
        // Gá»­i tin nháº¯n riĂªng cho admin náº¿u IP trĂ¹ng
        if (duplicates.length > 0) {
            await safeSendMessage(ADMIN_ID, 
                `â ï¸ *Cáº¢NH BĂO IP TRĂ™NG TRONG ÄÆ N RĂT!*\n` +
                `đŸ‘¤ User: ${userData?.name} (${w.userId})\n` +
                `đŸŒ IP: ${ip}\n` +
                `â ï¸ TrĂ¹ng vá»›i: ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}\n` +
                `đŸ’° YĂªu cáº§u rĂºt: ${w.amount.toLocaleString()} VNÄ\n` +
                `đŸ“ TTKH: ${w.accountInfo || 'N/A'}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
    
    // FIX Lá»–I: trÆ°á»›c Ä‘Ă¢y khi tin nháº¯n > 4000 kĂ½ tá»± thĂ¬ Cáº®T Bá» toĂ n bá»™ pháº§n cĂ²n láº¡i (máº¥t dá»¯ liá»‡u cĂ¡c Ä‘Æ¡n
    // rĂºt phĂ­a sau), chá»‰ bĂ¡o "quĂ¡ dĂ i, kiá»ƒm tra web admin" - trong khi khĂ´ng cĂ³ web admin tháº­t Ä‘á»ƒ xem chi
    // tiáº¿t, nghÄ©a lĂ  cĂ¡c Ä‘Æ¡n Ä‘Ă³ khĂ´ng thá»ƒ xem Ä‘Æ°á»£c ná»¯a. Giá» chia thĂ nh NHIá»€U tin nháº¯n nhá» (má»—i tin â‰¤ 3500
    // kĂ½ tá»±, luĂ´n cáº¯t Ä‘Ăºng ranh giá»›i giá»¯a 2 Ä‘Æ¡n rĂºt nhá» dáº¥u "---\n", khĂ´ng cáº¯t giá»¯a 1 Ä‘Æ¡n) vĂ  gá»­i láº§n lÆ°á»£t,
    // Ä‘áº£m báº£o khĂ´ng máº¥t báº¥t ká»³ Ä‘Æ¡n rĂºt nĂ o dĂ¹ cĂ³ bao nhiĂªu Ä‘Æ¡n Ä‘ang chá».
    const header = `đŸ“‹ *Danh sĂ¡ch ${data.length} Ä‘Æ¡n rĂºt CHá»œ DUYá»†T:*\n`;
    const entries = msg.replace(header, '').split('---\n').filter(e => e.trim());
    const chunks = [];
    let current = header;
    for (const entry of entries) {
        const withEntry = entry + '---\n';
        if ((current + withEntry).length > 3500) {
            chunks.push(current);
            current = withEntry;
        } else {
            current += withEntry;
        }
    }
    if (current.trim()) chunks.push(current);

    for (let i = 0; i < chunks.length; i++) {
        const pageInfo = chunks.length > 1 ? `\nđŸ“„ (Trang ${i + 1}/${chunks.length})` : '';
        await ctx.reply(chunks[i] + pageInfo, { parse_mode: 'Markdown' }).catch(async (e) => {
            console.error('Lá»—i gá»­i trang donrutall, gá»­i láº¡i khĂ´ng dĂ¹ng Markdown:', e.message);
            await ctx.reply(chunks[i] + pageInfo).catch(() => {}); // Fallback náº¿u Markdown bá»‹ lá»—i kĂ½ tá»± Ä‘áº·c biá»‡t
        });
    }
});

// /broadcast
bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const msg = ctx.message.text.substring(11).trim(); // Bá» '/broadcast '
    if (!msg) return ctx.reply("âŒ Nháº­p tin nháº¯n cáº§n gá»­i!");
    
    ctx.reply("â³ Äang gá»­i tin nháº¯n...");
    const { data: users, error } = await supabase.from('users').select('id');
    if (error) {
        console.error("Lá»—i láº¥y danh sĂ¡ch user Ä‘á»ƒ broadcast:", error);
        return ctx.reply("âŒ Lá»—i database khi láº¥y danh sĂ¡ch ngÆ°á»i dĂ¹ng.");
    }

    let successCount = 0;
    
    for (const u of users) {
        const sent = await safeSendMessage(u.id, `đŸ“¢ *THĂ”NG BĂO Tá»ª ADMIN:*\n\n${msg}`, { parse_mode: 'Markdown' });
        if (sent) successCount++;
        await new Promise(r => setTimeout(r, 50)); // Giá»›i háº¡n tá»‘c Ä‘á»™ gá»­i
    }
    ctx.reply(`âœ… ÄĂ£ gá»­i thĂ nh cĂ´ng Ä‘áº¿n ${successCount}/${users.length} ngÆ°á»i dĂ¹ng.`);
});

// ==================== RESET BXH TUáº¦N + TRAO THÆ¯á»NG TOP 1-3 ====================
// TrÆ°á»›c Ä‘Ă¢y viá»‡c "reset BXH má»—i tuáº§n" chá»‰ Ä‘Æ°á»£c xá»­ lĂ½ á»Ÿ CLIENT (index.html), nghÄ©a lĂ : (1) chá»‰ cháº¡y khi cĂ³
// user má»Ÿ app Ä‘Ăºng lĂºc sang tuáº§n má»›i, (2) khĂ´ng há» trao thÆ°á»Ÿng tháº­t cho top 1-3 (chá»‰ xĂ³a sá»‘ liá»‡u hiá»ƒn thá»‹
// táº¡m trĂªn mĂ¡y ngÆ°á»i Ä‘Ă³). Chuyá»ƒn toĂ n bá»™ sang SERVER Ä‘á»ƒ cháº¡y Ä‘Ăºng giá», Ä‘Ă¡ng tin cáº­y, vĂ  trao thÆ°á»Ÿng tháº­t.

// XĂ¡c Ä‘á»‹nh "mĂ£ tuáº§n" hiá»‡n táº¡i (tuáº§n báº¯t Ä‘áº§u tá»« Thá»© 2, giá»‘ng há»‡t cĂ¡ch tĂ­nh á»Ÿ frontend) Ä‘á»ƒ biáº¿t Ä‘Ă£ sang tuáº§n má»›i hay chÆ°a
// TĂ­nh "mĂ£ tuáº§n" theo má»‘c CHá»¦ NHáº¬T 00:00 (khá»›p vá»›i Ä‘á»“ng há»“ Ä‘áº¿m ngÆ°á»£c "â³ Reset vĂ o 00:00 Chá»§ Nháº­t" hiá»ƒn thá»‹
// cho ngÆ°á»i dĂ¹ng á»Ÿ tab BXH) - KHĂ”NG dĂ¹ng ISO week (Thá»© 2) Ä‘á»ƒ trĂ¡nh lá»‡ch 1 ngĂ y so vá»›i nhá»¯ng gĂ¬ ngÆ°á»i dĂ¹ng
// nhĂ¬n tháº¥y trĂªn giao diá»‡n.
function getWeekIdentifier(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // Chá»§ Nháº­t = 0
    d.setDate(d.getDate() - day); // LĂ¹i vá» Ä‘Ăºng Chá»§ Nháº­t gáº§n nháº¥t (hoáº·c giá»¯ nguyĂªn náº¿u hĂ´m nay lĂ  Chá»§ Nháº­t)
    return d.toISOString().slice(0, 10);
}

// Pháº§n thÆ°á»Ÿng máº·c Ä‘á»‹nh cho Top 1-3 BXH má»i báº¡n hĂ ng tuáº§n (cĂ³ thá»ƒ chá»‰nh láº¡i sá»‘ nĂ y theo Ă½ muá»‘n)
const WEEKLY_TOP_REWARDS = [
    { rank: 1, orders: 100000, spins: 10, label: 'đŸ¥‡ Háº¡ng 1' },
    { rank: 2, orders: 50000, spins: 5, label: 'đŸ¥ˆ Háº¡ng 2' },
    { rank: 3, orders: 25000, spins: 3, label: 'đŸ¥‰ Háº¡ng 3' }
];

const WEEKLY_ADS_KEY = 'weekly_ads_counts';
let weeklyAdsWriteQueue = Promise.resolve();
async function getWeeklyAdsCounts() {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', WEEKLY_ADS_KEY).maybeSingle();
    if (error) throw error;
    const value = data?.value;
    if (!value) return {};
    if (typeof value === 'string') { try { return JSON.parse(value); } catch (_) { return {}; } }
    return typeof value === 'object' && !Array.isArray(value) ? value : {};
}
async function saveWeeklyAdsCounts(counts) {
    const { error } = await supabase.from('app_settings').upsert({ key:WEEKLY_ADS_KEY, value:counts }, { onConflict:'key' });
    if (error) throw error;
}
function incrementWeeklyAds(userId) {
    const run = weeklyAdsWriteQueue.then(async () => {
        const counts = await getWeeklyAdsCounts();
        counts[String(userId)] = Number(counts[String(userId)] || 0) + 1;
        await saveWeeklyAdsCounts(counts);
        return counts[String(userId)];
    });
    weeklyAdsWriteQueue = run.catch(() => {});
    return run;
}

async function weeklyLeaderboardReset() {
    try {
        const currentWeek = getWeekIdentifier(new Date());

        // ===== BXH Má»œI Báº N =====
        const { data: inviteState } = await supabase.from('weekly_state').select('*').eq('id', 1).single();
        if (!inviteState || inviteState.lastWeekKey !== currentWeek) {
            const inviteCols = await getUserColumns();
            const hasWeeklyInviteColumn = inviteCols.has('weeklyValidInvites');
            let topUsers = [], topError = null;
            if (hasWeeklyInviteColumn) {
                const r = await supabase.from('users')
                    .select('id, name, weeklyValidInvites').gt('weeklyValidInvites', 0)
                    .order('weeklyValidInvites', { ascending: false }).limit(3);
                topUsers = r.data || []; topError = r.error || null;
            } else {
                // Cá»™t chÆ°a cĂ³ trong báº£ng users -> xáº¿p háº¡ng theo sá»‘ Ä‘áº¿m Ä‘ang lÆ°u trong app_settings
                const all = await getUserExtraAll();
                const ids = Object.entries(all)
                    .filter(([, v]) => Number(v?.weeklyValidInvites || 0) > 0)
                    .sort((a, b) => Number(b[1].weeklyValidInvites) - Number(a[1].weeklyValidInvites))
                    .slice(0, 3).map(([id]) => id);
                if (ids.length > 0) {
                    const { data: rows } = await supabase.from('users').select('id, name').in('id', ids);
                    const names = Object.fromEntries((rows || []).map(u => [String(u.id), u.name]));
                    topUsers = ids.map(id => ({ id, name: names[id] || ('User ' + id), weeklyValidInvites: Number(all[id].weeklyValidInvites || 0) }));
                }
            }
            if (topError) {
                console.error('Lá»—i láº¥y top BXH má»i báº¡n tuáº§n:', topError);
            } else {
                for (let i = 0; i < topUsers.length; i++) {
                    const u = topUsers[i], prize = WEEKLY_TOP_REWARDS[i];
                    if (!prize) break;
                    const { data: cur } = await supabase.from('users').select('orders, spins').eq('id', u.id).single();
                    await touchWallet(u.id, { orders: (cur?.orders || 0) + prize.orders, spins: (cur?.spins || 0) + prize.spins });
                    logTransaction(u.id, 'orders', prize.orders, `${prize.label} BXH má»i báº¡n tuáº§n`);
                    await safeSendMessage(u.id,
                        `đŸ† *CHĂC Má»ªNG!* Báº¡n Ä‘áº¡t *${prize.label}* Báº£ng Xáº¿p Háº¡ng Má»i Báº¡n tuáº§n nĂ y vá»›i *${u.weeklyValidInvites}* lÆ°á»£t má»i há»£p lá»‡!\nđŸ Pháº§n thÆ°á»Ÿng: *+${prize.orders.toLocaleString()} ÄÆ¡n HĂ ng + ${prize.spins} LÆ°á»£t Má»Ÿ RÆ°Æ¡ng*\n\nBXH Ä‘Ă£ Ä‘Æ°á»£c reset cho tuáº§n má»›i!`,
                        { parse_mode: 'Markdown' }
                    );
                    logActivity(`đŸ† ${maskName(u.name)} Ä‘áº¡t ${prize.label} BXH má»i báº¡n tuáº§n nĂ y`);
                }
                if (hasWeeklyInviteColumn) {
                    await supabase.from('users').update({ weeklyValidInvites: 0 }).gt('weeklyValidInvites', -1);
                } else {
                    const all = await getUserExtraAll();
                    Object.keys(all).forEach(k => { if (all[k] && all[k].weeklyValidInvites) all[k].weeklyValidInvites = 0; });
                    await saveUserExtraAll(all);
                }
                await supabase.from('weekly_state').upsert({ id: 1, lastWeekKey: currentWeek });
            }
        }

        // ===== BXH XEM QC =====
        const { data: adsState } = await supabase.from('weekly_state').select('*').eq('id', 2).single();
        if (!adsState || adsState.lastWeekKey !== currentWeek) {
            const counts = await getWeeklyAdsCounts();
            const topIds = Object.entries(counts).filter(([,count]) => Number(count)>0)
                .sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,3).map(([id])=>id);
            const { data: adUsers, error: adsError } = topIds.length
                ? await supabase.from('users').select('id,name').in('id',topIds)
                : { data:[], error:null };
            const names = Object.fromEntries((adUsers||[]).map(u=>[String(u.id),u.name]));
            const topAds = topIds.map(id=>({id,name:names[id]||('User '+id),weeklyAdsCount:Number(counts[id]||0)}));
            if (adsError) {
                console.error('Lá»—i láº¥y top BXH Xem QC tuáº§n:', adsError);
            } else {
                for (let i = 0; i < topAds.length; i++) {
                    const u = topAds[i], prize = WEEKLY_TOP_REWARDS[i];
                    if (!prize) break;
                    const { data: cur } = await supabase.from('users').select('orders, spins').eq('id', u.id).single();
                    await touchWallet(u.id, { orders: (cur?.orders || 0) + prize.orders, spins: (cur?.spins || 0) + prize.spins });
                    logTransaction(u.id, 'orders', prize.orders, `${prize.label} BXH Xem QC tuáº§n`);
                    await safeSendMessage(u.id,
                        `đŸ“º *CHĂC Má»ªNG!* Báº¡n Ä‘áº¡t *${prize.label}* Báº£ng Xáº¿p Háº¡ng Xem QC tuáº§n nĂ y vá»›i *${u.weeklyAdsCount}* lÆ°á»£t xem!\nđŸ Pháº§n thÆ°á»Ÿng: *+${prize.orders.toLocaleString()} ÄÆ¡n HĂ ng + ${prize.spins} LÆ°á»£t Má»Ÿ RÆ°Æ¡ng*\n\nBXH Xem QC Ä‘Ă£ Ä‘Æ°á»£c reset cho tuáº§n má»›i!`,
                        { parse_mode: 'Markdown' }
                    );
                    logActivity(`đŸ“º ${maskName(u.name)} Ä‘áº¡t ${prize.label} BXH Xem QC tuáº§n nĂ y`);
                }
                await saveWeeklyAdsCounts({});
                await supabase.from('weekly_state').upsert({ id: 2, lastWeekKey: currentWeek });
            }
        }

        console.log(`âœ… Kiá»ƒm tra/reset BXH tuáº§n xong: ${currentWeek}`);
    } catch (e) {
        console.error('Lá»—i weeklyLeaderboardReset:', e);
    }
}
weeklyLeaderboardReset(); // Kiá»ƒm tra ngay lĂºc server khá»Ÿi Ä‘á»™ng (phĂ²ng trÆ°á»ng há»£p server táº¯t Ä‘Ăºng lĂºc qua tuáº§n má»›i)
setInterval(weeklyLeaderboardReset, 60 * 60 * 1000); // Kiá»ƒm tra láº¡i má»—i giá» Ä‘á»ƒ khĂ´ng bá» lá»¡ má»‘c sang tuáº§n


// (vĂ­ dá»¥ lá»—i 409 Conflict do phiĂªn báº£n deploy cÅ© váº«n cĂ²n Ä‘ang polling khi Render táº¡o instance má»›i),
// Promise sáº½ bá»‹ reject mĂ  khĂ´ng ai xá»­ lĂ½ -> Node coi lĂ  "unhandledRejection" vĂ  THOĂT TIáº¾N TRĂŒNH vá»›i mĂ£ lá»—i 1
// (Ä‘Ă¢y chĂ­nh lĂ  nguyĂªn nhĂ¢n phá»• biáº¿n khiáº¿n deploy trĂªn Render bĂ¡o "Exited with status 1" dĂ¹ code khĂ´ng cĂ³ lá»—i cĂº phĂ¡p).
bot.command('ban_ip', async (ctx) => {
    if (!isMainAdmin(ctx)) return;
    
    const args = ctx.message.text.split(' ');
    const ip = args[1];
    if (!ip) { ctx.reply('âŒ DĂ¹ng: /ban_ip <IP>'); return; }
    
    // Ban toĂ n bá»™ user tá»« IP nĂ y
    const ipColumn = (await getUserColumns()).has('ip_address') ? 'ip_address' : 'ip';
    const { data: users, error } = await supabase
        .from('users')
        .select('id')
        .eq(ipColumn, ip);
    
    if (users && users.length > 0) {
        await supabase.from('users').update({ isBanned: true }).eq(ipColumn, ip);
        ctx.reply(`âœ… ÄĂ£ ban ${users.length} user tá»« IP ${ip}`);
    } else {
        ctx.reply(`â„¹ï¸ KhĂ´ng tĂ¬m tháº¥y user nĂ o tá»« IP ${ip}`);
    }
});

(async () => {
    try {
        await bot.telegram.deleteWebhook({ drop_pending_updates: true });
        await bot.launch({ dropPendingUpdates: true });
        console.log("âœ… Bot is running...");
    } catch (err) {
        console.error("âŒ Lá»—i khá»Ÿi Ä‘á»™ng bot (server váº«n tiáº¿p tá»¥c cháº¡y Ä‘á»ƒ phá»¥c vá»¥ API/Web):", err.message);
    }
})();

// Dá»«ng bot Ä‘Ăºng cĂ¡ch khi Render táº¯t instance cÅ© lĂºc deploy báº£n má»›i, trĂ¡nh xung Ä‘á»™t polling giá»¯a 2 phiĂªn báº£n
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// LÆ°á»›i an toĂ n: khĂ´ng Ä‘á»ƒ 1 lá»—i báº¥t Ä‘á»“ng bá»™ chÆ°a Ä‘Æ°á»£c catch lĂ m sáº­p toĂ n bá»™ server ngoĂ i Ă½ muá»‘n
process.on('unhandledRejection', (reason) => {
    console.error('â ï¸ Unhandled Rejection (Ä‘Ă£ Ä‘Æ°á»£c cháº·n Ä‘á»ƒ server khĂ´ng bá»‹ crash):', reason);
});
process.on('uncaughtException', (err) => {
    console.error('â ï¸ Uncaught Exception (Ä‘Ă£ Ä‘Æ°á»£c cháº·n Ä‘á»ƒ server khĂ´ng bá»‹ crash):', err);
});

// ==================== API CHO FRONTEND ====================

// API Ä‘á»ƒ Mini App kiá»ƒm tra tráº¡ng thĂ¡i khoĂ¡ báº£o trĂ¬ (KHĂ”NG bá»‹ cháº·n bá»Ÿi middleware bĂªn dÆ°á»›i)
app.get('/api/lock-status', (req, res) => {
    // Admin CHĂNH (ID 6327666718) luĂ´n bypass khĂ³a báº£o trĂ¬ Ä‘á»ƒ cĂ³ thá»ƒ tá»± kiá»ƒm tra/test Mini App
    const isMainAdminRequest = String(req.query.userId) === String(ADMIN_ID);
    res.json({ locked: BOT_LOCKED && !isMainAdminRequest, message: MAINTENANCE_MESSAGE });
});

// Láº¥y userId cá»§a ngÆ°á»i gá»i API, thá»­ nhiá»u nguá»“n khĂ¡c nhau (query, body, hoáº·c Ä‘oáº¡n cuá»‘i path dáº¡ng /api/xxx/:id)
function extractRequestUserId(req) {
    return req.query?.userId || req.body?.userId || req.body?.id || req.path.split('/').filter(Boolean).pop();
}

// Cháº·n toĂ n bá»™ API cá»§a Mini App khi bot Ä‘ang bá»‹ khoĂ¡ báº£o trĂ¬ (trá»« chĂ­nh API kiá»ƒm tra khoĂ¡ á»Ÿ trĂªn, cĂ¡c API
// dĂ nh cho Admin, vĂ  má»i request Ä‘áº¿n tá»« chĂ­nh Admin CHĂNH - ID 6327666718 - Ä‘á»ƒ Admin luĂ´n thao tĂ¡c Ä‘Æ°á»£c
// bĂ¬nh thÆ°á»ng qua Mini App/web /admin trong lĂºc báº£o trĂ¬).
app.use('/api', (req, res, next) => {
    if (BOT_LOCKED && req.path !== '/lock-status' && !req.path.startsWith('/admin')) {
        if (String(extractRequestUserId(req)) === String(ADMIN_ID)) return next();
        return res.status(503).json({ locked: true, error: MAINTENANCE_MESSAGE, message: MAINTENANCE_MESSAGE });
    }
    next();
});

// API kiá»ƒm tra tham gia nhĂ³m tá»« frontend
app.get('/api/verify/:id', async (req, res) => {
    try {
        const isMember = await checkUserMembership(req.params.id);
        // FIX Lá»– Há»”NG: trÆ°á»›c Ä‘Ă¢y route nĂ y chá»‰ tráº£ vá» true/false, khĂ´ng thá»­ chá»‘t lÆ°á»£t má»i báº¡n. Náº¿u user
        // báº¥m "âœ… Kiá»ƒm tra" ngay trong Mini App (thay vĂ¬ qua bot) sau khi Ä‘Ă£ lá»¡ xem Ä‘á»§ 3 QC tá»« trÆ°á»›c, lÆ°á»£t
        // má»i sáº½ khĂ´ng bao giá» Ä‘Æ°á»£c tĂ­nh vĂ¬ onAdWatched() chá»‰ gá»i check-referral khi lifetimeAdsWatched<=3.
        // Gá»i táº¡i Ä‘Ă¢y Ä‘á»ƒ Má»ŒI Ä‘Æ°á»ng xĂ¡c nháº­n thĂ nh viĂªn Ä‘á»u tá»± thá»­ chá»‘t, khĂ´ng phá»¥ thuá»™c thá»© tá»± thao tĂ¡c.
        if (isMember) {
            tryFinalizeReferral(req.params.id, true).catch(() => {});
        }
        res.json({ success: isMember });
    } catch (e) {
        console.error("Lá»—i API verify:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// API lÆ°u IP
app.post('/api/save-ip/:id', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ success: false, error: "IP is required" });

    const { data: userBeforeUpdate, error: fetchError } = await readUserRow(req.params.id);
    if (!userBeforeUpdate) {
        // ChÆ°a cĂ³ báº£n ghi user (vd má»Ÿ Mini App trÆ°á»›c khi /start) - KHĂ”NG pháº£i lá»—i há»‡ thá»‘ng, chá»‰ tráº£ 404
        // vĂ  khĂ´ng ghi log ná»¯a Ä‘á»ƒ log Render khĂ´ng bá»‹ spam nhÆ° trÆ°á»›c.
        if (fetchError) console.error("Lá»—i láº¥y user Ä‘á»ƒ lÆ°u IP:", fetchError.message);
        return res.status(404).json({ success: false, error: "User not found" });
    }

    // Chá»‰ cáº­p nháº­t IP náº¿u nĂ³ thay Ä‘á»•i
    if (userBeforeUpdate.ip !== ip) {
        const { error: updateError } = await saveUserFields(req.params.id, { ip });
        if (updateError) {
            console.error("Lá»—i cáº­p nháº­t IP:", updateError);
            return res.status(500).json({ success: false, error: "Failed to update IP" });
        }
    }
    
    // Check IP trĂ¹ng vĂ  cáº£nh bĂ¡o admin (chá»‰ cáº£nh bĂ¡o náº¿u IP má»›i khĂ¡c IP cÅ© hoáº·c náº¿u chÆ°a tá»«ng cĂ³ IP)
    if (ip && (userBeforeUpdate.ip !== ip || !userBeforeUpdate.ip)) {
        const duplicates = await checkDuplicateIP(req.params.id, ip);
        if (duplicates.length > 0) {
            await safeSendMessage(ADMIN_ID,
                `â ï¸ *Cáº¢NH BĂO IP TRĂ™NG Má»I PHĂT HIá»†N!*\n` +
                `đŸ‘¤ User: ${userBeforeUpdate.name || 'N/A'} (${req.params.id})\n` +
                `đŸŒ IP: ${ip}\n` +
                `â ï¸ TrĂ¹ng vá»›i: ${duplicates.map(d => `${d.name} (${d.id})`).join(', ')}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
    
    res.json({ success: true });
});

// API láº¥y user (kĂ¨m level stats)
app.get('/api/user/:id', async (req, res) => {
    let { data, error } = await readUserRow(req.params.id);
    // Sang ngĂ y má»›i (0h00 giá» VN) thĂ¬ SERVER tá»± reset, nĂªn táº£i láº¡i app hay táº¯t/má»Ÿ bot Ä‘á»u KHĂ”NG
    // táº¡o thĂªm lÆ°á»£t cĂ¢u há»i / SmartLink / nhiá»‡m vá»¥ nhÆ° trÆ°á»›c.
    if (data && !isCurrentVietnamDay(data.lastResetDate)) {
        const { error: resetError } = await saveUserFields(req.params.id, {
            ...dailyResetFields(), walletUpdatedAt: new Date().toISOString()
        });
        if (!resetError) ({ data } = await readUserRow(req.params.id));
    }
    if (!data) {
        if (!error || error.code === 'PGRST116') { // Not Found
            return res.status(404).json({ error: "User not found" });
        }
        console.error("Lá»—i láº¥y user:", error);
        return res.status(500).json({ error: "Failed to fetch user data" });
    }
    // Parse referralMilestones if stored as JSON string
    if (data.referralMilestones && typeof data.referralMilestones === 'string') {
        data.referralMilestones = JSON.parse(data.referralMilestones);
    }
    
    // ThĂªm level stats vĂ o response
    const levelStats = calculateLevelStats(data.truckLevel || 1);
    
    res.json({ ...data, levelStats });
});

// API cáº­p nháº­t user. QUAN TRá»ŒNG: cĂ¡c field "vĂ­" (coins/orders/spins/truckLevel/isBanned) Ä‘Æ°á»£c Ä‘á»‘i chiáº¿u
// qua walletUpdatedAt Ä‘á»ƒ KHĂ”NG cho phĂ©p dá»¯ liá»‡u game trĂªn client (vá»‘n chá»‰ lÆ°u snapshot cá»¥c bá»™) ghi Ä‘Ă¨
// máº¥t cĂ¡c thay Ä‘á»•i mĂ  ADMIN vá»«a thá»±c hiá»‡n trá»±c tiáº¿p trĂªn database (Ä‘Ă¢y lĂ  nguyĂªn nhĂ¢n gĂ¢y lá»—i "lá»‡nh admin
// khĂ´ng Ă¡p dá»¥ng Ä‘Æ°á»£c"). CĂ¡ch hoáº¡t Ä‘á»™ng: client gá»­i kĂ¨m clientWalletSyncedAt = má»‘c walletUpdatedAt mĂ  nĂ³
// biáº¿t gáº§n nháº¥t. Náº¿u má»‘c Ä‘Ă³ CÅ¨ HÆ N má»‘c hiá»‡n táº¡i trong DB (tá»©c admin vá»«a sá»­a vĂ­ sau khi client Ä‘á»“ng bá»™ láº§n
// cuá»‘i) thĂ¬ server sáº½ Bá» QUA pháº§n vĂ­ client gá»­i lĂªn, giá»¯ nguyĂªn giĂ¡ trá»‹ admin Ä‘Ă£ Ä‘áº·t, vĂ  tráº£ láº¡i giĂ¡ trá»‹
// má»›i nháº¥t Ä‘á»ƒ client tá»± cáº­p nháº­t láº¡i local state.
// ToĂ n bá»™ field cĂ³ thá»ƒ bá»‹ ADMIN thay Ä‘á»•i trá»±c tiáº¿p qua lá»‡nh bot (congcoin, trucoin, addspin, adddonhang,
// setlevel, ban/unban, resetdaily, reset, resetall...) Ä‘Æ°á»£c Ä‘á»‘i chiáº¿u qua walletUpdatedAt Ä‘á»ƒ KHĂ”NG cho
// phĂ©p dá»¯ liá»‡u game trĂªn client (vá»‘n chá»‰ lÆ°u snapshot cá»¥c bá»™, cĂ³ thá»ƒ cÅ©) ghi Ä‘Ă¨ máº¥t thay Ä‘á»•i cá»§a admin.
// Láº¥y trá»±c tiáº¿p tá»« fullResetFields() Ä‘á»ƒ danh sĂ¡ch nĂ y LUĂ”N khá»›p vá»›i nhá»¯ng gĂ¬ cĂ¡c lá»‡nh reset thá»±c sá»± Ä‘á»•i,
// trĂ¡nh trÆ°á»ng há»£p thĂªm field má»›i vĂ o fullResetFields() mĂ  quĂªn thĂªm vĂ o Ä‘Ă¢y.
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

        let { data: current, error: currentError } = await readUserRow(userId);
        if (!current) {
            // ChÆ°a cĂ³ báº£n ghi (má»Ÿ Mini App trÆ°á»›c khi /start) -> táº¡o má»›i ngay Ä‘á»ƒ KHĂ”NG máº¥t dá»¯ liá»‡u ngÆ°á»i dĂ¹ng
            const { known: seedRow } = await splitUserFields({
                id: userId,
                name: body.name || 'Shipper',
                walletUpdatedAt: new Date().toISOString()
            });
            const { error: createError } = await supabase.from('users').insert(seedRow);
            if (createError) {
                console.error(`KhĂ´ng táº¡o Ä‘Æ°á»£c user ${userId}:`, createError.message || currentError?.message);
                return res.status(404).json({ success: false, error: "User not found" });
            }
            ({ data: current } = await readUserRow(userId));
            if (!current) return res.status(404).json({ success: false, error: "User not found" });
        }
        if (current.isBanned) {
            return res.status(403).json({ success: false, error: "TĂ i khoáº£n Ä‘Ă£ bá»‹ khĂ³a.", isBanned: true });
        }

        const dbWalletTime = current.walletUpdatedAt ? new Date(current.walletUpdatedAt).getTime() : 0;
        const clientTime = clientWalletSyncedAt ? new Date(clientWalletSyncedAt).getTime() : 0;
        let walletOverridden = false;

        if (dbWalletTime > clientTime) {
            // Admin vá»«a sá»­a vĂ­ sau láº§n client Ä‘á»“ng bá»™ gáº§n nháº¥t -> bá» cĂ¡c field vĂ­ trong request nĂ y
            WALLET_FIELDS.forEach(f => { delete updateData[f]; });
            walletOverridden = true;
        } else {
            // Client Ä‘ang lĂ  báº£n má»›i nháº¥t -> cho phĂ©p lÆ°u, Ä‘á»“ng thá»i cáº­p nháº­t láº¡i má»‘c walletUpdatedAt
            updateData.walletUpdatedAt = new Date().toISOString();
        }

        const { error } = await saveUserFields(userId, updateData);
        if (error) {
            console.error(`Lá»—i cáº­p nháº­t user ${userId}:`, error.message || error);
            return res.status(500).json({ success: false, error: error.message });
        }

        if (walletOverridden) {
            // Tráº£ vá» giĂ¡ trá»‹ má»›i nháº¥t tá»« DB cho TOĂ€N Bá»˜ field Ä‘Æ°á»£c báº£o vá»‡ Ä‘á»ƒ client tá»± Ä‘á»“ng bá»™ láº¡i, trĂ¡nh máº¥t thay Ä‘á»•i cá»§a admin
            const { data: fresh } = await readUserRow(userId);
            if (fresh && fresh.referralMilestones && typeof fresh.referralMilestones === 'string') {
                try { fresh.referralMilestones = JSON.parse(fresh.referralMilestones); } catch (_) { fresh.referralMilestones = []; }
            }
            const levelStats = calculateLevelStats(fresh?.truckLevel || 1);
            return res.json({ success: true, walletOverridden: true, wallet: fresh, levelStats });
        }

        // Láº¥y dá»¯ liá»‡u cáº­p nháº­t má»›i nháº¥t Ä‘á»ƒ tráº£ vá» level stats
        const { data: updated } = await supabase.from('users').select('truckLevel').eq('id', userId).single();
        const levelStats = calculateLevelStats(updated?.truckLevel || 1);
        
        res.json({ success: true, walletOverridden: false, walletUpdatedAt: updateData.walletUpdatedAt, levelStats });
    } catch (e) {
        console.error("Lá»—i API cáº­p nháº­t user:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== SMARTLINK ====================
// Má»—i láº§n báº¥m SmartLink há»£p lá»‡ Ä‘Æ°á»£c +50 Coin vĂ  +50 ÄÆ¡n hĂ ng, do SERVER cá»™ng vĂ  lÆ°u tháº³ng vĂ o
// Supabase (khĂ´ng tĂ­nh á»Ÿ mĂ¡y ngÆ°á»i dĂ¹ng) nĂªn táº£i láº¡i app hay táº¯t/má»Ÿ bot Ä‘á»u khĂ´ng Ä‘á»•i sá»‘ lÆ°á»£t.
const smartlinkProcessing = new Set();
const SMARTLINK_DAILY_LIMIT = 30;
const SMARTLINK_REWARD_COINS = 50;
const SMARTLINK_REWARD_ORDERS = 50;
app.post('/api/smartlink/complete', async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!userId) return res.status(400).json({ success: false, error: 'Thiáº¿u userId.' });
    if (smartlinkProcessing.has(userId)) {
        return res.status(409).json({ success: false, retry: true, error: 'LÆ°á»£t SmartLink Ä‘ang Ä‘Æ°á»£c xá»­ lĂ½.' });
    }
    smartlinkProcessing.add(userId);
    try {
        let { data: user } = await readUserRow(userId);
        if (!user) return res.status(404).json({ success: false, error: 'KhĂ´ng tĂ¬m tháº¥y user.' });
        if (user.isBanned) return res.status(403).json({ success: false, isBanned: true, error: 'TĂ i khoáº£n Ä‘Ă£ bá»‹ khĂ³a.' });

        // Sang ngĂ y má»›i thĂ¬ Ä‘Æ°a bá»™ Ä‘áº¿m vá» 0 trÆ°á»›c khi cá»™ng, Ä‘á»ƒ má»‘c reset luĂ´n lĂ  0h00 giá» VN
        const newDay = !isCurrentVietnamDay(user.lastResetDate);
        if (newDay) {
            await saveUserFields(userId, { ...dailyResetFields(), walletUpdatedAt: new Date().toISOString() });
            ({ data: user } = await readUserRow(userId));
            if (!user) return res.status(404).json({ success: false, error: 'KhĂ´ng tĂ¬m tháº¥y user.' });
        }

        const currentCount = Number(user.smartlinkCount || 0);
        if (currentCount >= SMARTLINK_DAILY_LIMIT) {
            return res.json({
                success: true, alreadyComplete: true, smartlinkCount: SMARTLINK_DAILY_LIMIT,
                smartlinksToday: Number(user.smartlinksToday || 0),
                lifetimeSmartlinks: Number(user.lifetimeSmartlinks || 0),
                coins: Number(user.coins || 0), orders: Number(user.orders || 0),
                walletUpdatedAt: user.walletUpdatedAt
            });
        }

        const walletUpdatedAt = new Date().toISOString();
        const update = {
            coins: Number(user.coins || 0) + SMARTLINK_REWARD_COINS,
            orders: Number(user.orders || 0) + SMARTLINK_REWARD_ORDERS,
            smartlinkCount: currentCount + 1,
            smartlinksToday: Number(user.smartlinksToday || 0) + 1,
            lifetimeSmartlinks: Number(user.lifetimeSmartlinks || 0) + 1,
            lastSmartlinkTime: Date.now(),
            lastResetDate: vietnamDayKey(),
            walletUpdatedAt
        };
        const { error: saveError } = await saveUserFields(userId, update);
        if (saveError) return res.status(500).json({ success: false, error: saveError.message });
        logTransaction(userId, 'coin', SMARTLINK_REWARD_COINS, 'HoĂ n thĂ nh 1 SmartLink');
        logTransaction(userId, 'orders', SMARTLINK_REWARD_ORDERS, 'HoĂ n thĂ nh 1 SmartLink');

        res.json({
            success: true,
            rewardCoins: SMARTLINK_REWARD_COINS, rewardOrders: SMARTLINK_REWARD_ORDERS,
            smartlinkCount: update.smartlinkCount, smartlinksToday: update.smartlinksToday,
            lifetimeSmartlinks: update.lifetimeSmartlinks,
            coins: update.coins, orders: update.orders, walletUpdatedAt
        });
    } catch (e) {
        console.error('Lá»—i hoĂ n táº¥t SmartLink:', e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        smartlinkProcessing.delete(userId);
    }
});

// ==================== QUIZ: SERVER Cáº¤P LÆ¯á»¢T, RELOAD KHĂ”NG THá»‚ NHáº¬N Láº I ====================
const QUIZ_DAILY_LIMIT = 5;
const QUIZ_AD_LIMIT = 4;
const quizProcessing = new Set();
async function loadCurrentDailyUser(userId) {
    let { data: user } = await readUserRow(userId);
    if (!user) return null;
    if (!isCurrentVietnamDay(user.lastResetDate)) {
        // Chá»‰ sang ngĂ y má»›i tháº­t sá»± má»›i reset toĂ n bá»™ nhiá»‡m vá»¥/QC/SmartLink/giao hĂ ng.
        await saveUserFields(userId, { ...dailyResetFields(), walletUpdatedAt:new Date().toISOString() });
        ({ data:user } = await readUserRow(userId));
    } else if (user.quizDate !== vietnamDayKey()) {
        // Náº¿u riĂªng dá»¯ liá»‡u quiz cÅ©/thiáº¿u thĂ¬ chá»‰ reset quiz, tuyá»‡t Ä‘á»‘i khĂ´ng xĂ³a tiáº¿n Ä‘á»™ khĂ¡c trong ngĂ y.
        await saveUserFields(userId, {
            quizDate:vietnamDayKey(), quizFreeUsed:false, quizAdUnlocked:0, quizUsedIds:[]
        });
        ({ data:user } = await readUserRow(userId));
    }
    return user;
}
function quizState(user) {
    const quizFreeUsed = !!user?.quizFreeUsed;
    const quizAdUnlocked = Math.min(QUIZ_AD_LIMIT, Math.max(0, Number(user?.quizAdUnlocked || 0)));
    const slotsUsed = (quizFreeUsed ? 1 : 0) + quizAdUnlocked;
    return {
        quizDate: vietnamDayKey(), quizFreeUsed, quizAdUnlocked,
        quizUsedIds: Array.isArray(user?.quizUsedIds) ? user.quizUsedIds.slice(0, QUIZ_DAILY_LIMIT) : [],
        slotsUsed, remaining: Math.max(0, QUIZ_DAILY_LIMIT - slotsUsed)
    };
}
app.get('/api/quiz/status/:id', async (req, res) => {
    try {
        const user = await loadCurrentDailyUser(String(req.params.id));
        if (!user) return res.status(404).json({ success:false, error:'KhĂ´ng tĂ¬m tháº¥y user.' });
        res.json({ success:true, ...quizState(user) });
    } catch (e) {
        console.error('Lá»—i láº¥y tráº¡ng thĂ¡i cĂ¢u há»i:', e);
        res.status(500).json({ success:false, error:e.message });
    }
});
app.post('/api/quiz/claim-slot', async (req, res) => {
    const userId = String(req.body?.userId || '');
    const kind = req.body?.kind === 'ad' ? 'ad' : 'free';
    if (!userId) return res.status(400).json({ success:false, error:'Thiáº¿u userId.' });
    if (quizProcessing.has(userId)) return res.status(409).json({ success:false, retry:true, error:'Äang xá»­ lĂ½ lÆ°á»£t cĂ¢u há»i.' });
    quizProcessing.add(userId);
    try {
        const user = await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({ success:false, error:'KhĂ´ng tĂ¬m tháº¥y user.' });
        const state = quizState(user);
        if (state.slotsUsed >= QUIZ_DAILY_LIMIT) {
            return res.status(429).json({ success:false, limitReached:true, error:'Báº¡n Ä‘Ă£ dĂ¹ng Ä‘á»§ 5 cĂ¢u há»i hĂ´m nay.', ...state });
        }
        const update = { quizDate:vietnamDayKey(), lastResetDate:vietnamDayKey(), walletUpdatedAt:new Date().toISOString() };
        if (kind === 'free') {
            if (state.quizFreeUsed) return res.status(409).json({ success:false, error:'CĂ¢u miá»…n phĂ­ hĂ´m nay Ä‘Ă£ Ä‘Æ°á»£c dĂ¹ng.', ...state });
            update.quizFreeUsed = true;
        } else {
            if (!state.quizFreeUsed) return res.status(400).json({ success:false, error:'HĂ£y dĂ¹ng cĂ¢u miá»…n phĂ­ trÆ°á»›c.' });
            if (state.quizAdUnlocked >= QUIZ_AD_LIMIT) return res.status(429).json({ success:false, limitReached:true, error:'ÄĂ£ má»Ÿ Ä‘á»§ 4 cĂ¢u báº±ng quáº£ng cĂ¡o.' });
            update.quizAdUnlocked = state.quizAdUnlocked + 1;
        }
        const { error } = await saveUserFields(userId, update);
        if (error) throw error;
        res.json({ success:true, kind, walletUpdatedAt:update.walletUpdatedAt, ...quizState({ ...user, ...update }) });
    } catch (e) {
        console.error('Lá»—i cáº¥p lÆ°á»£t cĂ¢u há»i:', e);
        res.status(500).json({ success:false, error:e.message });
    } finally { quizProcessing.delete(userId); }
});

// ==================== GIAO HĂ€NG: Tá»I ÄA 20 Láº¦N/NGĂ€Y ====================
const DELIVERY_DAILY_LIMIT = 20;
const deliveryProcessing = new Set();
app.post('/api/delivery/claim', async (req, res) => {
    const userId = String(req.body?.userId || '');
    if (!userId) return res.status(400).json({ success:false, error:'Thiáº¿u userId.' });
    if (deliveryProcessing.has(userId)) return res.status(409).json({ success:false, retry:true, error:'Äang xá»­ lĂ½ lÆ°á»£t giao hĂ ng.' });
    deliveryProcessing.add(userId);
    try {
        const user = await loadCurrentDailyUser(userId);
        if (!user) return res.status(404).json({ success:false, error:'KhĂ´ng tĂ¬m tháº¥y user.' });
        const current = Math.max(0, Number(user.deliveryCount || 0));
        if (current >= DELIVERY_DAILY_LIMIT) {
            return res.status(429).json({ success:false, limitReached:true, deliveryCount:current, limit:DELIVERY_DAILY_LIMIT, error:'HĂ´m nay báº¡n Ä‘Ă£ giao Ä‘á»§ 20 láº§n.' });
        }
        const deliveryCount = current + 1;
        const walletUpdatedAt=new Date().toISOString();
        const { error } = await saveUserFields(userId, { deliveryCount, lastResetDate:vietnamDayKey(), walletUpdatedAt });
        if (error) throw error;
        res.json({ success:true, deliveryCount, remaining:DELIVERY_DAILY_LIMIT-deliveryCount, limit:DELIVERY_DAILY_LIMIT, walletUpdatedAt });
    } catch (e) {
        console.error('Lá»—i cáº¥p lÆ°á»£t giao hĂ ng:', e);
        res.status(500).json({ success:false, error:e.message });
    } finally { deliveryProcessing.delete(userId); }
});

// ==================== CAPTCHA & AD TRACKING ENDPOINTS ====================

// API kiá»ƒm tra xem delivery nĂ y cĂ³ cáº§n CAPTCHA khĂ´ng (random 1-3 láº§n Ä‘áº§u tiĂªn)
app.post('/api/delivery/check-captcha', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await loadCurrentDailyUser(String(userId || ''));
        if (!user) return res.status(404).json({ error:'User khĂ´ng tá»“n táº¡i' });
        const current = Math.max(0, Number(user.deliveryCount || 0));
        if (current >= DELIVERY_DAILY_LIMIT) {
            return res.status(429).json({ error:'HĂ´m nay báº¡n Ä‘Ă£ giao Ä‘á»§ 20 láº§n.', deliveryCount:current, limit:DELIVERY_DAILY_LIMIT });
        }
        const nextDelivery = current + 1;
        const requiresCaptcha = nextDelivery <= 3 && Math.random() < 0.4;
        res.json({
            requiresCaptcha, deliveryCount:current, remaining:DELIVERY_DAILY_LIMIT-current,
            captchaCode: requiresCaptcha ? Math.random().toString(36).substring(2,8).toUpperCase() : null
        });
    } catch (e) {
        console.error('Lá»—i check CAPTCHA delivery:', e.message);
        res.status(500).json({ error:e.message });
    }
});

// API xĂ¡c thá»±c CAPTCHA trÆ°á»›c khi cho phĂ©p rĂºt tiá»n
app.post('/api/withdraw/captcha-verify', async (req, res) => {
    try {
        const { userId, captchaInput, captchaCode } = req.body;
        const verified = captchaInput.toUpperCase() === captchaCode;
        
        if (verified) {
            await saveUserFields(userId, { lastCaptchaAt: new Date().toISOString() });
        }
        
        res.json({ verified });
    } catch (e) {
        console.error('Lá»—i xĂ¡c thá»±c CAPTCHA:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// API theo dĂµi xem QC (dĂ¹ng cho in-app ads & banner tracking)
app.post('/api/ad/impression', async (req, res) => {
    try {
        const { userId, adType, zone } = req.body;
        if (!userId || !adType) return res.status(400).json({ error: 'Missing userId or adType' });
        
        // Log ad impression (optional - cĂ³ thá»ƒ store vĂ o table analytics náº¿u cáº§n)
        console.log(`[AD] ${adType} zone ${zone} - user ${userId}`);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const adSessions = new Map();
function makeAdToken() { return `${Date.now()}_${Math.random().toString(36).slice(2,12)}`; }
app.post('/api/ad/session/start', async (req, res) => {
    try {
        const { userId, adType } = req.body || {};
        if (!userId || !['rewarded','inapp'].includes(adType)) return res.status(400).json({success:false,error:'Invalid ad session'});
        const token = makeAdToken();
        adSessions.set(token, { userId:String(userId), adType, startedAt:Date.now() });
        setTimeout(() => adSessions.delete(token), 120000);
        res.json({ success:true, token });
    } catch (e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/api/ad/session/complete', async (req, res) => {
    try {
        const { userId, token, adType } = req.body || {};
        const s = adSessions.get(token);
        if (!s || s.userId !== String(userId) || s.adType !== adType) return res.status(400).json({success:false,error:'PhiĂªn quáº£ng cĂ¡o khĂ´ng há»£p lá»‡.'});
        const elapsed = Date.now() - s.startedAt;
        if (elapsed < 5000) return res.status(400).json({success:false,error:'QC chÆ°a Ä‘á»§ 5 giĂ¢y.'});
        adSessions.delete(token);
        const next = await incrementWeeklyAds(String(userId));
        if (next === null) return res.status(500).json({success:false,error:'KhĂ´ng cáº­p nháº­t Ä‘Æ°á»£c BXH Xem QC.'});
        res.json({success:true, weeklyAdsCount:next, elapsed});
    } catch (e) { res.status(500).json({success:false,error:e.message}); }
});

// API cÅ© giá»¯ tÆ°Æ¡ng thĂ­ch nhÆ°ng KHĂ”NG tá»± cá»™ng BXH ná»¯a.
// BXH Xem QC chá»‰ Ä‘Æ°á»£c cá»™ng táº¡i /api/ad/session/complete sau khi server xĂ¡c nháº­n
// Ä‘Ăºng loáº¡i Rewarded/In-App vĂ  Ä‘á»§ >= 5 giĂ¢y, trĂ¡nh Ä‘áº¿m trĂ¹ng hoáº·c bá»‹ gá»i giáº£.
app.post('/api/ad/watched', async (req, res) => {
    try {
        const { userId, adType } = req.body || {};
        if (!userId || !['rewarded','inapp'].includes(adType)) return res.status(400).json({success:false,error:'Chá»‰ Rewarded/In-App Interstitial Ä‘Æ°á»£c tĂ­nh BXH.'});
        const counts = await getWeeklyAdsCounts();
        res.json({ success:true, weeklyAdsCount:Number(counts[String(userId)]||0), countingEndpoint:'/api/ad/session/complete' });
    } catch (e) { console.error('Lá»—i kiá»ƒm tra BXH Xem QC:',e); res.status(500).json({success:false,error:e.message}); }
});

// ==================== END CAPTCHA & AD TRACKING ====================

// API kiá»ƒm tra vĂ  xĂ¡c nháº­n má»i báº¡n há»£p lá»‡ (gá»i tá»« frontend má»—i khi user xem QC)
app.post('/api/check-referral/:id', async (req, res) => {
    try {
        const userId = req.params.id;

        // FIX Lá»–I "Báº N BĂˆ ÄĂƒ Äá»¦ ÄIá»€U KIá»†N NHÆ¯NG KHĂ”NG ÄÆ¯á»¢C Cá»˜NG THÆ¯á»NG": trÆ°á»›c Ä‘Ă¢y API nĂ y chá»‰ Ä‘á»c
        // lifetimeAdsWatched TRá»°C TIáº¾P Tá»ª DB. NhÆ°ng phĂ­a client, ngay sau khi xem xong 1 QC, gá»i
        // saveState() (lÆ°u lifetimeAdsWatched má»›i lĂªn DB) vĂ  gá»i API nĂ y CĂ™NG LĂC, khĂ´ng chá» cĂ¡i nĂ o lÆ°u
        // xong trÆ°á»›c -> ráº¥t nhiá»u trÆ°á»ng há»£p API check nĂ y cháº¡y/Ä‘á»c DB TRÆ¯á»C KHI saveState() ká»‹p lÆ°u, nĂªn
        // Ä‘á»c pháº£i giĂ¡ trá»‹ lifetimeAdsWatched CÅ¨ (vd 2 thay vĂ¬ 3) -> bá»‹ Ä‘Ă¡nh giĂ¡ sai lĂ  "chÆ°a Ä‘á»§ 3 QC" dĂ¹
        // thá»±c táº¿ ngÆ°á»i Ä‘Æ°á»£c má»i Ä‘Ă£ xem Ä‘á»§ -> ngÆ°á»i má»i khĂ´ng Ä‘Æ°á»£c cá»™ng thÆ°á»Ÿng á»Ÿ Ä‘Ăºng thá»i Ä‘iá»ƒm Ä‘á»§ Ä‘iá»u
        // kiá»‡n. Nay cho phĂ©p client gá»­i kĂ¨m sá»‘ QC hiá»‡n táº¡i nĂ³ Ä‘ang giá»¯, server Ä‘á»“ng bá»™ luĂ´n giĂ¡ trá»‹ nĂ y
        // vĂ o DB (chá»‰ cho phĂ©p TÄ‚NG, khĂ´ng bao giá» giáº£m, vĂ  bá» qua náº¿u admin vá»«a sá»­a vĂ­ sau láº§n client
        // Ä‘á»“ng bá»™ gáº§n nháº¥t - dĂ¹ng chung cÆ¡ cháº¿ walletUpdatedAt/clientWalletSyncedAt nhÆ° API lÆ°u user)
        // TRÆ¯á»C khi cháº¡y kiá»ƒm tra, Ä‘áº£m báº£o Ä‘iá»u kiá»‡n luĂ´n Ä‘Æ°á»£c xĂ©t trĂªn dá»¯ liá»‡u má»›i nháº¥t.
        const clientAdsWatched = parseInt(req.body?.lifetimeAdsWatched);
        const clientSmartlinks = parseInt(req.body?.lifetimeSmartlinks);
        const clientWalletSyncedAt = req.body?.clientWalletSyncedAt;
        if ((!isNaN(clientAdsWatched) && clientAdsWatched > 0) || (!isNaN(clientSmartlinks) && clientSmartlinks > 0)) {
            const { data: cur } = await readUserRow(userId);
            if (cur) {
                const dbWalletTime = cur.walletUpdatedAt ? new Date(cur.walletUpdatedAt).getTime() : 0;
                const clientTime = clientWalletSyncedAt ? new Date(clientWalletSyncedAt).getTime() : 0;
                if (dbWalletTime <= clientTime) {
                    const syncUpdate = {};
                    if (!isNaN(clientAdsWatched) && clientAdsWatched > (cur.lifetimeAdsWatched || 0)) syncUpdate.lifetimeAdsWatched = clientAdsWatched;
                    if (!isNaN(clientSmartlinks) && clientSmartlinks > (cur.lifetimeSmartlinks || 0)) syncUpdate.lifetimeSmartlinks = clientSmartlinks;
                    if (Object.keys(syncUpdate).length > 0) {
                        await saveUserFields(userId, syncUpdate);
                    }
                }
            }
        }

        const result = await tryFinalizeReferral(userId);
        res.json(result);
    } catch (e) {
        console.error("Lá»—i check-referral:", e);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// API rĂºt tiá»n - Há»— trá»£ NgĂ¢n hĂ ng / Momo / ZaloPay vá»›i cĂ¡c trÆ°á»ng tĂ¡ch riĂªng
// (bankName, accountName, accountNumber cho ngĂ¢n hĂ ng; accountNumber = SÄT cho Momo/ZaloPay)
// LÆ¯U Ă SCHEMA: báº£ng "withdrawals" trĂªn Supabase cáº§n cĂ³ thĂªm cĂ¡c cá»™t:
// ordersAmount (int8), bankName (text), accountName (text), accountNumber (text), txCode (int8)
const WITHDRAW_MIN_ORDERS = 50000;      // Tá»‘i thiá»ƒu 50.000 ÄÆ¡n HĂ ng
const WITHDRAW_MIN_ADS = 5;             // Xem tá»‘i thiá»ƒu 5 QC trong ngĂ y
const WITHDRAW_MIN_SMARTLINKS = 15;     // Báº¥m tá»‘i thiá»ƒu 15 SmartLink trong ngĂ y
const WITHDRAW_PER_USER_PER_DAY = 1;    // Má»—i ngÆ°á»i 1 Ä‘Æ¡n rĂºt/ngĂ y
const WITHDRAW_DAILY_QUOTA = 20;        // ToĂ n Mini App nháº­n tá»‘i Ä‘a 20 Ä‘Æ¡n rĂºt/ngĂ y
// NhĂ³m nháº­n thĂ´ng bĂ¡o rĂºt tiá»n: https://t.me/khohangchatkiemtien
const WITHDRAW_NOTIFY_CHAT = process.env.WITHDRAW_NOTIFY_CHAT || '@khohangchatkiemtien';
app.post('/api/withdraw', async (req, res) => {
    const { userId, method, bankName, accountName, accountNumber, ordersAmount } = req.body;

    if (!userId || !method || !accountNumber || !ordersAmount) {
        return res.status(400).json({ error: "Vui lĂ²ng nháº­p Ä‘áº§y Ä‘á»§ thĂ´ng tin rĂºt tiá»n." });
    }
    if (ordersAmount < WITHDRAW_MIN_ORDERS) { // Má»©c rĂºt tá»‘i thiá»ƒu: 50.000 ÄÆ¡n HĂ ng (5.000 VNÄ)
        return res.status(400).json({ error: "Sá»‘ Ä‘Æ¡n hĂ ng rĂºt tá»‘i thiá»ƒu lĂ  50.000 ÄÆ¡n HĂ ng (5.000 VNÄ)." });
    }
    if (method === 'bank' && (!bankName || !accountName)) {
        return res.status(400).json({ error: "Vui lĂ²ng nháº­p Ä‘áº§y Ä‘á»§ tĂªn ngĂ¢n hĂ ng vĂ  tĂªn chá»§ tĂ i khoáº£n." });
    }

    const { data: userData } = await readUserRow(userId);
    if (!userData) {
        return res.status(404).json({ error: "User not found or database error." });
    }
    if (userData.isBanned) {
        return res.status(403).json({ error: "TĂ i khoáº£n Ä‘Ă£ bá»‹ khĂ³a." });
    }
    // Äiá»u kiá»‡n rĂºt tiá»n: Ä‘á»c TRá»°C TIáº¾P tá»« DB (khĂ´ng tin dá»¯ liá»‡u client gá»­i lĂªn) Ä‘á»ƒ chá»‘ng gian láº­n.
    // YĂªu cáº§u: â‰¥50.000 ÄÆ¡n HĂ ng, xem â‰¥5 QC hĂ´m nay, báº¥m â‰¥15 SmartLink hĂ´m nay.
    const adsTodayCount = Number(userData.adsToday || 0);
    const smartlinksTodayCount = Number(userData.smartlinksToday || 0);
    if (adsTodayCount < WITHDRAW_MIN_ADS || smartlinksTodayCount < WITHDRAW_MIN_SMARTLINKS) {
        return res.status(400).json({ error: `ChÆ°a Ä‘á»§ Ä‘iá»u kiá»‡n: cáº§n xem â‰¥${WITHDRAW_MIN_ADS} QC hĂ´m nay (hiá»‡n ${adsTodayCount}/${WITHDRAW_MIN_ADS}) vĂ  báº¥m â‰¥${WITHDRAW_MIN_SMARTLINKS} SmartLink hĂ´m nay (hiá»‡n ${smartlinksTodayCount}/${WITHDRAW_MIN_SMARTLINKS}).` });
    }
    // Má»—i ngÆ°á»i chá»‰ rĂºt 1 láº§n/ngĂ y vĂ  toĂ n Mini App chá»‰ nháº­n tá»‘i Ä‘a 20 Ä‘Æ¡n rĂºt má»—i ngĂ y (0h00 giá» VN)
    const dayStart = vietnamDayStartIso();
    const { count: myTodayCount, error: myCountError } = await supabase.from('withdrawals')
        .select('*', { count: 'exact', head: true }).eq('userId', userId).gte('createdAt', dayStart);
    if (myCountError) console.error('Lá»—i Ä‘áº¿m Ä‘Æ¡n rĂºt cá»§a user:', myCountError.message);
    if ((myTodayCount || 0) >= WITHDRAW_PER_USER_PER_DAY) {
        return res.status(429).json({ error: `Má»—i ngĂ y chá»‰ Ä‘Æ°á»£c rĂºt ${WITHDRAW_PER_USER_PER_DAY} láº§n. Vui lĂ²ng quay láº¡i sau 0h00.` });
    }
    const { count: allTodayCount, error: allCountError } = await supabase.from('withdrawals')
        .select('*', { count: 'exact', head: true }).gte('createdAt', dayStart);
    if (allCountError) console.error('Lá»—i Ä‘áº¿m Ä‘Æ¡n rĂºt trong ngĂ y:', allCountError.message);
    if ((allTodayCount || 0) >= WITHDRAW_DAILY_QUOTA) {
        return res.status(429).json({ error: `HĂ´m nay Ä‘Ă£ Ä‘á»§ ${WITHDRAW_DAILY_QUOTA} Ä‘Æ¡n rĂºt cá»§a há»‡ thá»‘ng. Vui lĂ²ng quay láº¡i sau 0h00.` });
    }
    if (userData.orders < ordersAmount) {
        return res.status(400).json({ error: "KhĂ´ng Ä‘á»§ Ä‘Æ¡n hĂ ng Ä‘á»ƒ rĂºt sá»‘ lÆ°á»£ng nĂ y." });
    }

    // Tá»‰ lá»‡ quy Ä‘á»•i: 1 ÄÆ¡n HĂ ng = 0,1 VNÄ (má»©c rĂºt tá»‘i thiá»ƒu: 50.000 ÄÆ¡n HĂ ng = 5.000 VNÄ)
    const amountVnd = Math.floor(ordersAmount * 0.1);
    const newOrders = userData.orders - ordersAmount;
    const methodLabel = method === 'bank' ? (bankName || 'NgĂ¢n hĂ ng') : (method === 'momo' ? 'Momo' : 'ZaloPay');
    const accountInfoText = method === 'bank' ? `${bankName} - ${accountName} - ${accountNumber}` : accountNumber;

    try {
        // MĂ£ giao dá»‹ch tuáº§n tá»± cho TOĂ€N Bá»˜ bot (Ä‘Æ¡n rĂºt thá»© 1, 2, 3...)
        const { count } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true });
        const txCode = (count || 0) + 1;

        // Trá»« Ä‘Æ¡n hĂ ng báº±ng UPDATE cĂ³ Ä‘iá»u kiá»‡n (WHERE orders = giĂ¡_trá»‹_vá»«a_Ä‘á»c): náº¿u cĂ³ 1 yĂªu cáº§u rĂºt khĂ¡c
        // vá»«a ká»‹p trá»« trÆ°á»›c trong lĂºc request nĂ y Ä‘ang xá»­ lĂ½, orders thá»±c táº¿ trĂªn DB sáº½ khĂ¡c giĂ¡ trá»‹ Ä‘Ă£ Ä‘á»c
        // -> 0 dĂ²ng bá»‹ áº£nh hÆ°á»Ÿng -> tá»« chá»‘i ngay, KHĂ”NG táº¡o Ä‘Æ¡n rĂºt, trĂ¡nh trá»« vÆ°á»£t quĂ¡ sá»‘ dÆ° thá»±c cĂ³.
        const newOrdersWalletUpdatedAt = new Date().toISOString();
        const { data: updatedRows, error: updErr } = await supabase.from('users')
            .update({ orders: newOrders, walletUpdatedAt: newOrdersWalletUpdatedAt })
            .eq('id', userId)
            .eq('orders', userData.orders)
            .select('orders, walletUpdatedAt');
        if (updErr) throw updErr;
        if (!updatedRows || updatedRows.length === 0) {
            return res.status(409).json({ error: "Sá»‘ dÆ° cá»§a báº¡n vá»«a thay Ä‘á»•i, vui lĂ²ng thá»­ láº¡i." });
        }

        const { error: withdrawInsertError } = await insertRowSafe('withdrawals', {
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
        if (withdrawInsertError) {
            // CHá»NG Máº¤T ÄÆ N HĂ€NG: Ä‘Æ¡n hĂ ng Ä‘Ă£ bá»‹ trá»« trÆ°á»›c khi táº¡o Ä‘Æ¡n rĂºt. Náº¿u táº¡o Ä‘Æ¡n rĂºt tháº¥t báº¡i
            // thĂ¬ hoĂ n láº¡i Ä‘Ăºng sá»‘ Ä‘Ă£ trá»«, thay vĂ¬ Ä‘á»ƒ ngÆ°á»i dĂ¹ng máº¥t tráº¯ng sá»‘ dÆ° nhÆ° trÆ°á»›c.
            const { data: afterFail } = await readUserRow(userId);
            await saveUserFields(userId, {
                orders: Number(afterFail?.orders || 0) + ordersAmount,
                walletUpdatedAt: new Date().toISOString()
            });
            throw withdrawInsertError;
        }
        logTransaction(userId, 'orders', -ordersAmount, `RĂºt tiá»n #${txCode} (${amountVnd.toLocaleString()} VNÄ)`);

        // ThĂ´ng bĂ¡o rĂºt tiá»n lĂªn nhĂ³m https://t.me/khohangchatkiemtien
        // ID chá»‰ hiá»‡n 3 sá»‘ Ä‘áº§u, pháº§n cĂ²n láº¡i che báº±ng dáº¥u sao Ä‘á»ƒ khĂ´ng lá»™ danh tĂ­nh ngÆ°á»i dĂ¹ng.
        const idText = String(userId);
        const maskedId = idText.length > 3 ? idText.slice(0, 3) + '*'.repeat(idText.length - 3) : idText;
        await safeSendMessage(WITHDRAW_NOTIFY_CHAT,
            `ID: ${maskedId}\nSá»‘ Tiá»n RĂºt: ${amountVnd.toLocaleString('vi-VN')} VNÄ\nThá»i Gian RĂºt: ${vietnamTimeText()}`
        );

        // Tráº£ vá» ÄĂNG giĂ¡ trá»‹ orders + walletUpdatedAt vá»«a lÆ°u Ä‘á»ƒ client SET trá»±c tiáº¿p (khĂ´ng tá»± trá»« cá»¥c bá»™ ná»¯a)
        res.json({ success: true, txCode, orders: updatedRows[0].orders, walletUpdatedAt: updatedRows[0].walletUpdatedAt });
    } catch (error) {
        console.error("Lá»—i trong quĂ¡ trĂ¬nh rĂºt tiá»n:", error);
        res.status(500).json({ error: "Lá»—i táº¡o yĂªu cáº§u rĂºt tiá»n hoáº·c cáº­p nháº­t Ä‘Æ¡n hĂ ng." });
    }
});

// API láº¥y lá»‹ch sá»­ rĂºt tiá»n cá»§a 1 user (Ä‘á»c trá»±c tiáº¿p tá»« báº£ng withdrawals Ä‘á»ƒ luĂ´n khá»›p tráº¡ng thĂ¡i admin duyá»‡t)
app.get('/api/withdrawals/:userId', async (req, res) => {
    const { data, error } = await supabase.from('withdrawals').select('*').eq('userId', req.params.userId).order('createdAt', { ascending: false }).limit(50);
    if (error) {
        console.error("Lá»—i láº¥y lá»‹ch sá»­ rĂºt tiá»n:", error);
        return res.status(500).json({ error: "Lá»—i láº¥y lá»‹ch sá»­ rĂºt tiá»n." });
    }
    res.json({ withdrawals: data || [] });
});

// API báº£ng xáº¿p háº¡ng má»i báº¡n - dá»¯ liá»‡u THáº¬T tá»« DB (khĂ´ng random)
app.get('/api/leaderboard-ads', async (req, res) => {
    try {
        const counts = await getWeeklyAdsCounts();
        const ids = Object.entries(counts).filter(([,count])=>Number(count)>0)
            .sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,10).map(([id])=>id);
        if (!ids.length) return res.json({ leaderboard:[] });
        const { data, error } = await supabase.from('users').select('id,name').in('id',ids);
        if (error) throw error;
        const names = Object.fromEntries((data||[]).map(u=>[String(u.id),u.name]));
        res.json({ leaderboard:ids.map(id=>({id,name:names[id]||('User '+id),adsCount:Number(counts[id]||0)})) });
    } catch (error) {
        console.error('Lá»—i láº¥y BXH QC:',error);
        res.status(500).json({leaderboard:[]});
    }
});

app.get('/api/leaderboard', async (req, res) => {
    // FIX Lá»–I "BXH Máº¤T Háº¾T Dá»® LIá»†U/Máº¤T TOP": trÆ°á»›c Ä‘Ă¢y Ä‘á»•i sang xáº¿p háº¡ng theo weeklyValidInvites (cá»™t Má»I,
    // ai cÅ©ng báº¯t Ä‘áº§u tá»« 0), khiáº¿n BXH nhĂ¬n nhÆ° bá»‹ xĂ³a sáº¡ch dĂ¹ validInvites trá»n Ä‘á»i cá»§a má»i ngÆ°á»i váº«n cĂ²n
    // nguyĂªn trong DB. Quay láº¡i xáº¿p háº¡ng + hiá»ƒn thá»‹ theo validInvites (tá»•ng sá»‘ má»i há»£p lá»‡ trá»n Ä‘á»i, khĂ´ng
    // bao giá» máº¥t). weeklyValidInvites váº«n Ä‘Æ°á»£c tĂ­nh riĂªng á»Ÿ ngáº§m (xem tryFinalizeReferral) chá»‰ Ä‘á»ƒ phá»¥c vá»¥
    // viá»‡c xĂ©t thÆ°á»Ÿng Top 1-3 hĂ ng tuáº§n (weeklyLeaderboardReset), KHĂ”NG dĂ¹ng Ä‘á»ƒ hiá»ƒn thá»‹ BXH cho ngÆ°á»i dĂ¹ng.
    const { data, error } = await supabase.from('users').select('id, name, validInvites').order('validInvites', { ascending: false }).limit(10);
    if (error) {
        console.error("Lá»—i láº¥y báº£ng xáº¿p háº¡ng:", error);
        return res.status(500).json({ error: "Lá»—i láº¥y báº£ng xáº¿p háº¡ng." });
    }
    res.json({ leaderboard: (data || []).map(u => ({ id: u.id, name: u.name, validInvites: u.validInvites || 0 })) });
});


// API redeem code
app.post('/api/redeem-code', async (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) return res.status(400).json({ error: "Missing userId or code." });

    const { data: gc, error: gcError } = await supabase.from('giftcodes').select('*').eq('code', code).single();
    if (gcError || !gc) return res.status(404).json({ error: "MĂ£ code khĂ´ng há»£p lá»‡ hoáº·c khĂ´ng tá»“n táº¡i." });
    if (gc.usedCount >= gc.limitUses) return res.status(400).json({ error: "MĂ£ code Ä‘Ă£ háº¿t lÆ°á»£t sá»­ dá»¥ng." });

    // Kiá»ƒm tra PHáº M VI cá»§a code: náº¿u scope = "admin" thĂ¬ chá»‰ Admin chĂ­nh/phá»¥ má»›i nháº­p Ä‘Æ°á»£c (code ná»™i bá»™).
    const uid = String(userId);
    const isRequesterAdmin = uid === String(ADMIN_ID) || subAdminIds.has(uid);
    if (gc.scope === 'admin' && !isRequesterAdmin) {
        return res.status(403).json({ error: "MĂ£ code nĂ y chá»‰ dĂ nh riĂªng cho Admin." });
    }

    const { data: userCheck } = await supabase.from('users').select('isBanned, name').eq('id', userId).single();
    if (userCheck?.isBanned) return res.status(403).json({ error: "TĂ i khoáº£n Ä‘Ă£ bá»‹ khĂ³a." });

    // TĂ­nh sáºµn pháº§n thÆ°á»Ÿng thá»±c táº¿ cá»§a code (Ä‘á»ƒ lÆ°u snapshot vĂ o lá»‹ch sá»­ + cĂ³ thá»ƒ thu há»“i chĂ­nh xĂ¡c sau nĂ y)
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

    // FIX Lá»–I: má»—i user chá»‰ Ä‘Æ°á»£c nháº­p 1 code Má»˜T Láº¦N DUY NHáº¤T (trÆ°á»›c Ä‘Ă¢y chá»‰ kiá»ƒm tra usedCount chung cá»§a
    // code, khĂ´ng phĂ¢n biá»‡t user nĂªn 1 ngÆ°á»i cĂ³ thá»ƒ spam nháº­p láº¡i nhiá»u láº§n). Ghi nháº­n vĂ o báº£ng
    // giftcode_redemptions (code, userId) vá»›i khĂ³a chĂ­nh kĂ©p -> insert láº§n 2 cá»§a cĂ¹ng 1 user sáº½ bĂ¡o lá»—i.
    // Äá»“ng thá»i lÆ°u luĂ´n "snapshot" pháº§n thÆ°á»Ÿng + thá»i gian nháº­p Ä‘á»ƒ: (1) hiá»ƒn thá»‹ lá»‹ch sá»­ nháº­p code CHá»ˆ
    // RIĂNG user Ä‘Ă³ tháº¥y Ä‘Æ°á»£c (khĂ´ng thĂ´ng bĂ¡o lĂªn banner toĂ n server ná»¯a), vĂ  (2) cho phĂ©p admin /thuhoi
    // thu há»“i chĂ­nh xĂ¡c Ä‘Ăºng sá»‘ Ä‘Ă£ phĂ¡t ra dĂ¹ sau nĂ y admin cĂ³ Ä‘á»•i pháº§n thÆ°á»Ÿng cá»§a code.
    // Náº¿u báº£ng giftcode_redemptions trĂªn Supabase CHÆ¯A Ä‘Æ°á»£c thĂªm cĂ¡c cá»™t snapshot (chÆ°a cháº¡y SQL migration)
    // -> tá»± Ä‘á»™ng fallback insert chá»‰ vá»›i (code, userId) Ä‘á»ƒ viá»‡c nháº­p code KHĂ”NG Bá» Lá»–I/cháº·n Ä‘á»©ng; khi Ä‘Ă³
    // lá»‹ch sá»­ nháº­p code cá»§a user sáº½ hiá»ƒn thá»‹ thiáº¿u sá»‘ pháº§n thÆ°á»Ÿng cho tá»›i khi admin cháº¡y migration.
    let redemptionError;
    {
        const full = await supabase.from('giftcode_redemptions').insert({
            code, userId,
            userName: userCheck?.name || null,
            rewardCoin, rewardOrders, rewardSpins,
            createdAt: new Date().toISOString()
        });
        redemptionError = full.error;
        if (redemptionError && redemptionError.code !== '23505' &&
            (redemptionError.code === '42703' || redemptionError.code === 'PGRST204' || /column/i.test(redemptionError.message || ''))) {
            const fallback = await supabase.from('giftcode_redemptions').insert({ code, userId });
            redemptionError = fallback.error;
        }
    }
    if (redemptionError) {
        // MĂ£ lá»—i 23505 = vi pháº¡m unique/primary key -> nghÄ©a lĂ  user Ä‘Ă£ nháº­p code nĂ y rá»“i
        if (redemptionError.code === '23505') {
            return res.status(400).json({ error: "Báº¡n Ä‘Ă£ sá»­ dá»¥ng mĂ£ code nĂ y rá»“i." });
        }
        console.error("Lá»—i ghi nháº­n redemption:", redemptionError);
        return res.status(500).json({ error: "Lá»—i khi xá»­ lĂ½ code." });
    }
    
    // TÄƒng sá»‘ lÆ°á»£t Ä‘Ă£ dĂ¹ng Cá»¦A CODE
    const { error: updateGcError } = await supabase.from('giftcodes').update({ usedCount: gc.usedCount + 1 }).eq('code', code);
    if (updateGcError) {
        console.error("Lá»—i cáº­p nháº­t giftcode usedCount:", updateGcError);
        return res.status(500).json({ error: "Lá»—i khi xá»­ lĂ½ code." });
    }

    // Cá»™ng thÆ°á»Ÿng cho user
    const { data: u, error: userFetchError } = await supabase.from('users').select('coins, orders, spins').eq('id', userId).single();
    if (userFetchError || !u) {
        console.error("Lá»—i láº¥y user khi redeem code:", userFetchError);
        return res.status(404).json({ error: "KhĂ´ng tĂ¬m tháº¥y ngÆ°á»i dĂ¹ng." });
    }

    const updateData = {
        coins: (u.coins || 0) + rewardCoin,
        orders: (u.orders || 0) + rewardOrders,
        spins: (u.spins || 0) + rewardSpins
    };

    const walletOk = await touchWallet(userId, updateData);
    if (!walletOk) {
        return res.status(500).json({ error: "Lá»—i khi cá»™ng thÆ°á»Ÿng cho ngÆ°á»i dĂ¹ng." });
    }
    if (rewardCoin) logTransaction(userId, 'coin', rewardCoin, `Nháº­p code "${code}"`);
    if (rewardOrders) logTransaction(userId, 'orders', rewardOrders, `Nháº­p code "${code}"`);

    // KHĂ”NG cĂ²n ghi vĂ o activity_log / banner toĂ n server ná»¯a: viá»‡c nháº­p code + pháº§n thÆ°á»Ÿng nháº­n Ä‘Æ°á»£c giá»
    // lĂ  RIĂNG TÆ¯, chá»‰ chĂ­nh user Ä‘Ă³ tháº¥y Ä‘Æ°á»£c qua "Lá»‹ch sá»­ nháº­p code" (GET /api/redeem-history/:userId).
    // (logTransaction á»Ÿ trĂªn lĂ  Ä‘á»ƒ admin xem qua /saoke, khĂ¡c vá»›i banner cĂ´ng khai)

    res.json({ 
        success: true, 
        rewardType: gc.rewardType, 
        rewardAmount: rewardCoin,
        orders: rewardOrders,
        spins: rewardSpins
    });
});

// Láº¥y lá»‹ch sá»­ nháº­p code Cá»¦A RIĂNG 1 user (mĂ£ code, pháº§n thÆ°á»Ÿng, thá»i gian) - chá»‰ user Ä‘Ă³ xem Ä‘Æ°á»£c vĂ¬ pháº£i
// biáº¿t Ä‘Ăºng userId cá»§a mĂ¬nh (Mini App tá»± truyá»n userId cá»§a Telegram Ä‘ang Ä‘Äƒng nháº­p).
app.get('/api/redeem-history/:userId', async (req, res) => {
    try {
        // FIX Lá»–I "NHáº¬P CODE XONG Lá»CH Sá»¬ Láº I KHĂ”NG CĂ“": trÆ°á»›c Ä‘Ă¢y SELECT Ä‘Ă­ch danh cĂ¡c cá»™t
        // rewardCoin/rewardOrders/rewardSpins/createdAt - náº¿u DB tháº­t CHÆ¯A cháº¡y SQL migration thĂªm cĂ¡c cá»™t
        // nĂ y, cĂ¢u SELECT bĂ¡o lá»—i "column does not exist" ngay láº­p tá»©c -> luĂ´n tráº£ vá» máº£ng Rá»–NG dĂ¹ báº£n ghi
        // nháº­p code váº«n tá»“n táº¡i trong báº£ng. Äá»•i sang select('*') (khĂ´ng bao giá» lá»—i do thiáº¿u cá»™t) rá»“i tá»±
        // Ä‘iá»n giĂ¡ trá»‹ máº·c Ä‘á»‹nh cho cĂ¡c cá»™t cĂ³ thá»ƒ chÆ°a tá»“n táº¡i.
        const { data, error } = await supabase.from('giftcode_redemptions')
            .select('*')
            .eq('userId', req.params.userId)
            .limit(50);
        if (error) throw error;
        const history = (data || [])
            .map(r => ({
                code: r.code,
                rewardCoin: r.rewardCoin || 0,
                rewardOrders: r.rewardOrders || 0,
                rewardSpins: r.rewardSpins || 0,
                createdAt: r.createdAt || r.redeemedAt || null
            }))
            .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.json({ history });
    } catch (e) {
        console.error('Lá»—i láº¥y redeem-history:', e.message);
        res.json({ history: [] });
    }
});


// Admin: cáº­p nháº­t tráº¡ng thĂ¡i rĂºt tiá»n (miniapp sáº½ tá»± Ä‘á»“ng bá»™ tráº¡ng thĂ¡i má»›i qua polling /api/withdrawals/:userId)
app.post('/api/admin/update-withdrawal', async (req, res) => {
    if (req.query.pass !== ADMIN_PASS) return res.status(403).json({ error: "Access Denied" });
    const { id, status, reason } = req.body;

    const { data: current, error: fetchErr } = await supabase.from('withdrawals').select('*').eq('id', id).single();
    if (fetchErr || !current) return res.status(404).json({ success: false, error: "KhĂ´ng tĂ¬m tháº¥y Ä‘Æ¡n rĂºt." });

    const { error } = await supabase.from('withdrawals').update({ status, reason }).eq('id', id);
    if (error) {
        console.error("Lá»—i cáº­p nháº­t tráº¡ng thĂ¡i rĂºt tiá»n:", error);
        return res.status(500).json({ success: false, error: error.message });
    }

    // HoĂ n tráº£ Ä‘Æ¡n hĂ ng náº¿u Ä‘Æ¡n Ä‘ang Chá» duyá»‡t bá»‹ chuyá»ƒn sang Tá»« chá»‘i/HoĂ n tráº£
    if (current.status === 'pending' && (status === 'rejected' || status === 'refunded')) {
        const refundOrders = current.ordersAmount || (Math.floor((current.amount || 0) / 1000) * 10000);
        const { data: u } = await supabase.from('users').select('orders').eq('id', current.userId).single();
        if (u) await touchWallet(current.userId, { orders: (u.orders || 0) + refundOrders });
        await safeSendMessage(current.userId,
            `âŒ YĂªu cáº§u rĂºt tiá»n #${current.txCode || current.id} Ä‘Ă£ bá»‹ *Há»¦Y*.\nđŸ“ LĂ½ do: ${reason || 'KhĂ´ng cĂ³'}\nđŸ“¦ ÄĂ£ hoĂ n tráº£: ${refundOrders.toLocaleString()} ÄÆ¡n HĂ ng`,
            { parse_mode: 'Markdown' }
        );
    } else if (status === 'success') {
        await safeSendMessage(current.userId,
            `âœ… YĂªu cáº§u rĂºt tiá»n #${current.txCode || current.id} Ä‘Ă£ Ä‘Æ°á»£c *DUYá»†T*!\nđŸ’° Sá»‘ tiá»n: ${(current.amount || 0).toLocaleString()} VNÄ`,
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

    if (usersError) console.error("Lá»—i láº¥y users cho admin panel:", usersError);
    if (withdrawError) console.error("Lá»—i láº¥y withdrawals cho admin panel:", withdrawError);
    
    const ipCounts = {};
    if (users) {
        users.forEach(u => { if (u.ip) ipCounts[u.ip] = (ipCounts[u.ip] || 0) + 1; });
    }
    
    let usersHtml = users ? users.map(u => {
        const isDup = u.ip && ipCounts[u.ip] > 1;
        return `<tr class="${isDup ? 'red-flag' : ''}">
            <td>${u.id}</td><td>${u.name}</td><td>${u.ip || 'N/A'} ${isDup ? '(TRĂ™NG IP!)' : ''}</td>
            <td>${u.coins}</td><td>${u.orders}</td><td>${u.truckLevel}</td><td>${u.validInvites}</td>
            <td>${u.isBanned ? 'CĂ³' : 'KhĂ´ng'}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="8">KhĂ´ng cĂ³ dá»¯ liá»‡u user.</td></tr>';
    
    let withdrawsHtml = withdrawals ? withdrawals.map(w => {
        let statusClass = w.status === 'success' ? 'status-success' : (w.status === 'pending' ? 'status-pending' : (w.status === 'rejected' ? 'status-rejected' : 'status-refunded'));
        return `<tr>
            <td>#${w.txCode || w.id}</td><td>${w.userId}</td><td>${w.amount}</td><td>${w.method}</td>
            <td>${w.accountInfo || 'N/A'}</td>
            <td class="${statusClass}">${w.status}</td><td>${w.reason || '-'}</td>
            <td>
                <form onsubmit="updateWithdraw(event, '${w.id}')">
                    <select name="status" style="padding:2px;">
                        <option value="pending" ${w.status==='pending'?'selected':''}>Chá» duyá»‡t</option>
                        <option value="success" ${w.status==='success'?'selected':''}>ÄĂ£ duyá»‡t</option>
                        <option value="rejected" ${w.status==='rejected'?'selected':''}>Tá»« chá»‘i</option>
                        <option value="refunded" ${w.status==='refunded'?'selected':''}>HoĂ n tráº£</option>
                    </select>
                    <input type="text" name="reason" placeholder="LĂ½ do..." value="${w.reason || ''}" style="width:80px; padding:2px;">
                    <button type="submit" style="padding:2px 5px; cursor:pointer;">LÆ°u</button>
                </form>
            </td>
        </tr>`;
    }).join('') : '<tr><td colspan="8">KhĂ´ng cĂ³ dá»¯ liá»‡u rĂºt tiá»n.</td></tr>';
    
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
    <h1>đŸ› ï¸ Admin Panel - Logistics App</h1>
    <h2>đŸ“¥ Quáº£n lĂ½ yĂªu cáº§u rĂºt tiá»n</h2>
    <table>
        <thead>
            <tr><th>ID</th><th>User ID</th><th>Sá»‘ tiá»n</th><th>PhÆ°Æ¡ng thá»©c</th><th>ThĂ´ng tin KH</th><th>Tráº¡ng thĂ¡i</th><th>LĂ½ do</th><th>HĂ nh Ä‘á»™ng</th></tr>
        </thead>
        <tbody>${withdrawsHtml}</tbody>
    </table>
    <h2>đŸ‘¥ Danh sĂ¡ch User (Ná»n Ä‘á» = TrĂ¹ng IP)</h2>
    <table>
        <thead>
            <tr><th>ID</th><th>TĂªn</th><th>IP</th><th>Coin</th><th>ÄÆ¡n hĂ ng</th><th>Level</th><th>Má»i há»£p lá»‡</th><th>Banned</th></tr>
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
                alert('Cáº­p nháº­t thĂ nh cĂ´ng!');
                location.reload();
            } else {
                alert('Cáº­p nháº­t tháº¥t báº¡i: ' + (await res.json()).error);
            }
        }
    </script>
    </body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`âœ… Server running on port ${PORT}`));
