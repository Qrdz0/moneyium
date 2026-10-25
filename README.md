# Moneyium - Custom Roblox Revival Engine

![Status](https://img.shields.io/badge/Status-In%20Development-brightgreen)
![Tech](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%20%7C%20SQLite-blue)
![Purpose](https://img.shields.io/badge/Purpose-Educational%20Sandbox-orange)

A fully custom, from-scratch Roblox revival platform built for educational purposes. 

This project was created to understand the underlying backend architecture of revival sites (like Pekora or Hexium). Instead of using leaked source code, this engine is built entirely from scratch using Node.js and SQLite to learn how authentication, economies, and Roblox API integrations actually work under the hood.

## Features

- **Secure Authentication:** Password hashing using `bcrypt` and session management via `express-session`.
- **Economy System:** Users start with a set amount of Robux and Tix stored in an SQLite database.
- **Roblox API Integration:** Upload items to the catalog by simply pasting a Roblox Asset ID. The backend automatically fetches the item's name and thumbnail from Roblox's official APIs using `axios`.
- **Admin Panel:** A dedicated management dashboard with role-based permissions (Admin, Uploader).
- **Catalog & Inventory:** Users can buy items from the catalog, which deducts their Robux and moves the item to their inventory. Limited items are removed from the store after purchase.
- **Dynamic Routing:** SPA-style routing (`/:uid/profile`) for a seamless user experience without page reloads.
- **Custom UI:** A dark-mode, Hexium-inspired user interface with a sidebar, profile cards, and red top banner.

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite3
- **Frontend:** Vanilla HTML, CSS, JavaScript
- **Libraries:** `bcrypt`, `express-session`, `axios`
- **Icons:** FontAwesome

## How to Run Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/Qrdz0/moneyium.git
   cd moneyium
