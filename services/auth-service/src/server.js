require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');

const app = express();
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0
});

const promisePool = pool.promise();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'auth-service', version: '1.0.0' });
});

app.post('/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  try {
    await promisePool.query(
      'INSERT INTO users (username, password_hash) VALUES (?, SHA2(?, 256))',
      [username, password]
    );
    res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await promisePool.query(
      'SELECT id, username FROM users WHERE username = ? AND password_hash = SHA2(?, 256)',
      [username, password]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { userId: rows[0].id, username: rows[0].username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/auth/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`auth-service running on port ${PORT}`));
