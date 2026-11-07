const dotenv = require('dotenv');
const path = require('path');
const { z } = require('zod');

// Load .env file from backend root or workspace root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config(); // Fallback to default cwd .env

// Define schema for required and optional environment variables
const envSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.string().default('5432').transform((val) => parseInt(val, 10)),
  DB_NAME: z.string().default('ledgerline_dev'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().optional().default(''),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().default('default_dev_secret_change_in_production'),
  JWT_EXPIRES_IN: z.string().default('24h'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

const env = parsed.data;

module.exports = env;
