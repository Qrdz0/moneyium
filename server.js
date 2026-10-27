const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({ secret: 'moneyium_secret_key', resave: false, saveUninitialized: true, cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, path: '/' } }));

const db = new sqlite3.Database('./database.db');

function setupDatabase() {
    db.serialize(() => {
        // 1. Create Tables
        db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, robux INTEGER DEFAULT 100, tix INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0, can_upload INTEGER DEFAULT 0, bio TEXT DEFAULT 'Welcome to my profile!', rap INTEGER DEFAULT 0, is_verified INTEGER DEFAULT 0)`);
        db.run(`CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT, custom_name TEXT, asset_image TEXT, description TEXT, price INTEGER DEFAULT 10, category TEXT DEFAULT 'Hats', item_type TEXT DEFAULT 'None', total_copies INTEGER DEFAULT 1, copies_left INTEGER DEFAULT 1, creator_id INTEGER)`);
        db.run(`CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, catalog_id INTEGER, serial_number INTEGER DEFAULT 0, is_wearing INTEGER DEFAULT 0, purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
        db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount INTEGER, site_item_id TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
        db.run(`CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, receiver_id INTEGER, sender_items TEXT, receiver_items TEXT, sender_robux INTEGER DEFAULT 0, receiver_robux INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        db.run(`CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, description TEXT, thumbnail TEXT, game_url TEXT, creator_id INTEGER, visits INTEGER DEFAULT 0)`);

        // 2. Ensure the verified system accounts exist
        ensureSystemAccount('ROBLOX', 'system_dummy_pass_123', {
            isAdmin: 1,
            canUpload: 1,
            bio: 'This is the official system account of Moneyium. Holding serial #1 of all assets.'
        }, () => {
            ensureSystemAccount('moneyium', 'system_dummy_pass_123', {
                isAdmin: 1,
                canUpload: 1,
                bio: 'Official Moneyium Staff Account.'
            }, () => injectBaseballCap());
        });
    });
}

// Creates a system account if missing, otherwise keeps its flags, bio, and password in sync.
function ensureSystemAccount(username, password, options, done) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, is_admin, can_upload, bio, is_verified) VALUES (?, ?, ?, ?, ?, 1)`,
                [username, hashedPassword, options.isAdmin, options.canUpload, options.bio],
                () => done && done());
        } else {
            db.run(`UPDATE users SET password = ?, is_admin = ?, can_upload = ?, bio = ?, is_verified = 1 WHERE id = ?`,
                [hashedPassword, options.isAdmin, options.canUpload, options.bio, row.id],
                () => done && done());
        }
    });
}

