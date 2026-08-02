import { Pool } from 'pg';

export default async function handler(req, res) {
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query('SELECT NOW() as db_time, (SELECT count(*) FROM accounts) as account_count');
    await pool.end();
    return res.status(200).json({
      ok: true,
      db_connected: true,
      db_time: result.rows[0].db_time,
      accounts_in_db: result.rows[0].account_count,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      db_connected: false,
      error: err.message,
      hint: 'Check DATABASE_URL is set correctly in Vercel env vars, and that db/schema.sql was run in Supabase.',
    });
  }
}
