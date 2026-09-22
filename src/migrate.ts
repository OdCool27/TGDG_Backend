import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { database } from './db';
export async function migrate() {
  const pool = database();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(724931)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    for (const name of readdirSync(join(__dirname, '../migrations')).filter(n => n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(readFileSync(join(__dirname, '../migrations', name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); await pool.end(); }
}
if (require.main === module) migrate().catch(e => { console.error(e); process.exitCode = 1; });
