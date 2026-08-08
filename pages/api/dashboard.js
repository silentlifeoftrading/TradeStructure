// pages/api/dashboard.js
//
// Single endpoint that returns everything the dashboard page needs:
// account list, balance history for the chart, recent trades, and
// summary stats. Kept as one call to avoid the dashboard waterfalling
// multiple requests on load.

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
  const accountId = req.query.account_id || null;

  const client = await pool.connect();
  try {
    const accountsResult = await client.query(
      `SELECT id, platform, account_number, display_name, broker_or_firm,
              account_type, starting_balance, is_active
       FROM accounts ORDER BY display_name ASC`
    );
    const accounts = accountsResult.rows;

    if (accounts.length === 0) {
      return res.status(200).json({ accounts: [], summary: null, balanceHistory: [], trades: [] });
    }

    const activeAccountId = accountId || accounts[0].id;

    const balanceHistoryResult = await client.query(
      `SELECT balance, equity, recorded_at FROM balance_snapshots
       WHERE account_id = $1 ORDER BY recorded_at ASC`,
      [activeAccountId]
    );
    const balanceHistory = balanceHistoryResult.rows;

    const tradesResult = await client.query(
      `SELECT id, symbol, side, lots, open_time, close_time, open_price, close_price,
              pnl, pnl_source, status, commission, swap
       FROM trades WHERE account_id = $1
       ORDER BY COALESCE(close_time, open_time) DESC LIMIT 100`,
      [activeAccountId]
    );
    const trades = tradesResult.rows;

    const ambiguousResult = await client.query(
      `SELECT window_start, window_end, balance_delta, trade_ids
       FROM ambiguous_pnl_windows WHERE account_id = $1
       ORDER BY window_end DESC LIMIT 50`,
      [activeAccountId]
    );
    const ambiguousWindows = ambiguousResult.rows;

    // Summary stats
    const currentBalance = balanceHistory.length
      ? Number(balanceHistory[balanceHistory.length - 1].balance)
      : null;
    const currentEquity = balanceHistory.length
      ? Number(balanceHistory[balanceHistory.length - 1].equity)
      : null;

    const reconciledTrades = trades.filter((t) => t.pnl_source === 'balance_exact' && t.pnl !== null);
    const wins = reconciledTrades.filter((t) => Number(t.pnl) > 0).length;
    const losses = reconciledTrades.filter((t) => Number(t.pnl) < 0).length;
    const winRate = reconciledTrades.length ? (wins / reconciledTrades.length) * 100 : null;

    const exactPnlTotal = reconciledTrades.reduce((sum, t) => sum + Number(t.pnl), 0);
    const ambiguousPnlTotal = ambiguousWindows.reduce((sum, w) => sum + Number(w.balance_delta), 0);

    // Max drawdown from balance history (peak-to-trough on equity curve)
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const snap of balanceHistory) {
      const eq = Number(snap.equity);
      if (eq > peak) peak = eq;
      const dd = peak - eq;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const openPositionsCount = trades.filter((t) => t.status === 'open').length;

    res.status(200).json({
      accounts,
      activeAccountId,
      summary: {
        currentBalance,
        currentEquity,
        winRate,
        wins,
        losses,
        reconciledTradeCount: reconciledTrades.length,
        ambiguousWindowCount: ambiguousWindows.length,
        exactPnlTotal,
        ambiguousPnlTotal,
        maxDrawdown,
        openPositionsCount,
      },
      balanceHistory,
      trades,
      ambiguousWindows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}
