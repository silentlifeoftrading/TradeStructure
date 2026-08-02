"""
MT5 -> Trade Journal sync.

IMPORTANT: This script must run ON the Windows VM, with the MT5 terminal
open and logged in. The MetaTrader5 Python package only talks to a local
terminal instance -- it cannot connect to a remote MT5 server directly.

Setup (on the Windows VM, same one running mt5_prop_firm_bot.py):
  pip install MetaTrader5 requests python-dotenv

.env required (same folder as this script, or wherever you keep the bot's .env):
  INGEST_URL=https://your-journal.vercel.app/api/ingest
  INGEST_API_KEY=your_private_ingest_key
  MT5_ACCOUNT_LABEL=thePropTrade Challenge 1   # human-readable label, since MT5 login is just a number
  MT5_BROKER_OR_FIRM=thePropTrade

Schedule this with Windows Task Scheduler to run every 15-30 min, same
cadence as your bot's polling loop. No need to pass login/password here --
it reads whatever account is currently logged into the running terminal.
"""

import os
import requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import MetaTrader5 as mt5

load_dotenv()

INGEST_URL = os.environ["INGEST_URL"]
INGEST_API_KEY = os.environ["INGEST_API_KEY"]
ACCOUNT_LABEL = os.environ.get("MT5_ACCOUNT_LABEL", "MT5 Account")
BROKER_OR_FIRM = os.environ.get("MT5_BROKER_OR_FIRM", "")


def iso(ts):
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def sync_account(lookback_days=90):
    if not mt5.initialize():
        raise RuntimeError(f"MT5 initialize() failed: {mt5.last_error()}")

    try:
        account_info = mt5.account_info()
        if account_info is None:
            raise RuntimeError(f"No account logged into terminal: {mt5.last_error()}")

        trades_payload = []

        # Open positions
        positions = mt5.positions_get() or ()
        for p in positions:
            trades_payload.append({
                "platform_trade_id": str(p.ticket),
                "symbol": p.symbol,
                "side": "buy" if p.type == mt5.ORDER_TYPE_BUY else "sell",
                "lots": p.volume,
                "open_time": iso(p.time),
                "close_time": None,
                "open_price": p.price_open,
                "close_price": None,
                "stop_loss": p.sl,
                "take_profit": p.tp,
                "pnl": p.profit,
                "commission": 0,  # not exposed on open positions; picked up on close via deals
                "swap": p.swap,
                "status": "open",
                "raw_payload": p._asdict(),
            })

        # Closed trades (deals) over the lookback window
        date_from = datetime.now(timezone.utc) - timedelta(days=lookback_days)
        deals = mt5.history_deals_get(date_from, datetime.now(timezone.utc)) or ()

        # Group deals by position id -- an MT5 "trade" is really an in+out deal pair
        by_position = {}
        for d in deals:
            by_position.setdefault(d.position_id, []).append(d)

        for pos_id, pos_deals in by_position.items():
            entries = [d for d in pos_deals if d.entry == mt5.DEAL_ENTRY_IN]
            exits = [d for d in pos_deals if d.entry == mt5.DEAL_ENTRY_OUT]
            if not entries or not exits:
                continue  # partial data, skip until fully closed
            entry, exit_ = entries[0], exits[-1]
            trades_payload.append({
                "platform_trade_id": str(pos_id),
                "symbol": entry.symbol,
                "side": "buy" if entry.type == mt5.DEAL_TYPE_BUY else "sell",
                "lots": entry.volume,
                "open_time": iso(entry.time),
                "close_time": iso(exit_.time),
                "open_price": entry.price,
                "close_price": exit_.price,
                "stop_loss": None,
                "take_profit": None,
                "pnl": sum(d.profit for d in pos_deals),
                "commission": sum(d.commission for d in pos_deals),
                "swap": sum(d.swap for d in pos_deals),
                "status": "closed",
                "raw_payload": [d._asdict() for d in pos_deals],
            })

        payload = {
            "platform": "mt5",
            "account": {
                "account_number": str(account_info.login),
                "display_name": ACCOUNT_LABEL,
                "broker_or_firm": BROKER_OR_FIRM,
                "account_type": "demo" if account_info.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO else "live",
                "starting_balance": account_info.balance,
            },
            "trades": trades_payload,
            "balance": {
                "balance": account_info.balance,
                "equity": account_info.equity,
            },
        }

        resp = requests.post(
            INGEST_URL,
            json=payload,
            headers={"x-ingest-key": INGEST_API_KEY},
            timeout=30,
        )
        resp.raise_for_status()
        print(f"[mt5_sync] {resp.json()}")

    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sync_account()
