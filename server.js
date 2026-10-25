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
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, robux INTEGER DEFAULT 100, tix INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0, can_upload INTEGER DEFAULT 0, bio TEXT DEFAULT 'Welcome to my profile!', rap INTEGER DEFAULT 0)`);
            db.run(`CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT, custom_name TEXT, asset_image TEXT, description TEXT, price INTEGER DEFAULT 10, category TEXT DEFAULT 'Hats', item_type TEXT DEFAULT 'None', copies_left INTEGER DEFAULT 1, creator_id INTEGER)`);
            db.run(`CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, catalog_id INTEGER, is_wearing INTEGER DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id))`);
            db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount INTEGER, site_item_id TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`, resolve);
        });
    });
}
setupDatabase();

// --- AUTH & USER ROUTES ---
app.post('/api/register', async (req, res) => {
    let { username, password } = req.body;
    if (!username || !password || username.includes(' ')) return res.status(400).json({ error: "Invalid username/password" });
    const hashedPassword = await bcrypt.hash(password, 10);
    db.get(`SELECT COUNT(*) as count FROM users`, [], async (err, row) => {
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
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        db.all(`SELECT c.*, i.is_wearing FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            db.all(`SELECT * FROM catalog WHERE copies_left > 0`, (err, catalog) => {
                res.json({ user, inventory: inventory || [], catalog: catalog || [] });
            });
        });
    });
});

app.get('/api/user/:id', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        db.all(`SELECT c.*, i.is_wearing FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            res.json({ user, inventory: inventory || [] });
        });
    });
});

app.post('/api/update-bio', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.run(`UPDATE users SET bio = ? WHERE id = ?`, [req.body.bio, req.session.userId], (err) => res.json({ success: true }));
});

app.post('/api/buy-item', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { itemId } = req.body;
    db.get(`SELECT robux FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        db.get(`SELECT * FROM catalog WHERE id = ?`, [itemId], (err, item) => {
            if (!item) return res.status(404).json({ error: "Item offsale" });
            if (user.robux < item.price) return res.status(400).json({ error: "Not enough Robux!" });
            
            db.get(`SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`, [req.session.userId, itemId], (err, owned) => {
                if (owned && item.item_type !== 'None') return res.status(400).json({ error: "You already own this item!" });
                
                db.run(`UPDATE users SET robux = robux - ?, rap = rap + ? WHERE id = ?`, [item.price, item.price, req.session.userId], () => {
                    db.run(`INSERT INTO inventory (user_id, catalog_id) VALUES (?, ?)`, [req.session.userId, itemId], () => {
                        
                        // FIX: Log the site's item.id instead of the Roblox asset_id
                        db.run(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Purchase', ?, ?)`, [req.session.userId, -item.price, item.id]);

                        if (item.item_type === 'Limited' || item.item_type === 'LimitedU') {
                            const newCopies = item.copies_left - 1;
                            if (newCopies <= 0) db.run(`DELETE FROM catalog WHERE id = ?`, [itemId]);
                            else db.run(`UPDATE catalog SET copies_left = ? WHERE id = ?`, [newCopies, itemId]);
                        }
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
    db.get(`SELECT c.category FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ? AND i.catalog_id = ?`, [req.session.userId, itemId], (err, item) => {
        if (!item) return res.status(404).json({ error: "Not in inventory" });
        if (equip) db.run(`UPDATE inventory SET is_wearing = 0 WHERE user_id = ? AND catalog_id IN (SELECT id FROM catalog WHERE category = ?)`, [req.session.userId, item.category]);
        db.run(`UPDATE inventory SET is_wearing = ? WHERE user_id = ? AND catalog_id = ?`, [equip ? 1 : 0, req.session.userId, itemId], () => res.json({ success: true }));
    });
});

app.post('/api/sell-item', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { itemId } = req.body;
    db.get(`SELECT * FROM catalog WHERE id = ?`, [itemId], (err, item) => {
        db.run(`DELETE FROM inventory WHERE user_id = ? AND catalog_id = ?`, [req.session.userId, itemId], function(err) {
            if (this.changes === 0) return res.status(400).json({ error: "You don't own this" });
            db.run(`UPDATE users SET robux = robux + ? WHERE id = ?`, [item.price, req.session.userId]);
            
            // FIX: Log the site's item.id here too
            db.run(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Sale', ?, ?)`, [req.session.userId, item.price, item.id]);

            if (item.item_type === 'Limited' || item.item_type === 'LimitedU') db.run(`UPDATE catalog SET copies_left = copies_left + 1 WHERE id = ?`, [itemId]);
            res.json({ success: true });
        });
    });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', (req, res) => { 
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" }); 
    db.all(`SELECT id, username, robux, tix, is_admin, can_upload FROM users`, (err, users) => res.json(users)); 
});

app.get('/api/admin/transactions/:id', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    db.all(`SELECT * FROM transactions WHERE user_id = ? ORDER BY timestamp DESC`, [req.params.id], (err, txs) => {
        res.json(txs || []);
    });
});

app.post('/api/admin/give-currency', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId, currency, amount } = req.body; 
    if (currency !== 'robux' && currency !== 'tix') return res.status(400).json({ error: "Invalid currency" });
    
    db.run(`UPDATE users SET ${currency} = ${currency} + ? WHERE id = ?`, [amount, userId], (err) => {
        if (err) return res.status(500).json({ error: "DB error" });
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
        db.run(`INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, copies_left, creator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [assetId, custom_name || detailsRes.data.Name, thumbRes.data.data[0].imageUrl, description || "No desc.", price, category, item_type, (item_type !== 'None' ? copies : 0), req.session.userId], () => res.json({ success: true }));
    } catch (error) { res.status(400).json({ error: "Invalid Asset ID" }); }
});

app.use((req, res, next) => { if (req.path.startsWith('/api') || req.path.endsWith('.html')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => console.log(`Moneyium running at http://localhost:${PORT}`));