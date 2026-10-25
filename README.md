# Moneyium - Custom Roblox Revival Engine

![Status](https://img.shields.io/badge/Status-In%20Development-brightgreen)
![Tech](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%20%7C%20SQLite-blue)
![Purpose](https://img.shields.io/badge/Purpose-Educational%20Sandbox-orange)

A fully custom, from-scratch Roblox revival platform built for educational purposes. 

This project was created to understand the underlying backend architecture of revival sites (like Pekora or Hexium). Instead of using leaked source code, this engine is built entirely from scratch using Node.js and SQLite to learn how authentication, economies, and Roblox API integrations actually work under the hood.

## Features

- **Secure Authentication:** Password hashing using `bcrypt` and session management via `express-session`.
- **Dynamic Economy:** Users hold Robux and Tix balances stored securely in the database.
- **Roblox API Integration:** Upload items by simply pasting a Roblox Asset ID. The backend automatically fetches the item's name and thumbnail from Roblox's official APIs using `axios`.
- **Advanced Serial Numbers:** Realistic item copies. The system creates a hidden `ROBLOX` account that permanently holds the true `#1` serial number of every limited item, while players get the remaining copies.
- **Permanent Catalog:** Sold-out items stay on the site forever, showing their original price and the usernames of every player who owns a serial number.
- **Secondary Market (Reselling):** Users can sell items back to the catalog for Robux, returning the copy to the store for others to buy.
- **Avatar Editor:** A fully functional avatar editor allowing users to equip and unequip items across different categories (Hats, Shirts, etc.).
- **Custom Profiles:** Users can edit their profile bio and view their total RAP (Recent Average Price).
- **Admin Dashboard:** A fully stylized control panel with role-based permissions (Admin, Uploader) to manage users, give Robux/Tix, upload items, and view live transaction logs.
- **Dynamic Routing:** SPA-style routing (`/:uid/profile`, `/catalog/:id/:name`) for a seamless user experience without page reloads.

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite3
- **Frontend:** Vanilla HTML, CSS, JavaScript (FontAwesome)
- **Libraries:** `bcrypt`, `express-session`, `axios`

## How to Run Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/Qrdz0/moneyium.git
   cd moneyium
