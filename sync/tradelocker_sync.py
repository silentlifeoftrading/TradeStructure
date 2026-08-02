"""
TradeLocker -> Trade Journal sync.

Pulls all positions/order history + account balance from TradeLocker's
public REST API and pushes it to the journal's ingest endpoint.

Setup:
  pip install tradelocker requests python-dotenv

.env required:
  TL_ENV=https://demo.tradelocker.com      # or https://live.tradelocker.com
  TL_USERNAME=you@email.com
  TL_PASSWORD=your_password
  TL_SERVER=your_server_name
  INGEST_URL=https://your-journal.vercel.app/api/ingest
  INGEST_API_KEY=your_private_ingest_key

Run manually, or schedule via cron / Vercel Cron hitting a wrapper endpoint,
or Windows Task Scheduler if you'd rather run it from the VM.
"""

import os
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from tradelocker import TLAPI

load_dotenv()

TL_ENV = os.environ["TL_ENV"]
TL_USERNAME = os.environ["TL_USERNAME"]
TL_PASSWORD = os.environ["TL_PASSWORD"]
TL_SERVER = os.environ["TL_SERVER"]
INGEST_URL = os.environ["INGEST_URL"]
INGEST_API_KEY = os.environ["INGEST_API_KEY"]


def iso(ts):
    """Convert TradeLocker timestamp (ms epoch or datetime) to ISO string."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
    return ts


def sync_account():
    tl = TLAPI(environment=TL_ENV, username=TL_USERNAME, password=TL_PASSWORD, server=TL_SERVER)

    account_info = tl.get_account_state()  # balance, equity, account id, etc.
    positions = tl.get_all_positions()
    orders_history = tl.get_orders_history()  # closed orders/trades

    trades_payload = []

    # Open positions
    for p in positions.to_dict("records") if hasattr(positions, "to_dict") else positions:
        trades_payload.append({
            "platform_trade_id": str(p.get("id") or p.get("positionId")),
            "symbol": p.get("tradableInstrumentId") or p.get("symbol"),
            "side": "buy" if p.get("side", "").lower() == "buy" else "sell",
            "lots": p.get("qty") or p.get("volume"),
            "open_time": iso(p.get("openDate") or p.get("createdDate")),
            "close_time": None,
            "open_price": p.get("avgPrice") or p.get("openPrice"),
            "close_price": None,
            "stop_loss": p.get("stopLoss"),
            "take_profit": p.get("takeProfit"),
            "pnl": p.get("unrealizedPl") or p.get("pl"),
            "commission": p.get("commission", 0),
            "swap": p.get("swap", 0),
            "status": "open",
            "raw_payload": p,
        })

    # Closed / historical orders
    for o in orders_history.to_dict("records") if hasattr(orders_history, "to_dict") else orders_history:
        trades_payload.append({
            "platform_trade_id": str(o.get("id") or o.get("orderId")),
            "symbol": o.get("tradableInstrumentId") or o.get("symbol"),
            "side": "buy" if o.get("side", "").lower() == "buy" else "sell",
            "lots": o.get("qty") or o.get("volume"),
            "open_time": iso(o.get("createdDate")),
            "close_time": iso(o.get("closedDate") or o.get("filledDate")),
            "open_price": o.get("openPrice") or o.get("avgPrice"),
            "close_price": o.get("closePrice"),
            "stop_loss": o.get("stopLoss"),
            "take_profit": o.get("takeProfit"),
            "pnl": o.get("pl") or o.get("realizedPl"),
            "commission": o.get("commission", 0),
            "swap": o.get("swap", 0),
            "status": "closed",
            "raw_payload": o,
        })

    payload = {
        "platform": "tradelocker",
        "account": {
            "account_number": str(account_info.get("accountId") or TL_SERVER),
            "display_name": f"TradeLocker - {TL_SERVER}",
            "broker_or_firm": TL_SERVER,
            "account_type": "demo" if "demo" in TL_ENV else "live",
            "starting_balance": account_info.get("balance"),
        },
        "trades": trades_payload,
        "balance": {
            "balance": account_info.get("balance"),
            "equity": account_info.get("equity") or account_info.get("balance"),
        },
    }

    resp = requests.post(
        INGEST_URL,
        json=payload,
        headers={"x-ingest-key": INGEST_API_KEY},
        timeout=30,
    )
    resp.raise_for_status()
    print(f"[tradelocker_sync] {resp.json()}")


if __name__ == "__main__":
    sync_account()
