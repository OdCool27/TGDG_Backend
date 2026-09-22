import 'dotenv/config';
import { Pool } from 'pg';
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('An idle database connection closed; the pool will reconnect.'));
  return pool;
}
