// server.js — Moneyium (hardened)
'use strict';

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

// ─── ENV + STARTUP GUARD ───────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

function requireEnv(name, devFallback) {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (IS_PROD) {
    console.error(`[FATAL] Missing or too-short env var: ${name}. Refusing to start in production.`);
    process.exit(1);
  }
  console.warn(`[WARN] ${name} unset/short — using a dev fallback. Set it in .env before deploying.`);
  return devFallback;
}

const SESSION_SECRET = requireEnv('SESSION_SECRET', crypto.randomBytes(32).toString('hex'));
const ROBLOX_SYSTEM_PASSWORD = requireEnv('ROBLOX_SYSTEM_PASSWORD', 'dev_only_' + crypto.randomBytes(8).toString('hex'));
const BCRYPT_ROUNDS = Math.max(10, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS, 10) || 168;

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

// ─── SECURITY MIDDLEWARE ───────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,      // frontend uses inline styles/scripts
  crossOriginEmbedderPolicy: false,  // rbxcdn thumbnails
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Reject state-changing requests without JSON content-type.
// Cross-origin HTML forms can't set application/json — kills the classic CSRF vector.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});

// Rate limiters
const authLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 20,  standardHeaders: true, legacyHeaders: false,
                                   message: { error: 'Too many attempts. Try again later.' } });
const tradeLimiter   = rateLimit({ windowMs: 60 * 1000,      max: 30,  standardHeaders: true, legacyHeaders: false });
const writeLimiter   = rateLimit({ windowMs: 60 * 1000,      max: 60,  standardHeaders: true, legacyHeaders: false });
const adminLimiter   = rateLimit({ windowMs: 60 * 1000,      max: 60,  standardHeaders: true, legacyHeaders: false });

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'connect.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,                       // requires HTTPS in production
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  },
}));

// ─── DATABASE ──────────────────────────────────────────────────────────
const db = new sqlite3.Database('./database.db');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// BEGIN IMMEDIATE takes the write lock at start, so all reads inside
// see the latest committed state and no other writer can interleave.
async function transaction(fn) {
  await dbRun('BEGIN IMMEDIATE');
  try {
    const result = await fn();
    await dbRun('COMMIT');
    return result;
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    throw err;
  }
}

// ─── VALIDATION ────────────────────────────────────────────────────────
const isValidUsername = u => typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u);
const isValidPassword = p => typeof p === 'string' && p.length >= 8 && p.length <= 128;
const isValidBio      = b => typeof b === 'string' && b.length <= 160;
const isValidId       = v => Number.isInteger(Number(v)) && Number(v) > 0;
const isValidAmount   = v => Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 1_000_000_000;
const isValidAssetId  = v => typeof v === 'string' && /^\d{1,20}$/.test(v);
const isValidCurrency = v => v === 'robux' || v === 'tix';
const isValidPerm     = v => v === 'is_admin' || v === 'can_upload';

const RESERVED_USERNAMES = new Set(['roblox', 'moneyium', 'system', 'admin', 'support']);

