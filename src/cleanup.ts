import { database } from './db';
const pool = database();
pool.query("DELETE FROM sessions WHERE last_active < now() - interval '6 hours'")
  .then(r => console.log(`Removed ${r.rowCount} expired sessions`))
  .catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