// 3. Ensure the Free ROBLOX 'R' Baseball Cap Exists
function injectBaseballCap() {
    const capImage = 'https://tr.rbxcdn.com/180DAY-c977137e24824df9a31f4837a97fcbda/420/420/Hat/Png/noFilter';
    db.get(`SELECT id FROM catalog WHERE asset_id = '417457461'`, (err, row) => {
        if (!row) {
            const capName = "ROBLOX 'R' Baseball Cap";
            const capDesc = 'The classic ROBLOX Baseball Cap. Free for everyone!';
            
            db.run(`INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id) VALUES (?, ?, ?, ?, 0, 'Hats', 'None', 999999, 999999, 1)`, 
                ['417457461', capName, capImage, capDesc], 
                function(err) {
                    if (!err) {
                        const newItemId = this.lastID;
                        db.get(`SELECT id FROM users WHERE username = 'ROBLOX'`, (err, sysUser) => {
                            if (sysUser) {
                                db.run(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, 1)`, [sysUser.id, newItemId]);
                            }
                        });
                    }
                }
            );
        } else {
            db.run(`UPDATE catalog SET asset_image = ? WHERE id = ?`, [capImage, row.id]);
        }
    });
}

setupDatabase();

// --- AUTH & USER ROUTES ---
app.post('/api/register', async (req, res) => {
    let { username, password } = req.body;
    if (!username || !password || username.includes(' ')) return res.status(400).json({ error: "Invalid username/password" });
    if (['roblox', 'moneyium'].includes(username.toLowerCase())) return res.status(400).json({ error: "This username is reserved." });

    const hashedPassword = await bcrypt.hash(password, 10);
    db.get(`SELECT COUNT(*) as count FROM users WHERE LOWER(username) NOT IN ('roblox', 'moneyium')`, [], async (err, row) => {
        const isFirstUser = row.count === 0 ? 1 : 0;
        db.run(`INSERT INTO users (username, password, is_admin, can_upload) VALUES (?, ?, ?, ?)`, [username, hashedPassword, isFirstUser, isFirstUser], function(err) {
            if (err) return res.status(400).json({ error: "Username taken" });
            res.json({ success: true });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user) return res.status(400).json({ error: "User not found" });
        if (!await bcrypt.compare(password, user.password)) return res.status(400).json({ error: "Wrong password" });
        req.session.userId = user.id; req.session.isAdmin = user.is_admin;
        res.json({ success: true });
    });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/user', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap, is_verified FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (!user) { req.session.destroy(); return res.status(401).json({ error: "Invalid session" }); }
        db.all(`SELECT c.*, i.id AS inventory_id, i.is_wearing, i.serial_number FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            res.json({ user, inventory: inventory || [] });
        });
    });
});

app.get('/api/user/:id', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap, is_verified FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });
        db.all(`SELECT c.*, i.id AS inventory_id, i.is_wearing, i.serial_number FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            res.json({ user, inventory: inventory || [] });
        });
    });
});

app.get('/api/catalog', (req, res) => { db.all(`SELECT * FROM catalog`, (err, catalog) => { res.json(catalog || []); }); });
app.get('/api/catalog/:id', (req, res) => {
    db.get(`SELECT * FROM catalog WHERE id = ?`, [req.params.id], (err, item) => {
        if (!item) return res.status(404).json({ error: "Item not found" });
        db.all(`SELECT u.username, u.is_verified, i.serial_number, i.purchase_date FROM inventory i JOIN users u ON i.user_id = u.id WHERE i.catalog_id = ? ORDER BY i.serial_number ASC`, [item.id], (err, owners) => {
            res.json({ item, owners: owners || [] });
        });
    });
});

app.post('/api/update-bio', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.run(`UPDATE users SET bio = ? WHERE id = ?`, [req.body.bio, req.session.userId], () => res.json({ success: true }));
});

app.post('/api/buy-item', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { itemId } = req.body;
    db.get(`SELECT robux FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if(!user) return res.status(401).json({ error: "User not found" });
        db.get(`SELECT * FROM catalog WHERE id = ?`, [itemId], (err, item) => {
            if (!item) return res.status(404).json({ error: "Item not found" });
            if (item.copies_left <= 0) return res.status(400).json({ error: "This item is sold out!" });
            if (user.robux < item.price) return res.status(400).json({ error: "Not enough Robux!" });
            
            db.get(`SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`, [req.session.userId, itemId], (err, owned) => {
                if (owned && item.item_type !== 'None') return res.status(400).json({ error: "You already own this item!" });
                let serialNumber = (item.item_type === 'Limited' || item.item_type === 'LimitedU') ? item.total_copies - item.copies_left : 0;
                db.run(`UPDATE users SET robux = robux - ?, rap = rap + ? WHERE id = ?`, [item.price, item.price, req.session.userId], () => {
                    db.run(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, ?)`, [req.session.userId, itemId, serialNumber], () => {
                        db.run(`UPDATE catalog SET copies_left = copies_left - 1 WHERE id = ?`, [itemId]);
                        db.run(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Purchase', ?, ?)`, [req.session.userId, -item.price, item.id]);
                        res.json({ success: true });
                    });
                });
            });
        });
    });
});