// ─── AUTH MIDDLEWARE (re-queries DB every request) ─────────────────────
async function authenticate(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  try {
    const user = await dbGet(
      'SELECT id, username, robux, tix, is_admin, can_upload, bio, rap, is_verified FROM users WHERE id = ?',
      [req.session.userId]
    );
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Invalid session' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.is_admin !== 1) return res.status(403).json({ error: 'Admin only' });
  next();
}

// ─── DATABASE SETUP ────────────────────────────────────────────────────
async function setupDatabase() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE, password TEXT,
    robux INTEGER DEFAULT 100, tix INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0, can_upload INTEGER DEFAULT 0,
    bio TEXT DEFAULT 'Welcome to my profile!', rap INTEGER DEFAULT 0,
    is_verified INTEGER DEFAULT 0, tos_accepted_at DATETIME
  )`);
  // Migration for pre-consent databases.
  await dbRun(`ALTER TABLE users ADD COLUMN tos_accepted_at DATETIME`).catch(() => {});
  await dbRun(`CREATE TABLE IF NOT EXISTS catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT, custom_name TEXT,
    asset_image TEXT, description TEXT, price INTEGER DEFAULT 10,
    category TEXT DEFAULT 'Hats', item_type TEXT DEFAULT 'None',
    total_copies INTEGER DEFAULT 1, copies_left INTEGER DEFAULT 1, creator_id INTEGER
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, catalog_id INTEGER,
    serial_number INTEGER DEFAULT 0, is_wearing INTEGER DEFAULT 0,
    purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount INTEGER,
    site_item_id TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER,
    sender_items TEXT, receiver_items TEXT,
    sender_robux INTEGER DEFAULT 0, receiver_robux INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await dbRun(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT,
    thumbnail TEXT, game_url TEXT, creator_id INTEGER, visits INTEGER DEFAULT 0
  )`);

  // System user
  const sys = await dbGet(`SELECT id FROM users WHERE username = 'ROBLOX'`);
  if (!sys) {
    const hash = await bcrypt.hash(ROBLOX_SYSTEM_PASSWORD, BCRYPT_ROUNDS);
    await dbRun(
      `INSERT INTO users (username, password, is_admin, can_upload, bio, is_verified)
       VALUES ('ROBLOX', ?, 1, 1, 'Official system account.', 1)`,
      [hash]
    );
  } else {
    // Ensure system password matches env, in case it was previously defaulted.
    const valid = await bcrypt.compare(ROBLOX_SYSTEM_PASSWORD, sys.password || '');
    if (!valid) {
      const hash = await bcrypt.hash(ROBLOX_SYSTEM_PASSWORD, BCRYPT_ROUNDS);
      await dbRun(`UPDATE users SET password = ? WHERE id = ?`, [hash, sys.id]);
    }
  }
  await injectBaseballCap();
}

async function injectBaseballCap() {
  const existing = await dbGet(`SELECT id FROM catalog WHERE asset_id = '417457461'`);
  if (existing) return;
  const capImage = 'https://tr.rbxcdn.com/180DAY-c977137e24824f9a31f4837a97fcbda/420/420/Hat/Png/noFilter';
  const { lastID } = await dbRun(
    `INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id)
     VALUES (?, ?, ?, ?, 0, 'Hats', 'None', 999999, 999999, 1)`,
    ['417457461', "ROBLOX 'R' Baseball Cap", capImage, 'The classic ROBLOX Baseball Cap. Free for everyone!']
  );
  const sys = await dbGet(`SELECT id FROM users WHERE username = 'ROBLOX'`);
  if (sys) {
    await dbRun(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, 1)`, [sys.id, lastID]);
  }
}

