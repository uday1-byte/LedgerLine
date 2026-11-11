const { PrismaClient } = require('@prisma/client');
const env = require('./env');

const prisma = new PrismaClient({
  ...(env.DATABASE_URL && {
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
  }),
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
