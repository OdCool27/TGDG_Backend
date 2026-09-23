import 'dotenv/config';
import { Pool } from 'pg';
export function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL, max: 10,
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 10000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 10000,
  });
  pool.on('error', () => console.error('An idle database connection closed; the pool will reconnect.'));
  return pool;
}
