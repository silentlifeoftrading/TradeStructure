// pages/api/ingest.js
//
// This is the ONLY endpoint that writes trade data. Both sync scripts
// (TradeLocker and MT5) call this. Broker credentials never reach this
// server — only the resulting trade/account/balance data does.

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = req.headers['x-ingest-key'];
  if (apiKey !== process.env.INGEST_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { platform, account, trades, balance } = req.body;

  if (!platform || !account) {
    return res.status(400).json({ error: 'platform and account are required' });
  }

  const client = await pool.connect();
  let tradesSynced = 0;

  try {
    await client.query('BEGIN');

    // 1. Upsert the account
    const accountResult = await client.query(
      `INSERT INTO accounts (platform, account_number, display_name, broker_or_firm, account_type, starting_balance)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (platform, account_number)
       DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [platform, account.account_number, account.display_name, account.broker_or_firm, account.account_type, account.starting_balance]
    );
    const accountId = accountResult.rows[0].id;

    // 2. Upsert trades (idempotent — safe to re-run sync repeatedly)
    for (const t of trades || []) {
      await client.query(
        `INSERT INTO trades
           (account_id, platform_trade_id, symbol, side, lots, open_time, close_time,
            open_price, close_price, stop_loss, take_profit, pnl, commission, swap, status, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (account_id, platform_trade_id)
         DO UPDATE SET
           close_time = EXCLUDED.close_time,
           close_price = EXCLUDED.close_price,
           pnl = EXCLUDED.pnl,
           status = EXCLUDED.status,
           raw_payload = EXCLUDED.raw_payload,
           synced_at = now()`,
        [accountId, t.platform_trade_id, t.symbol, t.side, t.lots, t.open_time, t.close_time,
         t.open_price, t.close_price, t.stop_loss, t.take_profit, t.pnl, t.commission, t.swap, t.status, t.raw_payload]
      );
      tradesSynced++;
    }

    // 3. Record a balance snapshot (for drawdown tracking)
    if (balance) {
      await client.query(
        `INSERT INTO balance_snapshots (account_id, balance, equity) VALUES ($1, $2, $3)`,
        [accountId, balance.balance, balance.equity]
      );
    }

    // 4. Log the sync
    await client.query(
      `INSERT INTO sync_logs (account_id, platform, status, trades_synced) VALUES ($1, $2, 'success', $3)`,
      [accountId, platform, tradesSynced]
    );

    await client.query('COMMIT');
    return res.status(200).json({ ok: true, tradesSynced });

  } catch (err) {
    await client.query('ROLLBACK');
    await pool.query(
      `INSERT INTO sync_logs (platform, status, error_message) VALUES ($1, 'error', $2)`,
      [platform, err.message]
    );
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}
