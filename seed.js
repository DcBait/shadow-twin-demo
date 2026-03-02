const { createDB } = require('./database');
const { faker } = require('@faker-js/faker');
const crypto = require('crypto');

const DB_NAME = process.env.DB_NAME || 'production.sqlite';

console.log(`\n🌱 Seeding database: ${DB_NAME}`);
const db = createDB(DB_NAME);

// Clear existing data
db.exec(`DELETE FROM sessions; DELETE FROM orders; DELETE FROM users;`);

// Seed Users (50 fake users)
const insertUser = db.prepare(`
  INSERT INTO users (name, email, role) VALUES (?, ?, ?)
`);

const users = [];
for (let i = 0; i < 50; i++) {
  const name = faker.person.fullName();
  const email = faker.internet.email();
  const role = i === 0 ? 'admin' : 'user';
  const result = insertUser.run(name, email, role);
  users.push({ id: result.lastInsertRowid, name, email });
}

console.log(`✅ Created ${users.length} users`);

// Seed Orders (200 fake orders)
const insertOrder = db.prepare(`
  INSERT INTO orders (user_id, product, amount, status) VALUES (?, ?, ?, ?)
`);

const products = ['Premium Plan', 'Basic Plan', 'Enterprise Plan', 'Add-on Pack', 'Support Tier'];
const statuses = ['pending', 'completed', 'cancelled', 'refunded'];

for (let i = 0; i < 200; i++) {
  const user = faker.helpers.arrayElement(users);
  const product = faker.helpers.arrayElement(products);
  const amount = parseFloat(faker.commerce.price({ min: 9, max: 999 }));
  const status = faker.helpers.arrayElement(statuses);
  insertOrder.run(user.id, product, amount, status);
}

console.log(`✅ Created 200 orders`);

// Seed Sessions (valid tokens for first 10 users)
const insertSession = db.prepare(`
  INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)
`);

const tokens = {};
for (let i = 0; i < 10; i++) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24h from now
  insertSession.run(users[i].id, token, expiresAt);
  tokens[token] = users[i];
}

// Save a demo token to file for easy testing
const fs = require('fs');
const demoToken = Object.keys(tokens)[0];
fs.writeFileSync('demo-token.txt', demoToken);

console.log(`✅ Created 10 sessions`);
console.log(`\n🎉 Seeding complete!`);
console.log(`🔑 Demo auth token saved to demo-token.txt`);
console.log(`\nDemo token: ${demoToken}\n`);
