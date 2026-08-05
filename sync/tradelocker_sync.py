"""
TradeLocker -> Trade Journal sync (multi-account).

Loops over every account defined in the TL_ACCOUNTS secret and syncs
each one separately. Add or remove accounts by editing that one JSON
value -- no code changes needed.

Setup:
  pip install tradelocker requests python-dotenv

.env / secret required:
  TL_ACCOUNTS=<JSON array, see format below>
  INGEST_URL=https://your-journal.vercel.app/api/ingest
  INGEST_API_KEY=your_private_ingest_key

TL_ACCOUNTS format (a single JSON string, no line breaks needed):
[
  {
    "label": "Demo - EMA Bot",
    "env": "https://demo.tradelocker.com",
    "username": "you@email.com",
    "password": "your_password",
    "server": "your_server_code",
    "broker_or_firm": "TradeLocker Demo"
  },
  {
    "label": "thePropTrade - Challenge 1",
    "env": "https://live.tradelocker.com",
    "username": "you@email.com",
    "password": "your_password",
    "server": "another_server_code",
    "broker_or_firm": "thePropTrade"
  }
]

One bad account (wrong password, server, etc.) will NOT stop the others
from syncing -- each account's errors are caught and logged individually.
"""

import os
import json
import math
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from tradelocker import TLAPI

load_dotenv()

TL_ACCOUNTS_RAW = os.environ["TL_ACCOUNTS"]
INGEST_URL = os.environ["INGEST_URL"]
INGEST_API_KEY = os.environ["INGEST_API_KEY"]


def sanitize_for_json(obj):
    """
    TradeLocker's pandas/numpy data contains NaN values and numpy scalar
    types (int64, float64) that Python's JSON encoder can't send -- this
    walks the whole structure and fixes both before we POST it.
    """
    if hasattr(obj, "item") and not isinstance(obj, (dict, list, str)):
        try:
            obj = obj.item()
        except Exception:
            pass
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    return obj


def iso(ts):
    """Convert TradeLocker timestamp (ms epoch or datetime) to ISO string."""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
    return ts


def sync_one_account(acct):
    label = acct.get("label", acct.get("username", "unknown"))
    print(f"--- Syncing: {label} ---")

    tl = TLAPI(
        environment=acct["env"],
        username=acct["username"],
        password=acct["password"],
        server=acct["server"],
    )

    account_info = tl.get_account_state()
    positions = tl.get_all_positions()
    orders_history = tl.get_all_orders(history=True, lookback_period="90D")

    # TradeLocker's order/position data only gives a numeric instrument ID,
    # not the actual pair name -- build a lookup once so trades show
    # "EURJPY" instead of "18506".
    instruments = tl.get_all_instruments()
    instrument_records = instruments.to_dict("records") if hasattr(instruments, "to_dict") else instruments
    symbol_lookup = {
        rec.get("tradableInstrumentId"): rec.get("name")
        for rec in instrument_records
        if rec.get("tradableInstrumentId") is not None
    }

    def resolve_symbol(instrument_id):
        return symbol_lookup.get(instrument_id, str(instrument_id))

    trades_payload = []

    for p in positions.to_dict("records") if hasattr(positions, "to_dict") else positions:
        trades_payload.append({
            "platform_trade_id": str(p.get("id") or p.get("positionId")),
            "symbol": resolve_symbol(p.get("tradableInstrumentId")) or p.get("symbol"),
            "side": "buy" if str(p.get("side", "")).lower() == "buy" else "sell",
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

    order_records = orders_history.to_dict("records") if hasattr(orders_history, "to_dict") else orders_history

    for o in order_records:
        # Only treat fully filled orders as "closed trades" -- pending,
        # cancelled, and rejected orders aren't real trades.
        if str(o.get("status", "")).lower() != "filled":
            continue
        trades_payload.append({
            "platform_trade_id": str(o.get("id") or o.get("orderId")),
            "symbol": resolve_symbol(o.get("tradableInstrumentId")) or o.get("symbol"),
            "side": "buy" if str(o.get("side", "")).lower() == "buy" else "sell",
            "lots": o.get("filledQty") or o.get("qty"),
            "open_time": iso(o.get("createdDate")),
            "close_time": iso(o.get("lastModified")),
            "open_price": o.get("avgPrice") or o.get("price"),
            "close_price": None,  # not exposed at order level in this API version -- see note below
            "stop_loss": o.get("stopLoss"),
            "take_profit": o.get("takeProfit"),
            "pnl": None,  # not exposed at order level -- realized P&L needs a separate execution/position lookup, see note below
            "commission": o.get("commission", 0),
            "swap": o.get("swap", 0),
            "status": "closed",
            "raw_payload": o,
        })

    # account_number MUST be unique per account across your whole setup --
    # this is what the DB uses to tell accounts apart. Using TL's internal
    # accountId (scoped to server+env) avoids collisions between accounts
    # that might otherwise share a login email.
    payload = {
        "platform": "tradelocker",
        "account": {
            "account_number": f"{acct['server']}-{account_info.get('accountId')}",
            "display_name": label,
            "broker_or_firm": acct.get("broker_or_firm", acct["server"]),
            "account_type": "demo" if "demo" in acct["env"] else "live",
            "starting_balance": account_info.get("balance"),
        },
        "trades": trades_payload,
        "balance": {
            "balance": account_info.get("balance"),
            "equity": account_info.get("equity") or account_info.get("balance"),
        },
    }

    payload = sanitize_for_json(payload)

    resp = requests.post(
        INGEST_URL,
        json=payload,
        headers={"x-ingest-key": INGEST_API_KEY},
        timeout=30,
    )
    resp.raise_for_status()
    print(f"    -> {resp.json()}")


def sync_all_accounts():
    accounts = json.loads(TL_ACCOUNTS_RAW)
    if not isinstance(accounts, list) or len(accounts) == 0:
        raise ValueError("TL_ACCOUNTS must be a non-empty JSON array. Check the secret's value.")

    results = {"success": [], "failed": []}

    for acct in accounts:
        label = acct.get("label", acct.get("username", "unknown"))
        try:
            sync_one_account(acct)
            results["success"].append(label)
        except Exception as e:
            print(f"    !! FAILED for {label}: {e}")
            results["failed"].append((label, str(e)))

    print("\n=== Sync summary ===")
    print(f"Succeeded: {results['success']}")
    print(f"Failed: {[f[0] for f in results['failed']]}")

    # Exit non-zero only if EVERY account failed -- one bad account
    # shouldn't mark the whole run red if others succeeded.
    if results["failed"] and not results["success"]:
        raise SystemExit(1)


if __name__ == "__main__":
    sync_all_accounts()
