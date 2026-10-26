# Moneyium — Custom Roblox Revival Platform

![Status](https://img.shields.io/badge/Status-In%20Development-brightgreen)
![Tech](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%20%7C%20SQLite-blue)
![Frontend](https://img.shields.io/badge/Frontend-Vanilla%20JS-orange)
![Purpose](https://img.shields.io/badge/Purpose-Educational%20Sandbox-lightgrey)

Moneyium is a from-scratch Roblox revival platform built for educational purposes. It explores how revival sites handle authentication, virtual economies, serialized limited items, trading, profiles, and Roblox API integrations without relying on leaked source code.

The platform is a collaboration between a human developer (money) and AI: the human provides the vision, architecture, and debugging, while the AI acts as co-developer.

> Moneyium is an independent educational project and is not affiliated with Roblox Corporation.

## What's New

### Social Home Feed
- Two-column home layout with the feed on the left and a sidebar on the right.
- Status composer with a 280-character limit, live counter, and instant local posting.
- Like buttons that update instantly.
- Mock community posts with item and milestone attachments.
- Sidebar cards for **Events**, **Friends**, and the **Hexium Blog**.

### Classic Profile Rebuild
- Blocky, classic Hexium/Roblox-inspired profile layout.
- Circular avatar, gold username, blue verified badge, and italic status line.
- Four stat columns: **Friends**, **Followers**, **Following**, and **RAP**.
- **About** and **Creations** tabs with a white active underline.
- About panel with white bio text, Discord/GitHub icons, and an editable bio for your own profile.
- **Currently Wearing** showcase with a 3D avatar placeholder and a three-column equipment grid.
- Real equipped inventory items, serial numbers, and green **LIMITED** / **LIMITED U** tags.
- Graceful fallback when an item thumbnail fails to load.

### Site-Wide Classic Theme
- Sharp `0px` corners across cards and containers.
- Dark cloudy gradient background.
- Gold headings and links with dark-brown translucent panels.
- Responsive layouts for desktop, tablet, and mobile.

## Core Features

### Accounts & Profiles
- Secure registration and login with `bcrypt` password hashing.
- Session-based authentication via `express-session`.
- Editable profile bio and real RAP totals.
- Verified badge support.
- Classic profile pages with equipped-item displays.
- The first registered real account automatically becomes an admin and uploader.

### Economy & Catalog
- Robux and Tix balances stored in SQLite.
- New users start with 100 Robux.
- Admins upload items using a Roblox Asset ID; the backend fetches item metadata and thumbnails with `axios`.
- Category filtering for Hats, Faces, Gears, Hair, Shirts, Pants, and Packages.
- Items can be free, limited, or unlimited.
- Sold-out items remain on the site forever with their original price and owner history.
- Users can resell owned items back to the catalog.

### Serialized Limiteds
- Every limited item receives realistic serial numbers.
- A system account named `ROBLOX` permanently owns serial `#1` of every item.
- Player copies are numbered after the system copy.
- Item detail pages show every owner, serial number, purchase date, and verification badge.

### Avatar & Inventory
- Inventory page with category filters.
- 2D paper-doll avatar editor.
- Equip and unequip items across categories.
- Worn items are reflected on the profile's **Currently Wearing** grid.

### Games
- Admins can upload games with a name, description, thumbnail, and `.rbxl` link.
- Public `/games` page with game cards and visit counts.

### Trading
- Backend trading APIs support sending, listing, accepting, and declining trades.
- Trades can swap inventory items and Robux.
- The front-end trade screens are the next integration step.

### Admin Dashboard
- Separate admin panel at `/admin.html`.
- User management, currency grants, and permission toggles.
- Transaction history viewer.
- Catalog management and item uploads.
- Game uploads.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js, Express |
| Database | SQLite3 |
| Auth | bcrypt, express-session |
| Roblox API | axios |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Icons | FontAwesome 6 |

## Project Structure

```text
moneyium/
├── public/
│   ├── index.html      # SPA: home, catalog, profile, inventory, avatar, games
│   └── admin.html      # Admin dashboard
├── server.js           # Express server, database setup, and API routes
├── database.db         # Created at runtime (gitignored)
├── package.json
└── README.md
```

## Getting Started

### Requirements
- [Node.js](https://nodejs.org/) 18 or newer
- npm

### Install and Run

```bash
git clone https://github.com/Qrdz0/moneyium.git
cd moneyium
npm install
node server.js
```

Open **http://localhost:3000**.

The server listens on port `3000`. The SQLite database and the free ROBLOX baseball cap are created automatically on first launch.

### First Account
- Register a new account after starting the server.
- The first real account registered becomes an admin and uploader automatically.
- The admin panel is available at **http://localhost:3000/admin.html**.
- The system account is named `ROBLOX`; its development password is defined in `server.js`. Change it before sharing or deploying the project.

### Reset Local Data
Stop the server, delete `database.db`, and run `node server.js` again. The database and starter catalog item will be recreated.

## Main Routes

| Route | Description |
| --- | --- |
| `/` | Social home feed |
| `/catalog` | Item catalog |
| `/catalog/:id/:slug` | Item detail and owner history |
| `/users/:id/profile` | Classic profile page |
| `/users/:id/inventory` | Inventory |
| `/users/:id/avatar` | Avatar editor |
| `/games` | Public games page |
| `/admin.html` | Admin dashboard |

## API Overview

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/register`, `POST /api/login`, `POST /api/logout` |
| Users | `GET /api/user`, `GET /api/user/:id`, `POST /api/update-bio` |
| Catalog | `GET /api/catalog`, `GET /api/catalog/:id`, `POST /api/buy-item`, `POST /api/sell-item`, `POST /api/equip-item` |
| Games | `GET /api/games`, `POST /api/admin/upload-game` |
| Trading | `POST /api/trade/send`, `GET /api/trade/pending`, `POST /api/trade/respond` |
| Admin | `GET /api/admin/users`, `GET /api/admin/catalog`, `GET /api/admin/transactions/:id`, `POST /api/admin/give-currency`, `POST /api/admin/toggle-perm`, `POST /api/admin/upload-item` |

## Current Limitations

- Home feed posts, events, friends, and blog content are front-end mocks. Posts reset on refresh and are not stored in the database yet.
- Friends, Followers, and Following counters are placeholders until social graph tables are added.
- The profile's 3D avatar render is a styled placeholder; the avatar editor uses the existing 2D paper-doll renderer.
- Trading is implemented in the backend, but the public trade UI is still being connected.
- Session secrets and the development system password are currently hardcoded. Move them to environment variables before any public deployment.
- There is no automated test suite yet.

## Educational Disclaimer

Moneyium is a learning project. Do not use Roblox assets, names, or content in ways that violate Roblox's terms or intellectual property rights. Use the project responsibly and only with content you have permission to use.
