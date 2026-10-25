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

// FIX: Added path: '/' to fix the logout issue
app.use(session({
    secret: 'moneyium_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        path: '/' 
    }
}));

const db = new sqlite3.Database('./database.db');

function setupDatabase() {
    return new Promise((resolve) => {
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                robux INTEGER DEFAULT 100,
                tix INTEGER DEFAULT 0,
                is_admin INTEGER DEFAULT 0,
                can_upload INTEGER DEFAULT 0,
                bio TEXT DEFAULT 'Welcome to my profile!',
                rap INTEGER DEFAULT 0
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS catalog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_id TEXT,
                asset_name TEXT,
                asset_image TEXT,
                price INTEGER DEFAULT 10,
                is_limited INTEGER DEFAULT 0,
                creator_id INTEGER
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                catalog_id INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )`, resolve);
        });
    });
}
setupDatabase();

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
    let { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Please fill in all fields" });
    if (username.includes(' ')) return res.status(400).json({ error: "No spaces allowed" });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    db.get(`SELECT COUNT(*) as count FROM users`, [], async (err, row) => {
        const isFirstUser = row.count === 0 ? 1 : 0;
        db.run(`INSERT INTO users (username, password, is_admin, can_upload) VALUES (?, ?, ?, ?)`, 
            [username, hashedPassword, isFirstUser, isFirstUser], 
            function(err) {
                if (err) return res.status(400).json({ error: "Username taken" });
                res.json({ success: true });
            }
        );
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user) return res.status(400).json({ error: "User not found" });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ error: "Wrong password" });

        req.session.userId = user.id;
        req.session.isAdmin = user.is_admin;
        res.json({ success: true });
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// --- USER DATA ---
app.get('/api/user', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });
        db.all(`SELECT c.* FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            db.all(`SELECT * FROM catalog`, (err, catalog) => {
                res.json({ user, inventory: inventory || [], catalog: catalog || [] });
            });
        });
    });
});

// FIX: Get ANY user by ID for the /:uid/profile route
app.get('/api/user/:id', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    db.get(`SELECT id, username, robux, tix, is_admin, can_upload, bio, rap FROM users WHERE id = ?`, [req.params.id], (err, user) => {
        if (!user) return res.status(404).json({ error: "User not found" });
        db.all(`SELECT c.* FROM inventory i JOIN catalog c ON i.catalog_id = c.id WHERE i.user_id = ?`, [user.id], (err, inventory) => {
            res.json({ user, inventory: inventory || [] });
        });
    });
});

app.post('/api/buy-item', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
    const { itemId } = req.body;
    db.get(`SELECT robux FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        db.get(`SELECT price, is_limited FROM catalog WHERE id = ?`, [itemId], (err, item) => {
            if (user.robux < item.price) return res.status(400).json({ error: "Not enough Robux!" });
            db.run(`UPDATE users SET robux = robux - ?, rap = rap + ? WHERE id = ?`, [item.price, item.price, req.session.userId], (err) => {
                db.run(`INSERT INTO inventory (user_id, catalog_id) VALUES (?, ?)`, [req.session.userId, itemId], (err) => {
                    if (item.is_limited) db.run(`DELETE FROM catalog WHERE id = ?`, [itemId]);
                    res.json({ success: true });
                });
            });
        });
    });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    db.all(`SELECT id, username, robux, tix, is_admin, can_upload FROM users`, (err, users) => {
        res.json(users);
    });
});

app.post('/api/admin/toggle-perm', (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { userId, perm } = req.body; 
    db.run(`UPDATE users SET ${perm} = NOT ${perm} WHERE id = ?`, [userId], function(err) {
        res.json({ success: true });
    });
});

app.post('/api/admin/upload-item', async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).json({ error: "Admin only" });
    const { assetId, price, isLimited } = req.body;
    try {
        const detailsRes = await axios.get(`https://economy.roblox.com/v2/assets/${assetId}/details`);
        const thumbRes = await axios.get(`https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`);
        db.run(`INSERT INTO catalog (asset_id, asset_name, asset_image, price, is_limited, creator_id) VALUES (?, ?, ?, ?, ?, ?)`, 
            [assetId, detailsRes.data.Name, thumbRes.data.data[0].imageUrl, price, isLimited ? 1 : 0, req.session.userId], 
            function(err) {
                res.json({ success: true });
            }
        );
    } catch (error) {
        res.status(400).json({ error: "Invalid Asset ID" });
    }
});

// FIX: Redirect to index.html for ALL frontend routes (SPA)
app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.endsWith('.html')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Moneyium running at http://localhost:${PORT}`));