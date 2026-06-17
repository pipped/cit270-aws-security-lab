const express = require('express');
const cors = require('cors');
const path = require('path');
const tasksRouter = require('./routes/tasks');

const app = express();
const PORT = process.env.PORT || 3000;

// Only accept requests from the web tier (set WEB_ORIGIN env var on EC2)
const allowedOrigin = process.env.WEB_ORIGIN || '*';

app.use(cors({ origin: allowedOrigin }));
app.use(express.json());

// Health check — used to verify the app tier is reachable from the web tier
app.get('/health', (req, res) => {
  res.json({ status: 'ok', tier: 'app', timestamp: new Date().toISOString() });
});

app.use('/api/tasks', tasksRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`App tier listening on port ${PORT}`);
  console.log(`Allowed origin: ${allowedOrigin}`);
});
