const express = require('express');
const cors = require('cors');
const healthRoutes = require('./routes/health');
const env = require('./config/env');

const app = express();

// Enable Cross-Origin Resource Sharing (CORS) for frontend client
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root welcome route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to LedgerLine Financial API',
    version: '1.0.0',
    documentation: '/api/health for system status',
  });
});

// Mount Routes
app.use('/api/health', healthRoutes);

// 404 Handler for undefined routes
app.use((req, res, next) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred on the server',
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
