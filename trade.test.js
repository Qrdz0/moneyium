'use strict';
import { describe, it, expect, beforeEach } from 'vitest';
const request = require('supertest');
const { app, resetDatabase, dbRun, dbGet } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(async () => { await resetDatabase(); });

async function seedItem(overrides = {}) {
  const item = {
    asset_id: '1', custom_name: 'X', asset_image: 'http://x', description: '',
    price: 10, category: 'Hats', item_type: 'None', total_copies: 1,
    copies_left: 1, creator_id: 1, ...overrides,
  };
  const { lastID } = await dbRun(
    `INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.asset_id, item.custom_name, item.asset_image, item.description, item.price,
     item.category, item.item_type, item.total_copies, item.copies_left, item.creator_id]
  );
  return lastID;
}

describe('trade flow', () => {
  it('sends a pending trade', async () => {
    const { agent: a, username: an } = await registerAndLogin(app);
    const { username: bn } = await registerAndLogin(app);
    const res = await a.post('/api/trade/send')
      .send({ receiverName: bn, senderItems: [], senderRobux: 5 });
    expect(res.status).toBe(200);
  });

  it('rejects trade to self', async () => {
    const { agent, username } = await registerAndLogin(app);
    const res = await agent.post('/api/trade/send')
      .send({ receiverName: username, senderItems: [], senderRobux: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects trade without owning items', async () => {
    const { agent: a } = await registerAndLogin(app);
    const { username: bn } = await registerAndLogin(app);
    const res = await a.post('/api/trade/send')
      .send({ receiverName: bn, senderItems: [9999], senderRobux: 0 });
    expect(res.status).toBe(400);
  });

  it('accept transfers items and robux', async () => {
    const itemId = await seedItem();
    const { agent: a, username: an } = await registerAndLogin(app);
    const { agent: b, username: bn } = await registerAndLogin(app);
    await a.post('/api/buy-item').send({ itemId });
    const send = await a.post('/api/trade/send')
      .send({ receiverName: bn, senderItems: [itemId], senderRobux: 5 });
    expect(send.status).toBe(200);
    const trade = await dbGet(`SELECT * FROM trades WHERE sender_id = (SELECT id FROM users WHERE username=?)`, [an]);
    const accept = await b.post('/api/trade/respond').send({ tradeId: trade.id, action: 'accept' });
    expect(accept.status).toBe(200);
    const inv = await dbGet(`SELECT * FROM inventory WHERE catalog_id = ?`, [itemId]);
    const bob = await dbGet(`SELECT id FROM users WHERE username = ?`, [bn]);
    expect(inv.user_id).toBe(bob.id);
  });

  it('rejects double-accept', async () => {
    const { agent: a, username: an } = await registerAndLogin(app);
    const { agent: b, username: bn } = await registerAndLogin(app);
    await a.post('/api/trade/send').send({ receiverName: bn, senderItems: [], senderRobux: 5 });
    const trade = await dbGet(`SELECT * FROM trades WHERE sender_id = (SELECT id FROM users WHERE username=?)`, [an]);
    const r1 = await b.post('/api/trade/respond').send({ tradeId: trade.id, action: 'accept' });
    const r2 = await b.post('/api/trade/respond').send({ tradeId: trade.id, action: 'accept' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(404);
  });

  it('rejects accept when sender sold the promised item first', async () => {
    const itemId = await seedItem({ price: 1 });
    const { agent: a, username: an } = await registerAndLogin(app);
    const { agent: b, username: bn } = await registerAndLogin(app);
    await a.post('/api/buy-item').send({ itemId });
    await a.post('/api/trade/send').send({ receiverName: bn, senderItems: [itemId], senderRobux: 0 });
    const trade = await dbGet(`SELECT * FROM trades WHERE sender_id = (SELECT id FROM users WHERE username=?)`, [an]);
    await a.post('/api/sell-item').send({ itemId });
    const res = await b.post('/api/trade/respond').send({ tradeId: trade.id, action: 'accept' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer owns/i);
  });

  it('declines a trade', async () => {
    const { agent: a, username: an } = await registerAndLogin(app);
    const { agent: b, username: bn } = await registerAndLogin(app);
    await a.post('/api/trade/send').send({ receiverName: bn, senderItems: [], senderRobux: 5 });
    const trade = await dbGet(`SELECT * FROM trades WHERE sender_id = (SELECT id FROM users WHERE username=?)`, [an]);
    const res = await b.post('/api/trade/respond').send({ tradeId: trade.id, action: 'decline' });
    expect(res.status).toBe(200);
    const t = await dbGet(`SELECT status FROM trades WHERE id = ?`, [trade.id]);
    expect(t.status).toBe('declined');
  });
});