app.post('/api/equip-item', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { itemId, equip } = req.body;
    db.get(`SELECT c.category FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ? AND i.id = ?`, [req.session.userId, itemId], (err, item) => {
        if (!item) return res.status(404).json({ error: "Not in inventory" });
        if (equip) db.run(`UPDATE inventory SET is_wearing = 0 WHERE user_id = ? AND catalog_id IN (SELECT id FROM catalog WHERE category = ?)`, [req.session.userId, item.category]);
        db.run(`UPDATE inventory SET is_wearing = ? WHERE user_id = ? AND id = ?`, [equip ? 1 : 0, req.session.userId, itemId], () => res.json({ success: true }));
    });
});

app.post('/api/sell-item', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { itemId } = req.body;
    db.get(`SELECT c.*, i.id AS inventory_id FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ? AND i.id = ?`, [req.session.userId, itemId], (err, item) => {
        if (!item) return res.status(400).json({ error: "You don't own this" });
        db.run(`DELETE FROM inventory WHERE user_id = ? AND id = ?`, [req.session.userId, item.inventory_id], function(err) {
            if (this.changes === 0) return res.status(400).json({ error: "You don't own this" });
            db.run(`UPDATE users SET robux = robux + ? WHERE id = ?`, [item.price, req.session.userId]);
            db.run(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Sale', ?, ?)`, [req.session.userId, item.price, item.id]);
            if (item.item_type === 'Limited' || item.item_type === 'LimitedU') db.run(`UPDATE catalog SET copies_left = copies_left + 1 WHERE id = ?`, [item.id]);
            res.json({ success: true });
        });
    });
});

// --- GAMES ROUTES ---
app.get('/api/games', (req, res) => {
    db.all(`SELECT g.*, u.username as creator_name FROM games g JOIN users u ON g.creator_id = u.id ORDER BY visits DESC`, (err, games) => {
        res.json(games || []);
    });
});

app.post('/api/admin/upload-game', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { name, description, thumbnail, game_url } = req.body;
    db.run(`INSERT INTO games (name, description, thumbnail, game_url, creator_id) VALUES (?, ?, ?, ?, ?)`, 
        [name, description, thumbnail, game_url, req.session.userId], 
        function(err) {
            if (err) return res.status(500).json({ error: "DB Error" });
            res.json({ success: true });
        }
    );
});

// --- TRADING ROUTES ---
// UPDATED: Now takes receiverName instead of ID!
app.post('/api/trade/send', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { receiverName, senderItems, senderRobux } = req.body;
    
    db.get(`SELECT id FROM users WHERE username = ?`, [receiverName], (err, receiver) => {
        if (!receiver) return res.status(404).json({ error: "User not found" });
        if (receiver.id === req.session.userId) return res.status(400).json({ error: "You can't trade yourself" });

        db.run(`INSERT INTO trades (sender_id, receiver_id, sender_items, receiver_items, sender_robux, receiver_robux) VALUES (?, ?, ?, ?, ?, ?)`, 
            [req.session.userId, receiver.id, JSON.stringify(senderItems), JSON.stringify([]), senderRobux, 0], 
            function(err) { 
                if (err) return res.status(500).json({ error: "DB Error" }); 
                res.json({ success: true }); 
            }
        );
    });
});

app.get('/api/trade/pending', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.all(`SELECT t.*, u1.username as sender_name, u2.username as receiver_name FROM trades t JOIN users u1 ON t.sender_id = u1.id JOIN users u2 ON t.receiver_id = u2.id WHERE (t.receiver_id = ? OR t.sender_id = ?) AND t.status = 'pending'`, 
        [req.session.userId, req.session.userId], (err, trades) => { res.json(trades || []); });
});

