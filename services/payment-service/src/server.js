require('dotenv').config();
const express = require('express');
const axios = require('axios');
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
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:4002';

async function verifyToken(req) {
  const token = req.headers.authorization;
  if (!token) throw new Error('No token');
  return token;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment-service', version: '1.0.0' });
});

app.post('/payments', async (req, res) => {
  try {
    const token = await verifyToken(req);
    const { orderId, amount, method } = req.body;

    // Verify order exists
    const orderRes = await axios.get(`${ORDER_SERVICE_URL}/orders/${orderId}`, {
      headers: { authorization: token }
    });
    const order = orderRes.data;

    const [result] = await promisePool.query(
      'INSERT INTO payments (order_id, amount, method, status) VALUES (?, ?, ?, ?)',
      [orderId, amount, method, 'completed']
    );

    // Update order status
    await promisePool.query(
      'UPDATE orders SET status = ? WHERE id = ?',
      ['paid', orderId]
    );

    res.status(201).json({
      paymentId: result.insertId,
      orderId,
      amount,
      status: 'completed'
    });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.get('/payments/:orderId', async (req, res) => {
  try {
    await verifyToken(req);
    const [rows] = await promisePool.query(
      'SELECT * FROM payments WHERE order_id = ?',
      [req.params.orderId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4003;
app.listen(PORT, () => console.log(`payment-service running on port ${PORT}`));
