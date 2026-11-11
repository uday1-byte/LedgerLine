const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const { z } = require('zod');

// Load .env file from backend root silently without console noise.
// In production, never fall back to local development .env files.
if (process.env.LEDGERLINE_ENV !== 'none') {
  const isProdTarget = process.env.LEDGERLINE_ENV === 'production' || process.env.NODE_ENV === 'production';
  const envFile = isProdTarget ? '.env.production' : '.env';
  const backendEnvPath = path.resolve(__dirname, '../../', envFile);

  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath, quiet: true });
  } else if (!isProdTarget) {
    dotenv.config({ quiet: true });
  }
}

const UNSAFE_JWT_SECRETS = new Set([
  'default_dev_secret_change_in_production',
  'replace_with_a_secure_random_jwt_secret_at_least_32_characters',
  'changeme',
  'secret',
]);

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().default('5432').transform((val) => parseInt(val, 10)),
  DB_NAME: z.string().default('ledgerline_dev'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().optional().default(''),
  DB_SSL: z.enum(['true', 'false']).default('false').transform((val) => val === 'true'),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default('24h'),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  CLIENT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.string().default('6379').transform((val) => parseInt(val, 10)),
  REDIS_PASSWORD: z.string().optional().default(''),
  REDIS_TLS: z.enum(['true', 'false']).default('false').transform((val) => val === 'true'),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
});

/**
 * Validates raw environment configuration and enforces strict security invariants
 * when NODE_ENV === 'production'. Throws descriptive, non-sensitive errors on failure.
 */
function parseAndValidateEnv(rawEnv = process.env) {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const fields = Object.keys(parsed.error.flatten().fieldErrors);
    throw new Error(`Invalid environment variable configuration for fields: ${fields.join(', ')}`);
  }

  const config = { ...parsed.data };

  if (config.NODE_ENV === 'production') {
    const errors = [];

    // 1. JWT_SECRET validation
    const rawJwt = (rawEnv.JWT_SECRET || '').trim();
    if (!rawJwt) {
      errors.push('JWT_SECRET is required in production.');
    } else if (UNSAFE_JWT_SECRETS.has(rawJwt)) {
      errors.push('JWT_SECRET must not use a known default or placeholder secret in production.');
    } else if (rawJwt.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters long in production.');
    }

    // 2. DATABASE_URL validation (restricted role + TLS)
    const rawDbUrl = (rawEnv.DATABASE_URL || '').trim();
    if (!rawDbUrl) {
      errors.push('DATABASE_URL is required in production.');
    } else {
      try {
        const dbUrl = new URL(rawDbUrl);
        if (dbUrl.protocol !== 'postgresql:' && dbUrl.protocol !== 'postgres:') {
          errors.push('DATABASE_URL must use postgresql:// or postgres:// scheme in production.');
        }
        const dbUser = decodeURIComponent(dbUrl.username || '');
        if (dbUser !== 'ledgerline_app') {
          errors.push('DATABASE_URL must connect using the restricted ledgerline_app role in production.');
        }
        const sslMode = (dbUrl.searchParams.get('sslmode') || '').toLowerCase();
        if (sslMode === 'disable' || sslMode === 'allow' || sslMode === 'prefer') {
          errors.push('DATABASE_URL must not disable or weaken TLS/SSL in production.');
        } else if (!['require', 'verify-ca', 'verify-full'].includes(sslMode) && !config.DB_SSL) {
          errors.push('DATABASE_URL must enforce SSL/TLS (sslmode=require, verify-ca, or verify-full) in production.');
        }
        if (!rawEnv.DB_HOST && dbUrl.hostname) config.DB_HOST = dbUrl.hostname;
        if (!rawEnv.DB_PORT && dbUrl.port) config.DB_PORT = parseInt(dbUrl.port, 10);
        if (!rawEnv.DB_NAME && dbUrl.pathname && dbUrl.pathname.length > 1) {
          config.DB_NAME = dbUrl.pathname.slice(1);
        }
        if (!rawEnv.DB_USER) config.DB_USER = 'ledgerline_app';
        config.DB_SSL = true;
      } catch (_) {
        errors.push('DATABASE_URL must be a valid PostgreSQL connection URI in production.');
      }
    }

    // 3. REDIS_URL validation (real hosted Redis required)
    const rawRedisUrl = (rawEnv.REDIS_URL || '').trim();
    if (!rawRedisUrl) {
      errors.push('REDIS_URL is required in production.');
    } else {
      try {
        const redisUrl = new URL(rawRedisUrl);
        if (redisUrl.protocol !== 'redis:' && redisUrl.protocol !== 'rediss:') {
          errors.push('REDIS_URL must use redis:// or rediss:// scheme in production.');
        }
        if (LOCALHOST_HOSTNAMES.has(redisUrl.hostname.toLowerCase())) {
          errors.push('REDIS_URL must target a hosted Redis service and not localhost in production.');
        }
      } catch (_) {
        errors.push('REDIS_URL must be a valid Redis connection URI in production.');
      }
    }

    // 4. CLIENT_URL validation (required, non-localhost origin)
    const rawClientUrl = (rawEnv.CLIENT_URL || '').trim();
    if (!rawClientUrl) {
      errors.push('CLIENT_URL is required in production.');
    } else {
      try {
        const clientUrl = new URL(rawClientUrl);
        if (clientUrl.protocol !== 'http:' && clientUrl.protocol !== 'https:') {
          errors.push('CLIENT_URL must use http:// or https:// scheme in production.');
        }
        if (LOCALHOST_HOSTNAMES.has(clientUrl.hostname.toLowerCase())) {
          errors.push('CLIENT_URL must not reference a localhost origin in production.');
        }
      } catch (_) {
        errors.push('CLIENT_URL must be a valid URL in production.');
      }
    }

    // 5. Rate limiting must remain active in production
    if (!config.RATE_LIMIT_ENABLED) {
      errors.push('RATE_LIMIT_ENABLED must not be set to false in production.');
    }

    if (errors.length > 0) {
      throw new Error(`Production environment configuration failed:\n- ${errors.join('\n- ')}`);
    }

    config.JWT_SECRET = rawJwt;
    config.DATABASE_URL = rawDbUrl;
    config.REDIS_URL = rawRedisUrl;
    config.CLIENT_URL = rawClientUrl;
  } else {
    config.JWT_SECRET = (config.JWT_SECRET || '').trim() || 'default_dev_secret_change_in_production';
    config.CLIENT_URL = (config.CLIENT_URL || '').trim() || 'http://localhost:5173';
  }

  return config;
}

let env;
try {
  env = parseAndValidateEnv(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

Object.defineProperty(env, 'parseAndValidateEnv', {
  value: parseAndValidateEnv,
  enumerable: false,
});

module.exports = env;
