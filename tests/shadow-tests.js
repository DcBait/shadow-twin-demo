/**
 * SHADOW TWIN TEST SUITE
 */

const { createDB } = require('../src/database');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
const SHADOW_DB = process.env.DB_NAME || 'shadow.sqlite';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     └─ ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJSON(urlPath, options = {}) {
  // node-fetch v2 uses CommonJS require
  const fetch = require('node-fetch');
  const res = await fetch(`${BASE_URL}${urlPath}`, options);
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body };
}

function getToken() {
  try {
    const tokenFile = path.join(process.cwd(), 'demo-token.txt');
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    const db = createDB(SHADOW_DB);
    const session = db.prepare(
      `SELECT token FROM sessions WHERE expires_at > datetime('now') LIMIT 1`
    ).get();
    return session?.token || '';
  }
}

// ─── TEST GROUP 1: Schema Integrity ──────────────────────────────────────────
async function testSchemaIntegrity() {
  console.log('\n📋 Test Group 1: Schema Integrity');

  await test('users table exists with correct columns', () => {
    const db = createDB(SHADOW_DB);
    const cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    assert(cols.includes('id'), 'Missing: id');
    assert(cols.includes('name'), 'Missing: name');
    assert(cols.includes('email'), 'Missing: email');
    assert(cols.includes('role'), 'Missing: role');
  });

  await test('orders table exists with correct columns', () => {
    const db = createDB(SHADOW_DB);
    const cols = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
    assert(cols.includes('user_id'), 'Missing: user_id');
    assert(cols.includes('product'), 'Missing: product');
    assert(cols.includes('amount'), 'Missing: amount');
  });

  await test('sessions table exists with correct columns', () => {
    const db = createDB(SHADOW_DB);
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all().map(c => c.name);
    assert(cols.includes('token'), 'Missing: token — AUTH WILL BREAK');
    assert(cols.includes('expires_at'), 'Missing: expires_at');
  });

  await test('critical tables have not been dropped', () => {
    const db = createDB(SHADOW_DB);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
    assert(tables.includes('users'), '🚨 users table was DROPPED');
    assert(tables.includes('orders'), '🚨 orders table was DROPPED');
    assert(tables.includes('sessions'), '🚨 sessions table was DROPPED');
  });
}

// ─── TEST GROUP 2: Auth Enforcement ──────────────────────────────────────────
async function testAuthEnforcement() {
  console.log('\n🔐 Test Group 2: Auth Enforcement');

  await test('/users returns 401 without token', async () => {
    const { status } = await fetchJSON('/users');
    assert(status === 401, `Expected 401 but got ${status} — AUTH IS BROKEN`);
  });

  await test('/orders returns 401 without token', async () => {
    const { status } = await fetchJSON('/orders');
    assert(status === 401, `Expected 401 but got ${status} — AUTH IS BROKEN`);
  });

  await test('invalid token is rejected', async () => {
    const { status } = await fetchJSON('/users', {
      headers: { 'Authorization': 'Bearer fake-token-000' }
    });
    assert(status === 401, `Invalid token accepted — SECURITY RISK`);
  });

  await test('valid token grants access to /users', async () => {
    const token = getToken();
    assert(token.length > 0, 'No valid token found');
    const { status } = await fetchJSON('/users', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    assert(status === 200, `Valid token rejected — got ${status}`);
  });
}

// ─── TEST GROUP 3: Endpoint Health ───────────────────────────────────────────
async function testEndpointHealth() {
  console.log('\n🌐 Test Group 3: Endpoint Health');
  const token = getToken();
  const auth = { 'Authorization': `Bearer ${token}` };

  await test('GET /health returns 200', async () => {
    const { status, body } = await fetchJSON('/health');
    assert(status === 200, `Got ${status}`);
    assert(body.status === 'ok', `Status not ok`);
  });

  await test('GET /users returns data array', async () => {
    const { status, body } = await fetchJSON('/users', { headers: auth });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(body.data), 'No data array');
    assert(body.data.length > 0, 'No users found');
  });

  await test('GET /orders returns data array', async () => {
    const { status, body } = await fetchJSON('/orders', { headers: auth });
    assert(status === 200, `Got ${status}`);
    assert(Array.isArray(body.data), 'No data array');
  });

  await test('POST /orders creates a new order', async () => {
    const { status, body } = await fetchJSON('/orders', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: 'Shadow Test Plan', amount: 99.99 })
    });
    assert(status === 201, `Got ${status}`);
    assert(body.data?.id, 'No order ID returned');
  });
}

// ─── TEST GROUP 4: Data Integrity ─────────────────────────────────────────────
async function testDataIntegrity() {
  console.log('\n🗄️  Test Group 4: Data Integrity');

  await test('database has seed data', () => {
    const db = createDB(SHADOW_DB);
    const count = db.prepare(`SELECT COUNT(*) as count FROM users`).get();
    assert(count.count > 0, 'No users — database may have been wiped');
  });

  await test('foreign key relationships intact', () => {
    const db = createDB(SHADOW_DB);
    const orphans = db.prepare(`
      SELECT COUNT(*) as count FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      WHERE u.id IS NULL
    `).get();
    assert(orphans.count === 0, `${orphans.count} orphan orders found`);
  });

  await test('email uniqueness constraint enforced', () => {
    const db = createDB(SHADOW_DB);
    const dupes = db.prepare(`
      SELECT email, COUNT(*) as count FROM users 
      GROUP BY email HAVING count > 1
    `).all();
    assert(dupes.length === 0, `${dupes.length} duplicate emails found`);
  });
}

// ─── Run All ──────────────────────────────────────────────────────────────────
async function runAllTests() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║      SHADOW TWIN TEST SUITE            ║');
  console.log('╚════════════════════════════════════════╝');

  await new Promise(r => setTimeout(r, 3000));

  await testSchemaIntegrity();
  await testAuthEnforcement();
  await testEndpointHealth();
  await testDataIntegrity();

  console.log('\n╔════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed             ║`);
  console.log('╚════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\n🚨 SHADOW TWIN DECISION: BLOCKED');
    console.log('   Human review required.\n');
    process.exit(1);
  } else {
    console.log('\n✅ SHADOW TWIN DECISION: APPROVED');
    console.log('   Safe to merge.\n');
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
