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
            db.run(`CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT, custom_name TEXT, asset_image TEXT, description TEXT, price INTEGER DEFAULT 10, category TEXT DEFAULT 'Hats', item_type TEXT DEFAULT 'None', total_copies INTEGER DEFAULT 1, copies_left INTEGER DEFAULT 1, creator_id INTEGER)`);
            db.run(`CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, catalog_id INTEGER, serial_number INTEGER DEFAULT 0, is_wearing INTEGER DEFAULT 0, FOREIGN KEY(user_id) REFERENCES users(id))`);
            db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, amount INTEGER, site_item_id TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
            
            // CREATE SYSTEM ACCOUNT
            db.get(`SELECT id FROM users WHERE username = 'ROBLOX'`, (err, row) => {
                if (!row) {
                    const sysPass = bcrypt.hashSync('system_dummy_pass_123', 10);
                    db.run(`INSERT INTO users (username, password, is_admin, can_upload, bio) VALUES ('ROBLOX', ?, 0, 0, 'Official system account.')`, [sysPass], resolve);
                } else {
                    resolve();
                }
            });
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
        // If it's literally the first user (besides ROBLOX), make them admin
        const isFirstUser = row.count <= 1 ? 1 : 0;
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
        db.all(`SELECT c.*, i.is_wearing, i.serial_number FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            res.json({ user, inventory: inventory || [] });
        });
    });
});

app.get('/api/user/:id', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });
        db.all(`SELECT c.*, i.is_wearing, i.serial_number FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            res.json({ user, inventory: inventory || [] });
        });
    });
});

app.get('/api/catalog', (req, res) => {
    db.all(`SELECT * FROM catalog`, (err, catalog) => { res.json(catalog || []); });
});

app.get('/api/catalog/:id', (req, res) => {
    db.get(`SELECT * FROM catalog WHERE id = ?`, [req.params.id], (err, item) => {
        if (!item) return res.status(404).json({ error: "Item not found" });
        db.all(`SELECT u.username, i.serial_number FROM inventory i JOIN users u ON i.user_id = u.id WHERE i.catalog_id = ? ORDER BY i.serial_number ASC`, [item.id], (err, owners) => {
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
        db.get(`SELECT * FROM catalog WHERE id = ?`, [itemId], (err, item) => {
            if (!item) return res.status(404).json({ error: "Item not found" });
            if (item.copies_left <= 0) return res.status(400).json({ error: "This item is sold out!" });
            if (user.robux < item.price) return res.status(400).json({ error: "Not enough Robux!" });
            
            db.get(`SELECT id FROM inventory WHERE user_id = ? AND catalog_id = ?`, [req.session.userId, itemId], (err, owned) => {
                if (owned && item.item_type !== 'None') return res.status(400).json({ error: "You already own this item!" });
                
                let serialNumber = 0;
                if (item.item_type === 'Limited' || item.item_type === 'LimitedU') {
                    serialNumber = item.total_copies - item.copies_left + 1;
                }

                db.run(`UPDATE users SET robux = robux - ?, rap = rap + ? WHERE id = ?`, [item.price, item.price, req.session.userId], () => {
                    db.run(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, ?)`, [req.session.userId, itemId, serialNumber], () => {
                        
                        const newCopies = item.copies_left - 1;
                        db.run(`UPDATE catalog SET copies_left = ? WHERE id = ?`, [newCopies, itemId]);
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
            db.run(`INSERT INTO transactions (user_id, type, amount, site_item_id) VALUES (?, 'Sale', ?, ?)`, [req.session.userId, item.price, item.id]);

            if (item.item_type === 'Limited' || item.item_type === 'LimitedU') {
                db.run(`UPDATE catalog SET copies_left = copies_left + 1 WHERE id = ?`, [itemId]);
            }
            res.json({ success: true });
        });
    });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', (req, res) => { 
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" }); 
    db.all(`SELECT id, username, robux, tix, is_admin, can_upload FROM users`, (err, users) => res.json(users)); 
});
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
        
        // If limited, user gets X copies + 1 for ROBLOX.
        const userCopies = (item_type !== 'None') ? parseInt(copies) : 1;
        const totalCopies = userCopies + 1; 

        db.run(`INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
            [assetId, custom_name || detailsRes.data.Name, thumbRes.data.data[0].imageUrl, description || "No desc.", price, category, item_type, totalCopies, userCopies, req.session.userId], 
            function(err) {
                if (err) return res.status(500).json({ error: "DB Error" });
                const newItemId = this.lastID;
                
                // Give the #1 copy to ROBLOX
                db.get(`SELECT id FROM users WHERE username = 'ROBLOX'`, (err, sysUser) => {
                    if (sysUser) {
                        db.run(`INSERT INTO inventory (user_id, catalog_id, serial_number) VALUES (?, ?, 1)`, [sysUser.id, newItemId]);
                    }
                    res.json({ success: true });
                });
            }
        );
    } catch (error) { res.status(400).json({ error: "Invalid Asset ID" }); }
});

app.use((req, res, next) => { if (req.path.startsWith('/api') || req.path.endsWith('.html')) return next(); res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => console.log(`Moneyium running at http://localhost:${PORT}`));