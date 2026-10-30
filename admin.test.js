'use strict';
import { describe, it, expect, beforeEach } from 'vitest';
const request = require('supertest');
const { app, resetDatabase, dbGet } = require('./helpers/db');
const { registerAndLogin, registerAdmin } = require('./helpers/auth');

beforeEach(async () => { await resetDatabase(); });

describe('admin permissions', () => {
  it('blocks non-admin from /api/admin/users', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('blocks anonymous from /api/admin/users', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('allows admin to list users', async () => {
    const { agent } = await registerAdmin(app);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('admin can give currency', async () => {
    const { agent } = await registerAdmin(app);
    const { username } = await registerAndLogin(app);
    const u = await dbGet(`SELECT id, robux FROM users WHERE username = ?`, [username]);
    const res = await agent.post('/api/admin/give-currency')
      .send({ userId: u.id, currency: 'robux', amount: 500 });
    expect(res.status).toBe(200);
    const after = await dbGet(`SELECT robux FROM users WHERE id = ?`, [u.id]);
    expect(after.robux).toBe(u.robux + 500);
  });

  it('rejects SQL injection in currency field', async () => {
    const { agent } = await registerAdmin(app);
    const { username } = await registerAndLogin(app);
    const u = await dbGet(`SELECT id FROM users WHERE username = ?`, [username]);
    const res = await agent.post('/api/admin/give-currency')
      .send({ userId: u.id, currency: 'robux = 999999, is_admin', amount: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects SQL injection in perm field', async () => {
    const { agent } = await registerAdmin(app);
    const { username } = await registerAndLogin(app);
    const u = await dbGet(`SELECT id FROM users WHERE username = ?`, [username]);
    const res = await agent.post('/api/admin/toggle-perm')
      .send({ userId: u.id, perm: 'is_admin = 1, can_upload' });
    expect(res.status).toBe(400);
  });

  it('blocks admin from demoting self', async () => {
    const { agent, id } = await registerAdmin(app);
    const res = await agent.post('/api/admin/toggle-perm')
      .send({ userId: id, perm: 'is_admin' });
    expect(res.status).toBe(400);
  });
});