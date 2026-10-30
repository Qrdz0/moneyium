'use strict';
import { describe, it, expect, beforeEach } from 'vitest';
const request = require('supertest');
const { app, resetDatabase, dbGet, dbAll } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(async () => { await resetDatabase(); });

describe('follows', () => {
  it('follows another user and appears in their followers', async () => {
    const { agent: a } = await registerAndLogin(app);
    const { username: bn } = await registerAndLogin(app);
    const bUser = await dbGet(`SELECT id FROM users WHERE username = ?`, [bn]);
    const res = await a.post(`/api/follow/${bUser.id}`);
    expect(res.status).toBe(200);
    const followers = await a.get(`/api/user/${bUser.id}/followers`);
    expect(followers.body.length).toBe(1);
  });

  it('rejects following yourself', async () => {
    const { agent, username } = await registerAndLogin(app);
    const me = await dbGet(`SELECT id FROM users WHERE username = ?`, [username]);
    const res = await agent.post(`/api/follow/${me.id}`);
    expect(res.status).toBe(400);
  });

  it('rejects duplicate follow', async () => {
    const { agent: a } = await registerAndLogin(app);
    const { username: bn } = await registerAndLogin(app);
    const bUser = await dbGet(`SELECT id FROM users WHERE username = ?`, [bn]);
    await a.post(`/api/follow/${bUser.id}`);
    const res = await a.post(`/api/follow/${bUser.id}`);
    expect(res.status).toBe(400);
  });
});

describe('friends', () => {
  it('sends and accepts a friend request', async () => {
    const { agent: a, username: an } = await registerAndLogin(app);
    const { agent: b, username: bn } = await registerAndLogin(app);
    const bUser = await dbGet(`SELECT id FROM users WHERE username = ?`, [bn]);
    const req1 = await a.post(`/api/friend/request/${bUser.id}`);
    expect(req1.status).toBe(200);
    const reqRow = await dbGet(`SELECT id FROM friend_requests WHERE status = 'pending'`);
    const accept = await b.post(`/api/friend/accept/${reqRow.id}`);
    expect(accept.status).toBe(200);
    const friends = await b.get(`/api/user/${(await dbGet(`SELECT id FROM users WHERE username=?`, [an])).id}/friends`);
    expect(friends.body.length).toBe(1);
  });
});

describe('posts', () => {
  it('creates a post and appears in feed', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/posts').send({ body: 'Hello world' });
    expect(res.status).toBe(200);
    const feed = await agent.get('/api/feed');
    expect(feed.body.posts[0].body).toBe('Hello world');
  });

  it('rejects empty post', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/posts').send({ body: '' });
    expect(res.status).toBe(400);
  });

  it('rejects post over 280 chars', async () => {
    const { agent } = await registerAndLogin(app);
    const res = await agent.post('/api/posts').send({ body: 'a'.repeat(281) });
    expect(res.status).toBe(400);
  });

  it('likes and unlikes a post', async () => {
    const { agent } = await registerAndLogin(app);
    await agent.post('/api/posts').send({ body: 'Like me' });
    const post = await dbGet(`SELECT id FROM posts LIMIT 1`);
    const like = await agent.post(`/api/posts/${post.id}/like`);
    expect(like.status).toBe(200);
    const unlike = await agent.delete(`/api/posts/${post.id}/like`);
    expect(unlike.status).toBe(200);
  });

  it('soft-deletes a post', async () => {
    const { agent } = await registerAndLogin(app);
    await agent.post('/api/posts').send({ body: 'Delete me' });
    const post = await dbGet(`SELECT id FROM posts LIMIT 1`);
    const del = await agent.delete(`/api/posts/${post.id}`);
    expect(del.status).toBe(200);
    const still = await dbGet(`SELECT deleted_at FROM posts WHERE id = ?`, [post.id]);
    expect(still.deleted_at).toBeTruthy();
  });
});