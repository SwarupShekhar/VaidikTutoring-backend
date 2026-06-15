const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Load .env variables
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envConfig = require('dotenv').config({ path: envPath });
}

const jwtSecret = process.env.JWT_SECRET || 'replace_with_random_secret';
const adminEmail = 'swarupshekhar.vaidikedu@gmail.com';

const payload = {
  email: adminEmail,
  role: 'admin',
};

const token = jwt.sign(payload, jwtSecret, { expiresIn: '30d' });

console.log('\n======================================');
console.log('YOUR ADMIN JWT FALLBACK TOKEN:');
console.log('======================================');
console.log(token);
console.log('======================================\n');
