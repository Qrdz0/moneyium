'use strict';
import { describe, it, expect, beforeEach } from 'vitest';
const request = require('supertest');
const { app, resetDatabase, dbRun, dbGet } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(async () => { await resetDatabase(); });

async function seedItem(overrides = {}) {
  const item = {
    asset_id: '123', custom_name: 'Test Hat', asset_image: 'http://x/img.png',
    description: 'test', price: 50, category: 'Hats', item_type: 'None',
    total_copies: 1, copies_left: 1, creator_id: 1, ...overrides,
  };
  const { lastID } = await dbRun(
    `INSERT INTO catalog (asset_id, custom_name, asset_image, description, price, category, item_type, total_copies, copies_left, creator_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.asset_id, item.custom_name, item.asset_image, item.description, item.price,
     item.category, item.item_type, item.total_copies, item.copies_left, item.creator_id]
  );
  return lastID;
}

describe('buy-item', () => {
  it('deducts robux and adds item to inventory', async () => {
    const itemId = await seedItem();
    const { agent } = await registerAndLogin(app);
    const before = (await agent.get('/api/user')).body.user.robux;
    const res = await agent.post('/api/buy-item').send({ itemId });
    expect(res.status).toBe(200);
    const after = (await agent.get('/api/user')).body.user;
    expect(after.robux).toBe(before - 50);
    expect(after.id).toBeDefined();
    const inv = await dbGet(`SELECT * FROM inventory WHERE catalog_id = ?`, [itemId]);
    expect(inv).toBeTruthy();
  });

  it('rejects when funds are insufficient', async () => {
    const itemId = await seedItem({ price: 10000 });
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/buy-item').send({ itemId });
    expect(res.status).toBe(400);
  });

  it('rejects when sold out', async () => {
    const itemId = await seedItem({ copies_left: 0 });
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/buy-item').send({ itemId });
    expect(res.status).toBe(400);
  });

  it('prevents duplicate purchase of limited item (race)', async () => {
    const itemId = await seedItem({ item_type: 'Limited', total_copies: 2, copies_left: 1, price: 10 });
    const { agent } = await registerAndLogin(app);
    const results = await Promise.all([
      agent.post('/api/buy-item').send({ itemId }),
      agent.post('/api/buy-item').send({ itemId }),
      agent.post('/api/buy-item').send({ itemId }),
    ]);
    const ok = results.filter(r => r.status === 200).length;
    expect(ok).toBe(1);
    const invs = await dbGet(`SELECT COUNT(*) as n FROM inventory WHERE catalog_id = ?`, [itemId]);
    expect(invs.n).toBe(1);
  });
});

describe('sell-item', () => {
  it('credits robux and removes item', async () => {
    const itemId = await seedItem({ price: 30 });
    const { agent } = await registerAndLogin(app);
    await agent.post('/api/buy-item').send({ itemId });
    const before = (await agent.get('/api/user')).body.user.robux;
    const res = await agent.post('/api/sell-item').send({ itemId });
    expect(res.status).toBe(200);
    const after = (await agent.get('/api/user')).body.user;
    expect(after.robux).toBe(before + 30);
  });

  it('rejects sale of unowned item', async () => {
    const itemId = await seedItem();
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/sell-item').send({ itemId });
    expect(res.status).toBe(400);
  });

  it('prevents double-sale (race)', async () => {
    const itemId = await seedItem({ price: 100 });
    const { agent } = await registerAndLogin(app);
    await agent.post('/api/buy-item').send({ itemId });
    const results = await Promise.all([
      agent.post('/api/sell-item').send({ itemId }),
      agent.post('/api/sell-item').send({ itemId }),
    ]);
    expect(results.filter(r => r.status === 200).length).toBe(1);
  });
});

describe('equip-item', () => {
  it('equips and unequips an owned item', async () => {
    const itemId = await seedItem({ category: 'Hats' });
    const { agent } = await registerAndLogin(app);
    await agent.post('/api/buy-item').send({ itemId });
    await agent.post('/api/equip-item').send({ itemId, equip: 1 });
    let row = await dbGet(`SELECT is_wearing FROM inventory WHERE catalog_id = ?`, [itemId]);
    expect(row.is_wearing).toBe(1);
    await agent.post('/api/equip-item').send({ itemId, equip: 0 });
    row = await dbGet(`SELECT is_wearing FROM inventory WHERE catalog_id = ?`, [itemId]);
    expect(row.is_wearing).toBe(0);
  });

  it('unequips same-category items when equipping', async () => {
    const a = await seedItem({ category: 'Hats', asset_id: 'A' });
    const b = await seedItem({ category: 'Hats', asset_id: 'B' });
    const { agent } = await registerAndLogin(app);
    await agent.post('/api/buy-item').send({ itemId: a });
    await agent.post('/api/buy-item').send({ itemId: b });
    await agent.post('/api/equip-item').send({ itemId: a, equip: 1 });
    await agent.post('/api/equip-item').send({ itemId: b, equip: 1 });
    const ra = await dbGet(`SELECT is_wearing FROM inventory WHERE catalog_id = ?`, [a]);
    const rb = await dbGet(`SELECT is_wearing FROM inventory WHERE catalog_id = ?`, [b]);
    expect(ra.is_wearing).toBe(0);
    expect(rb.is_wearing).toBe(1);
  });

  it('rejects equipping an unowned item', async () => {
    const itemId = await seedItem();
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/equip-item').send({ itemId, equip: 1 });
    expect(res.status).toBe(404);
  });
});