app.post('/api/trade/respond', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { tradeId, action } = req.body; 
    db.get(`SELECT * FROM trades WHERE id = ? AND receiver_id = ? AND status = 'pending'`, [tradeId, req.session.userId], (err, trade) => {
        if (!trade) return res.status(404).json({ error: "Trade not found or already handled." });
        if (action === 'decline') {
            db.run(`UPDATE trades SET status = 'declined' WHERE id = ?`, [tradeId]);
            return res.json({ success: true });
        }
        if (action === 'accept') {
            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                db.get(`SELECT robux FROM users WHERE id = ?`, [trade.sender_id], (err, sender) => {
                    db.get(`SELECT robux FROM users WHERE id = ?`, [trade.receiver_id], (err, receiver) => {
                        if (sender.robux < trade.sender_robux || receiver.robux < trade.receiver_robux) {
                            db.run("ROLLBACK");
                            return res.status(400).json({ error: "One or both parties do not have enough Robux." });
                        }
                        db.run(`UPDATE users SET robux = robux - ? WHERE id = ?`, [trade.sender_robux, trade.sender_id]);
                        db.run(`UPDATE users SET robux = robux + ? WHERE id = ?`, [trade.sender_robux, trade.receiver_id]);
                        db.run(`UPDATE users SET robux = robux - ? WHERE id = ?`, [trade.receiver_robux, trade.receiver_id]);
                        db.run(`UPDATE users SET robux = robux + ? WHERE id = ?`, [trade.receiver_robux, trade.sender_id]);
                        
                        const sItems = JSON.parse(trade.sender_items || '[]');
                        const rItems = JSON.parse(trade.receiver_items || '[]');
                        sItems.forEach(itemId => db.run(`UPDATE inventory SET user_id = ? WHERE user_id = ? AND catalog_id = ?`, [trade.receiver_id, trade.sender_id, itemId]));
                        rItems.forEach(itemId => db.run(`UPDATE inventory SET user_id = ? WHERE user_id = ? AND catalog_id = ?`, [trade.sender_id, trade.receiver_id, itemId]));
                        
                        db.run(`UPDATE trades SET status = 'accepted' WHERE id = ?`, [tradeId]);
                        db.run("COMMIT");
                        res.json({ success: true });
                    });
                });
            });
        }
    });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', (req, res) => { if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" }); db.all(`SELECT id, username, robux, tix, is_admin, can_upload, is_verified FROM users`, (err, users) => res.json(users)); });
app.get('/api/admin/transactions/:id', (req, res) => { if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" }); db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC`, [req.params.id], (err, txs) => res.json(txs || [])); });
app.post('/api/admin/give-currency', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId, currency, amount } = req.body; 
    db.run(`UPDATE users SET ${currency} = ${currency} + ? WHERE id = ?`, [amount, userId], () => {
        db.run(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Admin Give', ?, 'N/A')`, [userId, amount]);
        res.json({ success: true });
    });
});
app.get('/api/admin/catalog', (req, res) => { if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" }); db.all(`SELECT * FROM catalog`, (err, catalog) => res.json(catalog)); });
app.post('/api/admin/toggle-perm', (req, res) => { if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" }); db.run(`UPDATE users SET ${req.body.perm} = NOT ${req.body.perm} WHERE id = ?`, [req.body.userId], () => res.json({ success: true })); });

app.post('/api/admin/upload-item', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { assetId, custom_name, description, price, category, item_type, copies } = req.body;
    try {
        const detailsRes = await axios.get(`https://economy.roblox.com/v2/assets/${assetId}/details`);
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`);
        const userCopies = (item_type !== 'None') ? parseInt(copies) : 1;
        const totalCopies = userCopies + 1;
        db.run(`INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [assetId, custom_name || detailsRes.data.Name, thumbRes.data.data[0].imageUrl, description || "No desc.", price, category, item_type, totalCopies, userCopies, req.session.userId], 
            function(err) {
                if (err) return res.status(500).json({ error: "DB Error" });
                const newItemId = this.lastID;
                db.get(`SELECT id FROM users WHERE username = 'ROBLOX'`, (err, sysUser) => {
                    if (sysUser) db.run(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, 1)`, [sysUser.id, newItemId]);
                    res.json({ success: true });
                });
            }
        );
    } catch (error) { res.status(400).json({ error: "Invalid Asset ID" }); }
});

app.use((req, res, next) => { if (req.path.startsWith('/api') || req.path.endsWith('.html')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => console.log(`Moneyium running at http://localhost:${PORT}`));