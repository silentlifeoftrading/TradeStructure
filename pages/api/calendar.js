// pages/api/calendar.js
//
// month view:  /api/calendar?account_id=X&month=2026-08
// day detail:  /api/calendar?account_id=X&date=2026-08-04

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  const { account_id, month, date } = req.query;
  if (!account_id) return res.status(400).json({ error: 'account_id is required' });

  const client = await pool.connect();
  try {
    if (date) {
      // Day detail: all trades that closed on this date + balance snapshots
      // across that day, for the mini chart.
      const tradesResult = await client.query(
        `SELECT id, symbol, side, lots, open_time, close_time, open_price, close_price,
                pnl, pnl_source, status
         FROM trades
         WHERE account_id = $1 AND close_time::date = $2::date
         ORDER BY close_time ASC`,
        [account_id, date]
      );

      const snapshotsResult = await client.query(
        `SELECT balance, equity, recorded_at FROM balance_snapshots
         WHERE account_id = $1 AND recorded_at::date = $2::date
         ORDER BY recorded_at ASC`,
        [account_id, date]
      );

      return res.status(200).json({
        date,
        trades: tradesResult.rows,
        balanceHistory: snapshotsResult.rows,
      });
    }

    // Month view: aggregate confirmed P&L per day
    const targetMonth = month || new Date().toISOString().slice(0, 7); // "YYYY-MM"

    const result = await client.query(
      `SELECT
         close_time::date AS trade_date,
         SUM(CASE WHEN pnl_source = 'balance_exact' THEN pnl ELSE 0 END) AS confirmed_pnl,
         COUNT(*) AS trade_count,
         COUNT(*) FILTER (WHERE pnl_source = 'balance_exact' AND pnl > 0) AS wins,
         COUNT(*) FILTER (WHERE pnl_source = 'balance_exact' AND pnl < 0) AS losses,
         COUNT(*) FILTER (WHERE pnl_source IS NULL) AS unconfirmed_count
       FROM trades
       WHERE account_id = $1
         AND status = 'closed'
         AND close_time IS NOT NULL
         AND to_char(close_time, 'YYYY-MM') = $2
       GROUP BY close_time::date
       ORDER BY trade_date ASC`,
      [account_id, targetMonth]
    );

    const days = {};
    for (const row of result.rows) {
      days[row.trade_date.toISOString().slice(0, 10)] = {
        pnl: Number(row.confirmed_pnl),
        tradeCount: Number(row.trade_count),
        wins: Number(row.wins),
        losses: Number(row.losses),
        unconfirmedCount: Number(row.unconfirmed_count),
      };
    }

    const totalPnl = Object.values(days).reduce((s, d) => s + d.pnl, 0);
    const totalTrades = Object.values(days).reduce((s, d) => s + d.tradeCount, 0);
    const totalWins = Object.values(days).reduce((s, d) => s + d.wins, 0);
    const totalDecided = Object.values(days).reduce((s, d) => s + d.wins + d.losses, 0);
    const bestDay = Object.entries(days).sort((a, b) => b[1].pnl - a[1].pnl)[0];
    const worstDay = Object.entries(days).sort((a, b) => a[1].pnl - b[1].pnl)[0];

    res.status(200).json({
      month: targetMonth,
      days,
      summary: {
        totalPnl,
        totalTrades,
        bestDay: bestDay ? { date: bestDay[0], pnl: bestDay[1].pnl } : null,
        worstDay: worstDay ? { date: worstDay[0], pnl: worstDay[1].pnl } : null,
        winRate: totalDecided ? (totalWins / totalDecided) * 100 : null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}
