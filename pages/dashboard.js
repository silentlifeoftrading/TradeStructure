import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import CalendarWidget from '../components/CalendarWidget';

const REFRESH_INTERVAL_MS = 60 * 1000; // re-poll the DB every 60s so the UI reflects the latest sync without a manual reload

const money = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '+';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};

const moneyPlain = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};

const pct = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const url = selectedAccountId
      ? `/api/dashboard?account_id=${selectedAccountId}`
      : '/api/dashboard';
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
        if (!selectedAccountId && d.activeAccountId) setSelectedAccountId(d.activeAccountId);
        setError(null);
        setLastUpdated(new Date());
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedAccountId, refreshTick]);

  // Auto-refresh: re-fetch on an interval so open->closed trades and new
  // syncs show up without the user manually reloading the page. This
  // reflects whatever is currently in the DB -- it doesn't make the
  // underlying TradeLocker sync itself run any more often (that's still
  // the GitHub Actions schedule).
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page">
      <style jsx global>{`
        :root {
          --bg: #0b0e14;
          --panel: #12161f;
          --panel-border: #1f2530;
          --text: #e4e7ec;
          --text-dim: #8b93a7;
          --profit: #3ecf8e;
          --loss: #f2545b;
          --accent: #e8b339;
        }
        * { box-sizing: border-box; }
        body {
          background: var(--bg);
          color: var(--text);
          margin: 0;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .mono {
          font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', Consolas, monospace;
          font-variant-numeric: tabular-nums;
        }
      `}</style>

      <div className="header">
        <div>
          <h1>Trade Journal</h1>
          <p className="subtitle">
            Phase 1b — Dashboard
            {lastUpdated && <span className="last-updated"> · updated {lastUpdated.toLocaleTimeString()}</span>}
          </p>
        </div>

        {data && data.accounts && data.accounts.length > 0 && (
          <select
            className="account-select mono"
            value={selectedAccountId || ''}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          >
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name} · {a.account_type}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading && <div className="state-msg">Loading…</div>}
      {error && <div className="state-msg error">Couldn't load data: {error}</div>}

      {!loading && !error && data && data.accounts.length === 0 && (
        <div className="empty-state">
          <p>No accounts synced yet.</p>
          <p className="text-dim">Once your GitHub Actions sync runs, accounts and trades will appear here automatically.</p>
        </div>
      )}

      {!loading && !error && data && data.summary && (
        <>
          <div className="stat-grid">
            <StatCard label="Balance" value={moneyPlain(data.summary.currentBalance)} />
            <StatCard label="Equity" value={moneyPlain(data.summary.currentEquity)} />
            <StatCard
              label="Realized P&L (confirmed)"
              value={money(data.summary.exactPnlTotal)}
              tone={data.summary.exactPnlTotal >= 0 ? 'profit' : 'loss'}
            />
            <StatCard label="Win Rate" value={pct(data.summary.winRate)} sub={`${data.summary.wins}W / ${data.summary.losses}L`} />
            <StatCard label="Max Drawdown" value={moneyPlain(-data.summary.maxDrawdown)} tone="loss" />
            <StatCard label="Open Positions" value={data.summary.openPositionsCount} />
          </div>

          {data.summary.ambiguousWindowCount > 0 && (
            <div className="notice">
              {data.summary.ambiguousWindowCount} balance window(s) had multiple trades close together
              (combined P&L: <span className="mono">{money(data.summary.ambiguousPnlTotal)}</span>) — see the
              table below for per-trade detail on those.
            </div>
          )}

          <div className="panel chart-panel">
            <h2>Balance History</h2>
            {data.balanceHistory.length < 2 ? (
              <p className="text-dim">Not enough balance history yet to chart — check back after a few more syncs.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.balanceHistory}>
                  <CartesianGrid stroke="#1f2530" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="recorded_at"
                    tickFormatter={fmtDate}
                    stroke="#8b93a7"
                    tick={{ fontSize: 11, fill: '#8b93a7' }}
                  />
                  <YAxis
                    stroke="#8b93a7"
                    tick={{ fontSize: 11, fill: '#8b93a7' }}
                    domain={['auto', 'auto']}
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#12161f', border: '1px solid #1f2530', borderRadius: 6 }}
                    labelFormatter={fmtDate}
                    formatter={(v) => [`$${Number(v).toFixed(2)}`]}
                  />
                  <Line type="monotone" dataKey="balance" stroke="#e8b339" strokeWidth={2} dot={false} name="Balance" />
                  <Line type="monotone" dataKey="equity" stroke="#3ecf8e" strokeWidth={1.5} dot={false} name="Equity" strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="panel">
            <h2>Calendar</h2>
            <CalendarWidget
              accountId={selectedAccountId}
              compact={true}
              showWeeklySummary={true}
              refreshKey={refreshTick}
            />
            <a className="cal-link" href="/calendar">Open full calendar view →</a>
          </div>

          <div className="panel">
            <h2>Trades</h2>
            {data.trades.length === 0 ? (
              <p className="text-dim">No trades synced yet for this account.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Lots</th>
                      <th>Opened</th>
                      <th>Closed</th>
                      <th>Status</th>
                      <th>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trades.map((t) => (
                      <tr key={t.id}>
                        <td className="mono">{t.symbol}</td>
                        <td>
                          <span className={`side-tag ${t.side}`}>{t.side}</span>
                        </td>
                        <td className="mono">{Number(t.lots).toFixed(2)}</td>
                        <td className="mono text-dim">{fmtDate(t.open_time)}</td>
                        <td className="mono text-dim">{fmtDate(t.close_time)}</td>
                        <td>
                          <span className={`status-tag ${t.status}`}>{t.status}</span>
                        </td>
                        <td className={`mono ${t.pnl_source === 'balance_exact' ? (Number(t.pnl) >= 0 ? 'profit' : 'loss') : 'text-dim'}`}>
                          {t.pnl_source === 'balance_exact' ? money(Number(t.pnl)) : (t.status === 'closed' ? 'unconfirmed' : '—')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <style jsx>{`
        .page {
          max-width: 1100px;
          margin: 0 auto;
          padding: 32px 24px 80px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 28px;
          flex-wrap: wrap;
          gap: 12px;
        }
        h1 {
          font-size: 22px;
          font-weight: 600;
          margin: 0;
          letter-spacing: -0.01em;
        }
        .subtitle {
          margin: 2px 0 0;
          font-size: 13px;
          color: var(--text-dim);
        }
        .last-updated {
          color: var(--text-dim);
        }
        .cal-link {
          display: inline-block;
          margin-top: 12px;
          font-size: 12px;
          color: var(--accent);
          text-decoration: none;
        }
        .account-select {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          color: var(--text);
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
        }
        .state-msg {
          padding: 40px 0;
          text-align: center;
          color: var(--text-dim);
        }
        .state-msg.error {
          color: var(--loss);
        }
        .empty-state {
          text-align: center;
          padding: 60px 20px;
        }
        .text-dim {
          color: var(--text-dim);
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .notice {
          background: rgba(232, 179, 57, 0.08);
          border: 1px solid rgba(232, 179, 57, 0.25);
          color: var(--text);
          font-size: 13px;
          padding: 10px 14px;
          border-radius: 6px;
          margin-bottom: 20px;
          line-height: 1.5;
        }
        .panel {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 20px;
        }
        .panel h2 {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 16px;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .table-wrap {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        th {
          text-align: left;
          color: var(--text-dim);
          font-weight: 500;
          padding: 8px 10px;
          border-bottom: 1px solid var(--panel-border);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.04em;
        }
        td {
          padding: 9px 10px;
          border-bottom: 1px solid rgba(31, 37, 48, 0.6);
        }
        .side-tag, .status-tag {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 4px;
          text-transform: capitalize;
        }
        .side-tag.buy { background: rgba(62, 207, 142, 0.12); color: var(--profit); }
        .side-tag.sell { background: rgba(242, 84, 91, 0.12); color: var(--loss); }
        .status-tag.open { background: rgba(232, 179, 57, 0.12); color: var(--accent); }
        .status-tag.closed { background: rgba(139, 147, 167, 0.12); color: var(--text-dim); }
        .profit { color: var(--profit); }
        .loss { color: var(--loss); }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, sub, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value mono ${tone || ''}`}>{value}</div>
      {sub && <div className="stat-sub text-dim">{sub}</div>}
      <style jsx>{`
        .stat-card {
          background: var(--panel);
          border: 1px solid var(--panel-border);
          border-radius: 10px;
          padding: 14px 16px;
        }
        .stat-label {
          font-size: 11px;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
        }
        .stat-value {
          font-size: 20px;
          font-weight: 600;
        }
        .stat-value.profit { color: var(--profit); }
        .stat-value.loss { color: var(--loss); }
        .stat-sub {
          font-size: 11px;
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}