// ─── AUTH ROUTES ───────────────────────────────────────────────────────
app.post('/api/register', authLimiter, async (req, res, next) => {
  try {
    const { username, password, agreedToTos } = req.body;
    if (agreedToTos !== true) {
      return res.status(400).json({ error: 'You must agree to the Terms of Service and Privacy Policy.' });
    }
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username must be 3–20 characters (letters, numbers, underscore).' });
    }
    if (RESERVED_USERNAMES.has(username.toLowerCase())) {
      return res.status(400).json({ error: 'This username is reserved.' });
    }
    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password must be 8–128 characters.' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await transaction(async () => {
      // ROBLOX system user already counts, so first *real* user sees count=1.
      const { count } = await dbGet(`SELECT COUNT(*) as count FROM users`);
      const isFirst = count <= 1 ? 1 : 0;
      await dbRun(
        `INSERT INTO users (username, password, is_admin, can_upload, tos_accepted_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [username, hash, isFirst, isFirst]
      );
    });
    res.json({ success: true });
  } catch (err) {
    if (/UNIQUE/i.test(err.message)) return res.status(400).json({ error: 'Username taken' });
    next(err);
  }
});

app.post('/api/login', authLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid username or password' });
    }
    const user = await dbGet(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`, [username]);
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid username or password' });
    req.session.userId = user.id;
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ─── USER ROUTES ───────────────────────────────────────────────────────
app.get('/api/user', authenticate, async (req, res, next) => {
  try {
    const inv = await dbAll(
      `SELECT c.*, i.is_wearing, i.serial_number FROM inventory i
       JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`,
      [req.user.id]
    );
    res.json({ user: req.user, inventory: inv || [] });
  } catch (err) { next(err); }
});

app.get('/api/user/:id', authenticate, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
    const user = await dbGet(
      `SELECT id, username, robux, tix, is_admin, can_upload, bio, rap, is_verified FROM users WHERE id = ?`,
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    const inv = await dbAll(
      `SELECT c.*, i.is_wearing, i.serial_number FROM inventory i
       JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`,
      [user.id]
    );
    res.json({ user, inventory: inv || [] });
  } catch (err) { next(err); }
});

app.post('/api/update-bio', authenticate, writeLimiter, async (req, res, next) => {
  try {
    if (!isValidBio(req.body.bio)) return res.status(400).json({ error: 'Bio must be 160 characters or fewer.' });
    await dbRun(`UPDATE users SET bio = ? WHERE id = ?`, [req.body.bio, req.user.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── CATALOG / ECONOMY ─────────────────────────────────────────────────
app.get('/api/catalog', async (req, res, next) => {
  try { res.json(await dbAll(`SELECT * FROM catalog`)); } catch (err) { next(err); }
});

app.get('/api/catalog/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid item id' });
    const item = await dbGet(`SELECT * FROM catalog WHERE id = ?`, [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    const owners = await dbAll(
      `SELECT u.username, u.is_verified, i.serial_number, i.purchase_date
       FROM inventory i JOIN users u ON i.user_id = u.id
       WHERE i.catalog_id = ? ORDER BY i.serial_number ASC`,
      [item.id]
    );
    res.json({ item, owners: owners || [] });
  } catch (err) { next(err); }
});

app.post('/api/buy-item', authenticate, writeLimiter, async (req, res, next) => {
  try {
    const { itemId } = req.body;
    if (!isValidId(itemId)) return res.status(400).json({ error: 'Invalid item' });

    await transaction(async () => {
      const item = await dbGet(`SELECT * FROM catalog WHERE id = ?`, [itemId]);
      if (!item) throw { status: 404, message: 'Item not found' };
      if (item.copies_left <= 0) throw { status: 400, message: 'This item is sold out!' };

      const user = await dbGet(`SELECT robux FROM users WHERE id = ?`, [req.user.id]);
      if (!user) throw { status: 401, message: 'User not found' };
      if (user.robux < item.price) throw { status: 400, message: 'Not enough Robux!' };

      const owned = await dbGet(
        `SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`,
        [req.user.id, itemId]
      );
      if (owned && item.item_type !== 'None') throw { status: 400, message: 'You already own this item!' };

      const serial = (item.item_type === 'Limited' || item.item_type === 'LimitedU')
        ? item.total_copies - item.copies_left : 0;

      await dbRun(`UPDATE users SET robux = robux - ?, rap = rap + ? WHERE id = ?`,
        [item.price, item.price, req.user.id]);
      await dbRun(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, ?)`,
        [req.user.id, itemId, serial]);
      await dbRun(`UPDATE catalog SET copies_left = copies_left - 1 WHERE id = ?`, [itemId]);
      await dbRun(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Purchase', ?, ?)`,
        [req.user.id, -item.price, item.id]);
    });

    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

app.post('/api/sell-item', authenticate, writeLimiter, async (req, res, next) => {
  try {
    const { itemId } = req.body;
    if (!isValidId(itemId)) return res.status(400).json({ error: 'Invalid item' });

    await transaction(async () => {
      const item = await dbGet(`SELECT * FROM catalog WHERE id = ?`, [itemId]);
      if (!item) throw { status: 404, message: 'Item not found' };
      const owned = await dbGet(
        `SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`,
        [req.user.id, itemId]
      );
      if (!owned) throw { status: 400, message: "You don't own this" };

      await dbRun(`DELETE FROM inventory WHERE id = ?`, [owned.id]);
      await dbRun(`UPDATE users SET robux = robux + ? WHERE id = ?`, [item.price, req.user.id]);
      await dbRun(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Sale', ?, ?)`,
        [req.user.id, item.price, item.id]);
      if (item.item_type === 'Limited' || item.item_type === 'LimitedU') {
        await dbRun(`UPDATE catalog SET copies_left = copies_left + 1 WHERE id = ?`, [itemId]);
      }
    });

    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

app.post('/api/equip-item', authenticate, writeLimiter, async (req, res, next) => {
  try {
    const { itemId, equip } = req.body;
    if (!isValidId(itemId)) return res.status(400).json({ error: 'Invalid item' });
    const item = await dbGet(
      `SELECT c.category FROM inventory i JOIN catalog c ON i.catalog_id = c.id
       WHERE i.user_id = ? AND i.catalog_id = ?`,
      [req.user.id, itemId]
    );
    if (!item) return res.status(404).json({ error: 'Not in inventory' });
    const equipBit = equip ? 1 : 0;
    await transaction(async () => {
      if (equipBit) {
        await dbRun(
          `UPDATE inventory SET is_wearing = 0
           WHERE user_id = ? AND catalog_id IN (SELECT id FROM catalog WHERE category = ?)`,
          [req.user.id, item.category]
        );
      }
      await dbRun(`UPDATE inventory SET is_wearing = ? WHERE user_id = ? AND catalog_id = ?`,
        [equipBit, req.user.id, itemId]);
    });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── GAMES ─────────────────────────────────────────────────────────────
app.get('/api/games', async (req, res, next) => {
  try {
    const games = await dbAll(
      `SELECT g.*, u.username as creator_name FROM games g
       JOIN users u ON g.creator_id = u.id ORDER BY visits DESC`
    );
    res.json(games || []);
  } catch (err) { next(err); }
});

app.post('/api/admin/upload-game', authenticate, requireAdmin, adminLimiter, async (req, res, next) => {
  try {
    const { name, description, thumbnail, game_url } = req.body;
    if (typeof name !== 'string' || name.length < 1 || name.length > 100)
      return res.status(400).json({ error: 'Invalid game name' });
    if (typeof description !== 'string' || description.length > 2000)
      return res.status(400).json({ error: 'Invalid description' });
    if (typeof thumbnail !== 'string' || thumbnail.length > 500)
      return res.status(400).json({ error: 'Invalid thumbnail' });
    if (typeof game_url !== 'string' || game_url.length > 500)
      return res.status(400).json({ error: 'Invalid game URL' });

    await dbRun(
      `INSERT INTO games (name, description, thumbnail, game_url, creator_id) VALUES (?, ?, ?, ?, ?)`,
      [name, description, thumbnail, game_url, req.user.id]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── TRADING ───────────────────────────────────────────────────────────
app.post('/api/trade/send', authenticate, tradeLimiter, async (req, res, next) => {
  try {
    const { receiverName, senderItems, senderRobux } = req.body;
    if (!isValidUsername(receiverName)) return res.status(400).json({ error: 'Invalid username' });
    if (!Array.isArray(senderItems) || senderItems.some(id => !isValidId(id)))
      return res.status(400).json({ error: 'Invalid item list' });
    if (!isValidAmount(senderRobux)) return res.status(400).json({ error: 'Invalid Robux amount' });

    const receiver = await dbGet(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`, [receiverName]);
    if (!receiver) return res.status(404).json({ error: 'User not found' });
    if (receiver.id === req.user.id) return res.status(400).json({ error: "You can't trade yourself" });

    if (req.user.robux < senderRobux)
      return res.status(400).json({ error: 'Not enough Robux' });

    for (const id of senderItems) {
      const inv = await dbGet(
        `SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`,
        [req.user.id, id]
      );
      if (!inv) return res.status(400).json({ error: "You don't own one of these items" });
    }

    await dbRun(
      `INSERT INTO trades (sender_id, receiver_id, sender_items, receiver_items, sender_robux, receiver_robux)
       VALUES (?, ?, ?, '[]', ?, 0)`,
      [req.user.id, receiver.id, JSON.stringify(senderItems), senderRobux]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.get('/api/trade/pending', authenticate, async (req, res, next) => {
  try {
    const trades = await dbAll(
      `SELECT t.*, u1.username as sender_name, u2.username as receiver_name
       FROM trades t
       JOIN users u1 ON t.sender_id = u1.id
       JOIN users u2 ON t.receiver_id = u2.id
       WHERE (t.receiver_id = ? OR t.sender_id = ?) AND t.status = 'pending'`,
      [req.user.id, req.user.id]
    );
    res.json(trades || []);
  } catch (err) { next(err); }
});

app.post('/api/trade/respond', authenticate, tradeLimiter, async (req, res, next) => {
  try {
    const { tradeId, action } = req.body;
    if (!isValidId(tradeId)) return res.status(400).json({ error: 'Invalid trade id' });
    if (action !== 'accept' && action !== 'decline') return res.status(400).json({ error: 'Invalid action' });

    await transaction(async () => {
      const trade = await dbGet(
        `SELECT * FROM trades WHERE id = ? AND receiver_id = ? AND status = 'pending'`,
        [tradeId, req.user.id]
      );
      if (!trade) throw { status: 404, message: 'Trade not found or already handled.' };

      if (action === 'decline') {
        await dbRun(`UPDATE trades SET status = 'declined' WHERE id = ?`, [tradeId]);
        return;
      }

      // Re-validate everything inside the write lock.
      const sender = await dbGet(`SELECT robux FROM users WHERE id = ?`, [trade.sender_id]);
      const receiver = await dbGet(`SELECT robux FROM users WHERE id = ?`, [trade.receiver_id]);
      if (!sender || sender.robux < trade.sender_robux)
        throw { status: 400, message: 'Sender no longer has enough Robux.' };
      if (!receiver || receiver.robux < trade.receiver_robux)
        throw { status: 400, message: 'You no longer have enough Robux.' };

      const sItems = JSON.parse(trade.sender_items || '[]');
      const rItems = JSON.parse(trade.receiver_items || '[]');
      for (const id of sItems) {
        const inv = await dbGet(
          `SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`,
          [trade.sender_id, id]
        );
        if (!inv) throw { status: 400, message: 'Sender no longer owns a promised item.' };
      }
      for (const id of rItems) {
        const inv = await dbGet(
          `SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`,
          [trade.receiver_id, id]
        );
        if (!inv) throw { status: 400, message: 'You no longer own a promised item.' };
      }

      await dbRun(`UPDATE users SET robux = robux - ? WHERE id = ?`, [trade.sender_robux, trade.sender_id]);
      await dbRun(`UPDATE users SET robux = robux + ? WHERE id = ?`, [trade.sender_robux, trade.receiver_id]);
      await dbRun(`UPDATE users SET robux = robux - ? WHERE id = ?`, [trade.receiver_robux, trade.receiver_id]);
      await dbRun(`UPDATE users SET robux = robux + ? WHERE id = ?`, [trade.receiver_robux, trade.sender_id]);

      for (const id of sItems) {
        await dbRun(
          `UPDATE inventory SET user_id = ? WHERE user_id = ? AND catalog_id = ?`,
          [trade.receiver_id, trade.sender_id, id]
        );
      }
      for (const id of rItems) {
        await dbRun(
          `UPDATE inventory SET user_id = ? WHERE user_id = ? AND catalog_id = ?`,
          [trade.sender_id, trade.receiver_id, id]
        );
      }

      await dbRun(`UPDATE trades SET status = 'accepted' WHERE id = ?`, [tradeId]);
      await dbRun(
        `INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Trade Sent', ?, 'N/A')`,
        [trade.sender_id, -trade.sender_robux]
      );
      await dbRun(
        `INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Trade Received', ?, 'N/A')`,
        [trade.receiver_id, trade.receiver_robux]
      );
    });

    res.json({ success: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ─── ADMIN ─────────────────────────────────────────────────────────────
app.get('/api/admin/users', authenticate, requireAdmin, async (req, res, next) => {
  try {
    res.json(await dbAll(`SELECT id, username, robux, tix, is_admin, can_upload, is_verified FROM users`));
  } catch (err) { next(err); }
});

app.get('/api/admin/transactions/:id', authenticate, requireAdmin, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });
    res.json(await dbAll(
      `SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC`,
      [req.params.id]
    ));
  } catch (err) { next(err); }
});

app.post('/api/admin/give-currency', authenticate, requireAdmin, adminLimiter, async (req, res, next) => {
  try {
    const { userId, currency, amount } = req.body;
    if (!isValidId(userId) || !isValidCurrency(currency) || !isValidAmount(amount)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    // Whitelisted above — safe to interpolate.
    await dbRun(`UPDATE users SET ${currency} = ${currency} + ? WHERE id = ?`, [Number(amount), Number(userId)]);
    await dbRun(
      `INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Admin Give', ?, 'N/A')`,
      [Number(userId), Number(amount)]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.get('/api/admin/catalog', authenticate, requireAdmin, async (req, res, next) => {
  try { res.json(await dbAll(`SELECT * FROM catalog`)); } catch (err) { next(err); }
});

app.post('/api/admin/toggle-perm', authenticate, requireAdmin, adminLimiter, async (req, res, next) => {
  try {
    const { userId, perm } = req.body;
    if (!isValidId(userId) || !isValidPerm(perm)) return res.status(400).json({ error: 'Invalid input' });
    if (Number(userId) === req.user.id && perm === 'is_admin') {
      return res.status(400).json({ error: 'You cannot demote yourself.' });
    }
    // Whitelisted above — safe to interpolate.
    await dbRun(`UPDATE users SET ${perm} = NOT ${perm} WHERE id = ?`, [Number(userId)]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.post('/api/admin/upload-item', authenticate, requireAdmin, adminLimiter, async (req, res, next) => {
  try {
    const { assetId, custom_name, description, price, category, item_type, copies } = req.body;

    if (!isValidAssetId(assetId)) return res.status(400).json({ error: 'Invalid Asset ID' });
    if (!isValidAmount(price)) return res.status(400).json({ error: 'Invalid price' });
    if (typeof category !== 'string' || category.length > 30)
      return res.status(400).json({ error: 'Invalid category' });
    if (!['None', 'Limited', 'LimitedU'].includes(item_type))
      return res.status(400).json({ error: 'Invalid item type' });

    const userCopies = item_type !== 'None' ? parseInt(copies, 10) : 1;
    if (item_type !== 'None' && (!Number.isInteger(userCopies) || userCopies < 1 || userCopies > 100000)) {
      return res.status(400).json({ error: 'Invalid copies' });
    }
    const totalCopies = userCopies + 1;

    const details = await axios.get(`https://economy.roblox.com/v2/assets/${assetId}/details`, { timeout: 8000 });
    const thumb = await axios.get(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`,
      { timeout: 8000 }
    );
    const imageUrl = thumb.data?.data?.[0]?.imageUrl;
    if (!imageUrl) return res.status(400).json({ error: 'Could not fetch item thumbnail' });

    const { lastID } = await dbRun(
      `INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [assetId, custom_name || details.data.Name, imageUrl, description || 'No desc.',
       Number(price), category, item_type, totalCopies, userCopies, req.user.id]
    );

    const sys = await dbGet(`SELECT id FROM users WHERE username = 'ROBLOX'`);
    if (sys) {
      await dbRun(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, 1)`, [sys.id, lastID]);
    }
    res.json({ success: true });
  } catch (err) {
    if (err.response) return res.status(400).json({ error: 'Invalid Asset ID' });
    next(err);
  }
});

// ─── SPA FALLBACK ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api') || req.path.endsWith('.html')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── STARTUP ───────────────────────────────────────────────────────────
if (require.main === module) {
  setupDatabase()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Moneyium running at http://localhost:${PORT}  (${NODE_ENV})`);
        if (!IS_PROD) console.log('[WARN] Development mode — do not expose this port to the internet.');
      });
    })
    .catch(err => {
      console.error('[FATAL] Database setup failed:', err);
      process.exit(1);
    });
}

module.exports = app;
