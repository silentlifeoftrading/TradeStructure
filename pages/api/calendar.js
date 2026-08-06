// pages/api/calendar.js
//
// month view:  /api/calendar?account_id=X&month=2026-08
// day detail:  /api/calendar?account_id=X&date=2026-08-04
//
// All day-bucketing is done in Asia/Kolkata time, not UTC, so a trade
// closing at 12:03 AM IST lands on the correct calendar day for an
// India-based user instead of the previous UTC day.

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TZ = 'Asia/Kolkata';

export default async function handler(req, res) {
  const { account_id, month, date } = req.query;
  if (!account_id) return res.status(400).json({ error: 'account_id is required' });

  const client = await pool.connect();
  try {
    if (date) {
      const tradesResult = await client.query(
        `SELECT id, symbol, side, lots, open_time, close_time, open_price, close_price,
                pnl, pnl_source, status
         FROM trades
         WHERE account_id = $1
           AND (close_time AT TIME ZONE $3)::date = $2::date
         ORDER BY close_time ASC`,
        [account_id, date, TZ]
      );

      const snapshotsResult = await client.query(
        `SELECT balance, equity, recorded_at FROM balance_snapshots
         WHERE account_id = $1
           AND (recorded_at AT TIME ZONE $3)::date = $2::date
         ORDER BY recorded_at ASC`,
        [account_id, date, TZ]
      );

      return res.status(200).json({
        date,
        trades: tradesResult.rows,
        balanceHistory: snapshotsResult.rows,
      });
    }

    const targetMonth = month || new Date().toISOString().slice(0, 7);

    const trackingStartResult = await client.query(
      `SELECT MIN(recorded_at) AS start FROM balance_snapshots WHERE account_id = $1`,
      [account_id]
    );
    const trackingStart = trackingStartResult.rows[0]?.start || null;

    const result = await client.query(
      `SELECT
         (close_time AT TIME ZONE $2)::date AS trade_date,
         SUM(CASE WHEN pnl_source = 'balance_exact' THEN pnl ELSE 0 END) AS confirmed_pnl,
         COUNT(*) AS trade_count,
         COUNT(*) FILTER (WHERE pnl_source = 'balance_exact' AND pnl > 0) AS wins,
         COUNT(*) FILTER (WHERE pnl_source = 'balance_exact' AND pnl < 0) AS losses,
         COUNT(*) FILTER (WHERE pnl_source IS NULL) AS unconfirmed_count
       FROM trades
       WHERE account_id = $1
         AND status = 'closed'
         AND close_time IS NOT NULL
         AND to_char(close_time AT TIME ZONE $2, 'YYYY-MM') = $3
       GROUP BY (close_time AT TIME ZONE $2)::date
       ORDER BY trade_date ASC`,
      [account_id, TZ, targetMonth]
    );

    const days = {};
    for (const row of result.rows) {
      const tradeCount = Number(row.trade_count);
      const unconfirmedCount = Number(row.unconfirmed_count);
      days[row.trade_date.toISOString().slice(0, 10)] = {
        pnl: Number(row.confirmed_pnl),
        tradeCount,
        wins: Number(row.wins),
        losses: Number(row.losses),
        unconfirmedCount,
        // true only if every trade that day has a real, confirmed number --
        // used by the UI to avoid showing a misleading "$0.00"
        hasConfirmedData: unconfirmedCount < tradeCount,
      };
    }

    const confirmedDays = Object.values(days).filter((d) => d.hasConfirmedData);
    const totalPnl = confirmedDays.reduce((s, d) => s + d.pnl, 0);
    const totalTrades = Object.values(days).reduce((s, d) => s + d.tradeCount, 0);
    const totalWins = confirmedDays.reduce((s, d) => s + d.wins, 0);
    const totalDecided = confirmedDays.reduce((s, d) => s + d.wins + d.losses, 0);
    const sortedConfirmed = Object.entries(days)
      .filter(([, d]) => d.hasConfirmedData)
      .sort((a, b) => b[1].pnl - a[1].pnl);
    const bestDay = sortedConfirmed[0];
    const worstDay = sortedConfirmed[sortedConfirmed.length - 1];

    res.status(200).json({
      month: targetMonth,
      trackingStart,
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
