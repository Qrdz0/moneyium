# Moneyium — Custom Roblox Revival Platform

![Status](https://img.shields.io/badge/Status-In%20Development-brightgreen)
![Tech](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%20%7C%20SQLite-blue)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-orange)
![Purpose](https://img.shields.io/badge/Purpose-Educational%20Sandbox-lightgrey)
![Security](https://img.shields.io/badge/Security-Hardened-success)
![Testing](https://img.shields.io/badge/Tests-Vitest%20%2B%20Supertest-yellow)

Moneyium is a from-scratch Roblox revival platform built for educational purposes. It explores how revival sites handle authentication, virtual economies, serialized limited items, trading, profiles, and Roblox API integrations without relying on leaked source code.

The platform is a collaboration between a human developer (money) and AI: the human provides the vision, architecture, and debugging, while the AI acts as co-developer.

> Moneyium is an independent educational project and is not affiliated with Roblox Corporation.

## What's New (Latest Update)

### Security Hardening & Economy Protection
- **Environment Variables:** `SESSION_SECRET` and `ROBLOX_SYSTEM_PASSWORD` are now securely loaded via `.env`.
- **SQL Injection Prevention:** Admin routes dynamically validate column names (e.g., `robux`, `tix`) before executing.
- **Anti-Dupe Transactions:** Economy endpoints (`buy-item`, `sell-item`, `trade/respond`) use `BEGIN IMMEDIATE` database locks to physically prevent race-condition duping.
- **Rate Limiting & Headers:** Added `helmet` and `express-rate-limit` to protect against brute-force and DDoS.
- **CSRF Guard:** All state-changing requests require `Content-Type: application/json`.

### Automated Test Suite (Vitest + Supertest)
- Full backend test suite covering Auth, Economy, Trades, Admin, and Social features.
- Tests run against an **in-memory SQLite database** (`:memory:`) so your real database is never touched.
- Includes adversarial tests (e.g., double-accepting a trade, spamming buy on a limited item).

### Real Social Graph & Feed
- Replaced front-end mocks with real SQLite tables: `follows`, `friend_requests`, `friendships`, `posts`, and `post_likes`.
- **Home Feed:** Real 280-character post composer with working likes and soft-deletes.
- **Profiles:** Real Friends, Followers, and Following counters, plus functional Follow and Add Friend buttons.

### Complete Trading UI
- The trade modal is now fully connected to the backend.
- Support for offering both **Items** and **Robux**.
- Two-way trades (requesting items/Robux from the receiver) are supported.

### Debugging Tools
- Added `DEBUG=1` request logging that outputs timings and auth context to the console.
- New admin-only endpoint: `GET /api/debug/health` to check uptime, memory, and DB table row counts.

## Core Features

### Accounts & Profiles
- Secure registration and login with `bcrypt` password hashing (configurable cost).
- Session-based authentication with secure, HttpOnly cookies.
- Editable profile bio and real RAP totals.
- Classic profile pages with equipped-item displays and social counters.

### Economy & Catalog
- Robux and Tix balances stored in SQLite.
- New users start with 100 Robux.
- Admins upload items using a Roblox Asset ID; the backend fetches metadata and thumbnails via `axios`.
- Items can be free, limited, or unlimited.
- Users can resell owned items back to the catalog.

### Serialized Limiteds
- Every limited item receives realistic serial numbers.
- A system account named `ROBLOX` permanently owns serial `#1` of every item.
- Item detail pages show every owner, serial number, purchase date, and verification badge.

### Games
- Admins can upload games with a name, description, thumbnail, and `.rbxl` link.
- Public `/games` page with game cards and visit counts.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js, Express |
| Database | SQLite3 |
| Auth | bcrypt, express-session |
| Security | helmet, express-rate-limit, custom CSRF guard |
| Testing | Vitest, Supertest |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Icons | FontAwesome 6 |

## Project Structure

```text
moneyium/
├── public/
│   ├── index.html      # SPA: home, catalog, profile, inventory, avatar, games
│   └── admin.html      # Admin dashboard
├── lib/
│   └── logger.js       # Custom debug logger
├── test/
│   ├── helpers/        # DB and Auth test utilities
│   ├── auth.test.js
│   ├── economy.test.js
│   ├── trade.test.js
│   ├── admin.test.js
│   └── social.test.js
├── server.js           # Express server, database setup, and API routes
├── vitest.config.js    # Test runner config
├── database.db         # Created at runtime (gitignored)
├── .env                # Local environment variables (gitignored)
├── package.json
└── README.md
