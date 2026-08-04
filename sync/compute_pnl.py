"""
Balance-based P&L reconciliation.

Runs after each TradeLocker/MT5 sync. Looks at consecutive balance
snapshots per account and matches the real balance change to whichever
trade(s) closed in that window:

  - Exactly 1 trade closed  -> that trade gets the exact, real P&L
    (the balance delta itself -- broker-confirmed, no calculation risk).
  - 0 trades closed         -> balance moved with no matching close
    (usually overnight swap on an open position) -- logged, not
    attributed to any trade.
  - 2+ trades closed        -> we do NOT guess a split. The combined
    real P&L for the window is stored in ambiguous_pnl_windows instead,
    and those trades are left without a fabricated individual number.

Setup:
  pip install psycopg2-binary python-dotenv

.env / secret required:
  DATABASE_URL=<same Supabase transaction-pooler string used elsewhere>
"""

import os
import json
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]


def reconcile_account(conn, account_id, display_name):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """SELECT recorded_at, balance FROM balance_snapshots
               WHERE account_id = %s ORDER BY recorded_at ASC""",
            (account_id,),
        )
        snapshots = cur.fetchall()

        if len(snapshots) < 2:
            print(f"  {display_name}: not enough snapshots yet to reconcile ({len(snapshots)} found)")
            return {"exact": 0, "ambiguous": 0, "unmatched_delta": 0}

        exact_count = 0
        ambiguous_count = 0
        unmatched_count = 0

        for prev, curr in zip(snapshots, snapshots[1:]):
            delta = round(float(curr["balance"]) - float(prev["balance"]), 2)
            if delta == 0:
                continue  # no change, nothing to reconcile

            cur.execute(
                """SELECT id FROM trades
                   WHERE account_id = %s AND status = 'closed'
                     AND close_time > %s AND close_time <= %s
                     AND pnl_source IS NULL""",
                (account_id, prev["recorded_at"], curr["recorded_at"]),
            )
            closed_in_window = [r["id"] for r in cur.fetchall()]

            if len(closed_in_window) == 1:
                cur.execute(
                    """UPDATE trades SET pnl = %s, pnl_source = 'balance_exact'
                       WHERE id = %s""",
                    (delta, closed_in_window[0]),
                )
                exact_count += 1

            elif len(closed_in_window) > 1:
                cur.execute(
                    """INSERT INTO ambiguous_pnl_windows
                         (account_id, window_start, window_end, balance_delta, trade_ids)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (account_id, window_start, window_end)
                       DO UPDATE SET balance_delta = EXCLUDED.balance_delta,
                                     trade_ids = EXCLUDED.trade_ids""",
                    (account_id, prev["recorded_at"], curr["recorded_at"], delta,
                     json.dumps([str(t) for t in closed_in_window])),
                )
                ambiguous_count += 1

            else:
                # Balance moved but no closed trade found -- likely swap
                # on an open position, or a manual deposit/withdrawal.
                unmatched_count += 1

        conn.commit()
        print(f"  {display_name}: {exact_count} exact, {ambiguous_count} ambiguous windows, "
              f"{unmatched_count} unmatched balance changes")
        return {"exact": exact_count, "ambiguous": ambiguous_count, "unmatched_delta": unmatched_count}


def main():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, display_name FROM accounts WHERE is_active = TRUE")
            accounts = cur.fetchall()

        print(f"Reconciling P&L for {len(accounts)} account(s)...")
        for acct in accounts:
            reconcile_account(conn, acct["id"], acct["display_name"])

    finally:
        conn.close()


if __name__ == "__main__":
    main()
