const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const { initializeRedis, closeRedis } = require('./config/redis');

const PORT = env.PORT || 5000;

// Initiate Redis handshake immediately on server boot so client reaches ready state
initializeRedis();

const server = app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` LedgerLine API Server is running`);
  console.log(` Environment : ${env.NODE_ENV}`);
  console.log(` Port        : ${PORT}`);
  console.log(` Health URL  : http://localhost:${PORT}/api/health`);
  console.log(` Database    : ${env.DB_NAME} on ${env.DB_HOST}:${env.DB_PORT}`);
  console.log(`=========================================`);
});

// Graceful shutdown
const gracefulShutdown = async () => {
  console.log('Received shutdown signal, closing server gracefully...');
  server.close(async () => {
    console.log('HTTP server closed.');
    try {
      await prisma.$disconnect();
      await closeRedis();
    } catch (_) {}
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = server;
