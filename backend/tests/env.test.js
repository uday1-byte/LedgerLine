const path = require('path');
const { spawnSync } = require('child_process');
const env = require('../src/config/env');

const { parseAndValidateEnv } = env;

function makeValidProdEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PORT: '10000',
    JWT_SECRET: 'test_only_strong_jwt_secret_value_minimum_32_chars',
    DATABASE_URL: 'postgresql://ledgerline_app:test_pass@db.example.com:5432/neondb?sslmode=require',
    REDIS_URL: 'rediss://default:test_pass@redis.example.com:6379',
    CLIENT_URL: 'https://balancevault.example.com',
    RATE_LIMIT_ENABLED: 'true',
    ...overrides,
  };
}

describe('Production Environment Configuration Validation', () => {
  it('accepts a complete, hardened production configuration', () => {
    const validated = parseAndValidateEnv(makeValidProdEnv());
    expect(validated.NODE_ENV).toBe('production');
    expect(validated.DB_USER).toBe('ledgerline_app');
    expect(validated.DB_SSL).toBe(true);
    expect(validated.DB_NAME).toBe('neondb');
    expect(validated.DB_HOST).toBe('db.example.com');
  });

  it('rejects missing JWT_SECRET in production', () => {
    const raw = makeValidProdEnv();
    delete raw.JWT_SECRET;
    expect(() => parseAndValidateEnv(raw)).toThrow(/JWT_SECRET is required in production/i);
  });

  it('rejects the default development JWT_SECRET in production', () => {
    const raw = makeValidProdEnv({
      JWT_SECRET: 'default_dev_secret_change_in_production',
    });
    expect(() => parseAndValidateEnv(raw)).toThrow(/default or placeholder secret/i);
  });

  it('rejects short/weak JWT_SECRET in production', () => {
    const raw = makeValidProdEnv({
      JWT_SECRET: 'short_secret',
    });
    expect(() => parseAndValidateEnv(raw)).toThrow(/at least 32 characters/i);
  });

  it('rejects missing DATABASE_URL in production', () => {
    const raw = makeValidProdEnv();
    delete raw.DATABASE_URL;
    expect(() => parseAndValidateEnv(raw)).toThrow(/DATABASE_URL is required in production/i);
  });

  it('rejects ledgerline_owner or non-app roles in production DATABASE_URL', () => {
    const raw = makeValidProdEnv({
      DATABASE_URL: 'postgresql://ledgerline_owner:test_pass@db.example.com:5432/neondb?sslmode=require',
    });
    expect(() => parseAndValidateEnv(raw)).toThrow(/restricted ledgerline_app role/i);
  });

  it('rejects DATABASE_URL without enforced SSL/TLS in production', () => {
    const raw = makeValidProdEnv({
      DATABASE_URL: 'postgresql://ledgerline_app:test_pass@db.example.com:5432/neondb',
    });
    expect(() => parseAndValidateEnv(raw)).toThrow(/SSL\/TLS/i);
  });

  it('rejects missing REDIS_URL in production', () => {
    const raw = makeValidProdEnv();
    delete raw.REDIS_URL;
    expect(() => parseAndValidateEnv(raw)).toThrow(/REDIS_URL is required in production/i);
  });

  it('rejects localhost REDIS_URL in production', () => {
    const raw = makeValidProdEnv({
      REDIS_URL: 'redis://127.0.0.1:6379',
    });
    expect(() => parseAndValidateEnv(raw)).toThrow(/hosted Redis service/i);
  });

  it('rejects missing CLIENT_URL in production', () => {
    const raw = makeValidProdEnv();
    delete raw.CLIENT_URL;
    expect(() => parseAndValidateEnv(raw)).toThrow(/CLIENT_URL is required in production/i);
  });

  it('rejects localhost CLIENT_URL origins in production', () => {
    const raw = makeValidProdEnv({
      CLIENT_URL: 'http://localhost:5173',
    });
    expect(() => parseAndValidateEnv(raw)).toThrow(/localhost origin/i);
  });

  it('allows standard local development and test configurations without production-only vars', () => {
    const devConfig = parseAndValidateEnv({ NODE_ENV: 'development' });
    expect(devConfig.NODE_ENV).toBe('development');
    expect(devConfig.CLIENT_URL).toBe('http://localhost:5173');
    expect(devConfig.JWT_SECRET).toBe('default_dev_secret_change_in_production');

    const testConfig = parseAndValidateEnv({ NODE_ENV: 'test' });
    expect(testConfig.NODE_ENV).toBe('test');
  });

  it('fails process startup cleanly with exit code 1 and non-sensitive logs when NODE_ENV=production lacks required vars', () => {
    const envPath = path.resolve(__dirname, '../src/config/env.js');
    const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(envPath)})`], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        LEDGERLINE_ENV: 'none',
        JWT_SECRET: 'default_dev_secret_change_in_production',
      },
      encoding: 'utf8',
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Production environment configuration failed');
    expect(res.stderr).toContain('JWT_SECRET');
    expect(res.stderr).toContain('DATABASE_URL is required in production');
    expect(res.stderr).toContain('REDIS_URL is required in production');
    expect(res.stderr).toContain('CLIENT_URL is required in production');
    // Must never echo secret value in stderr
    expect(res.stderr).not.toContain('default_dev_secret_change_in_production');
  });

  it('never loads local development .env file when NODE_ENV=production', () => {
    const envPath = path.resolve(__dirname, '../src/config/env.js');
    const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(envPath)})`], {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
      },
      encoding: 'utf8',
    });

    expect(res.status).toBe(1);
    // Even without LEDGERLINE_ENV=production, local .env's DATABASE_URL/CLIENT_URL must NOT bleed into production
    expect(res.stderr).toContain('DATABASE_URL is required in production');
    expect(res.stderr).toContain('CLIENT_URL is required in production');
  });
});
