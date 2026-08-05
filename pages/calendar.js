import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const money = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};

const pct = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);

const fmtTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

function monthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildGrid(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return cells;
}

export default function Calendar() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calData, setCalData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => {
        setAccounts(d.accounts || []);
        if (d.accounts && d.accounts.length > 0) setAccountId(d.activeAccountId || d.accounts[0].id);
      });
  }, []);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`/api/calendar?account_id=${accountId}&month=${month}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setCalData(d);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    setSelectedDate(null);
    setDayData(null);
  }, [accountId, month]);

  const loadDay = useCallback((date) => {
    if (!accountId) return;
    setSelectedDate(date);
    fetch(`/api/calendar?account_id=${accountId}&date=${date}`)
      .then((r) => r.json())
      .then(setDayData);
  }, [accountId]);

  const grid = buildGrid(month);

  return (
    <div className="page">
      <style jsx global>{`
        :root {
          --bg: #0b0e14; --panel: #12161f; --panel-border: #1f2530;
          --text: #e4e7ec; --text-dim: #8b93a7; --profit: #3ecf8e;
          --loss: #f2545b; --accent: #e8b339;
        }
        * { box-sizing: border-box; }
        body { background: var(--bg); color: var(--text); margin: 0; font-family: 'Inter', -apple-system, sans-serif; }
        .mono { font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', Consolas, monospace; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="header">
        <div>
          <h1>Trade Calendar</h1>
          <p className="subtitle">Daily P&L — <a href="/dashboard">back to dashboard</a></p>
        </div>
        {accounts.length > 0 && (
          <select className="account-select mono" value={accountId || ''} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name} · {a.account_type}</option>
            ))}
          </select>
        )}
      </div>

      <div className="month-nav">
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))}>&lsaquo;</button>
        <span className="month-label">{monthLabel(month)}</span>
        <button onClick={() => setMonth((m) => shiftMonth(m, 1))}>&rsaquo;</button>
      </div>

      {error && <div className="state-msg error">Couldn't load data: {error}</div>}

      {calData && (
        <div className="stat-grid">
          <StatCard label="Total Trades" value={calData.summary.totalTrades} />
          <StatCard label="P&L" value={money(calData.summary.totalPnl)} tone={calData.summary.totalPnl >= 0 ? 'profit' : 'loss'} />
          <StatCard label="Best Day" value={calData.summary.bestDay ? money(calData.summary.bestDay.pnl) : '—'} tone="profit" />
          <StatCard label="Worst Day" value={calData.summary.worstDay ? money(calData.summary.worstDay.pnl) : '—'} tone="loss" />
          <StatCard label="Win Rate" value={pct(calData.summary.winRate)} />
        </div>
      )}

      <div className="cal-grid">
        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {grid.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="cal-cell blank" />;
          const day = calData?.days?.[date];
          const dayNum = Number(date.slice(-2));
          const isSelected = date === selectedDate;
          return (
            <div
              key={date}
              className={`cal-cell ${day ? (day.pnl >= 0 ? 'profit-day' : 'loss-day') : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => loadDay(date)}
            >
              <span className="cal-daynum">{dayNum}</span>
              {day && (
                <div className="cal-daystats mono">
                  <div className={day.pnl >= 0 ? 'profit' : 'loss'}>{money(day.pnl)}</div>
                  <div className="text-dim cal-tradecount">{day.tradeCount} trade{day.tradeCount !== 1 ? 's' : ''}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <div className="panel day-detail">
          <h2>{new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          {!dayData ? (
            <p className="text-dim">Loading…</p>
          ) : dayData.trades.length === 0 ? (
            <p className="text-dim">No trades closed this day.</p>
          ) : (
            <>
              {dayData.balanceHistory.length >= 2 && (
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart data={dayData.balanceHistory}>
                    <XAxis dataKey="recorded_at" tickFormatter={fmtTime} stroke="#8b93a7" tick={{ fontSize: 10, fill: '#8b93a7' }} />
                    <YAxis stroke="#8b93a7" tick={{ fontSize: 10, fill: '#8b93a7' }} tickFormatter={(v) => `$${v.toFixed(0)}`} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#12161f', border: '1px solid #1f2530', borderRadius: 6 }}
                      labelFormatter={fmtTime}
                      formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Balance']}
                    />
                    <Line type="monotone" dataKey="balance" stroke="#e8b339" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Symbol</th><th>Side</th><th>Lots</th><th>Closed</th><th>P&L</th></tr>
                  </thead>
                  <tbody>
                    {dayData.trades.map((t) => (
                      <tr key={t.id}>
                        <td className="mono">{t.symbol}</td>
                        <td><span className={`side-tag ${t.side}`}>{t.side}</span></td>
                        <td className="mono">{Number(t.lots).toFixed(2)}</td>
                        <td className="mono text-dim">{fmtTime(t.close_time)}</td>
                        <td className={`mono ${t.pnl_source === 'balance_exact' ? (Number(t.pnl) >= 0 ? 'profit' : 'loss') : 'text-dim'}`}>
                          {t.pnl_source === 'balance_exact' ? money(Number(t.pnl)) : 'unconfirmed'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <style jsx>{`
        .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
        .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
        h1 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
        .subtitle { margin: 2px 0 0; font-size: 13px; color: var(--text-dim); }
        .subtitle a { color: var(--accent); text-decoration: none; }
        .account-select { background: var(--panel); border: 1px solid var(--panel-border); color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
        .month-nav { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
        .month-nav button { background: var(--panel); border: 1px solid var(--panel-border); color: var(--text); width: 32px; height: 32px; border-radius: 6px; cursor: pointer; font-size: 16px; }
        .month-label { font-size: 15px; font-weight: 600; min-width: 160px; }
        .state-msg.error { color: var(--loss); padding: 20px 0; }
        .text-dim { color: var(--text-dim); }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin-bottom: 20px; }
        .cal-dow { font-size: 11px; color: var(--text-dim); text-align: center; padding-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
        .cal-cell { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 8px; min-height: 74px; padding: 8px; cursor: pointer; transition: border-color 0.15s; }
        .cal-cell:hover { border-color: var(--accent); }
        .cal-cell.blank { background: transparent; border: none; cursor: default; }
        .cal-cell.selected { border-color: var(--accent); border-width: 2px; }
        .cal-cell.profit-day { background: rgba(62, 207, 142, 0.06); }
        .cal-cell.loss-day { background: rgba(242, 84, 91, 0.06); }
        .cal-daynum { font-size: 12px; color: var(--text-dim); }
        .cal-daystats { margin-top: 6px; font-size: 12px; }
        .cal-tradecount { font-size: 10px; margin-top: 2px; }
        .panel { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; padding: 20px; }
        .panel h2 { font-size: 14px; font-weight: 600; margin: 0 0 16px; }
        .table-wrap { overflow-x: auto; margin-top: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { text-align: left; color: var(--text-dim); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--panel-border); text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
        td { padding: 9px 10px; border-bottom: 1px solid rgba(31, 37, 48, 0.6); }
        .side-tag { font-size: 11px; padding: 2px 8px; border-radius: 4px; text-transform: capitalize; }
        .side-tag.buy { background: rgba(62, 207, 142, 0.12); color: var(--profit); }
        .side-tag.sell { background: rgba(242, 84, 91, 0.12); color: var(--loss); }
        .profit { color: var(--profit); }
        .loss { color: var(--loss); }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, tone }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value mono ${tone || ''}`}>{value}</div>
      <style jsx>{`
        .stat-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; padding: 14px 16px; }
        .stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
        .stat-value { font-size: 18px; font-weight: 600; }
        .stat-value.profit { color: var(--profit); }
        .stat-value.loss { color: var(--loss); }
      `}</style>
    </div>
  );
}
