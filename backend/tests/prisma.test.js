const prisma = require('../src/config/prisma');

describe('Prisma ORM Integration Tests', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects to the database and executes a raw ping query', async () => {
    const result = await prisma.$queryRaw`SELECT 1 as ping`;
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
    expect(Number(result[0].ping)).toBe(1);
  });

  it('can query users model using Prisma Client', async () => {
    const users = await prisma.users.findMany({
      take: 5,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        is_active: true,
        created_at: true,
      },
    });
    expect(Array.isArray(users)).toBe(true);
    if (users.length > 0) {
      expect(users[0]).toHaveProperty('id');
      expect(users[0]).toHaveProperty('username');
      expect(users[0]).toHaveProperty('email');
      expect(users[0]).toHaveProperty('role');
    }
  });

  it('can query accounts model using Prisma Client and maps BigInt monetary fields correctly', async () => {
    const accounts = await prisma.accounts.findMany({
      take: 5,
      select: {
        id: true,
        account_number: true,
        balance_paise: true,
        account_type: true,
        user_id: true,
        created_at: true,
      },
    });
    expect(Array.isArray(accounts)).toBe(true);
    if (accounts.length > 0) {
      expect(accounts[0]).toHaveProperty('id');
      expect(accounts[0]).toHaveProperty('account_number');
      expect(typeof accounts[0].balance_paise).toBe('bigint');
    }
  });

  it('preserves relational queries between accounts and users without mutating schema', async () => {
    const accountWithOwner = await prisma.accounts.findFirst({
      where: {
        user_id: { not: null },
      },
      include: {
        users: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (accountWithOwner) {
      expect(accountWithOwner.users).toBeDefined();
      expect(accountWithOwner.users.id).toBe(accountWithOwner.user_id);
    }
  });
});
