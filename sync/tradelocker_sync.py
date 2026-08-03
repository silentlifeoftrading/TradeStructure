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
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from tradelocker import TLAPI

load_dotenv()

TL_ACCOUNTS_RAW = os.environ["TL_ACCOUNTS"]
INGEST_URL = os.environ["INGEST_URL"]
INGEST_API_KEY = os.environ["INGEST_API_KEY"]


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
    orders_history = tl.get_orders_history()

    trades_payload = []

    for p in positions.to_dict("records") if hasattr(positions, "to_dict") else positions:
        trades_payload.append({
            "platform_trade_id": str(p.get("id") or p.get("positionId")),
            "symbol": p.get("tradableInstrumentId") or p.get("symbol"),
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

    for o in orders_history.to_dict("records") if hasattr(orders_history, "to_dict") else orders_history:
        trades_payload.append({
            "platform_trade_id": str(o.get("id") or o.get("orderId")),
            "symbol": o.get("tradableInstrumentId") or o.get("symbol"),
            "side": "buy" if str(o.get("side", "")).lower() == "buy" else "sell",
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
