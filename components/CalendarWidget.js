import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const money = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '+';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
};

const pct = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');

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
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  return cells;
}
function isoWeekKey(dateStr) {
  const d = new Date(dateStr);
  const target = new Date(d.valueOf());
  const dayNum = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNum + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${target.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Shared calendar widget. Used identically on /dashboard (compact) and
 * /calendar (full) so the two views can never show different numbers
 * for the same data -- there's only one implementation.
 */
export default function CalendarWidget({ accountId, compact = false, showWeeklySummary = false, refreshKey = 0 }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calData, setCalData] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayData, setDayData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
  }, [accountId, month, refreshKey]);

  const loadDay = useCallback((date) => {
    if (!accountId) return;
    setSelectedDate((prev) => (prev === date ? null : date));
    if (selectedDate === date) { setDayData(null); return; }
    fetch(`/api/calendar?account_id=${accountId}&date=${date}`)
      .then((r) => r.json())
      .then(setDayData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, selectedDate]);

  const grid = buildGrid(month);

  const weeklyRows = (() => {
    if (!showWeeklySummary || !calData) return [];
    const weeks = {};
    for (const [date, d] of Object.entries(calData.days)) {
      const wk = isoWeekKey(date);
      if (!weeks[wk]) weeks[wk] = { pnl: 0, trades: 0, hasConfirmed: false };
      weeks[wk].trades += d.tradeCount;
      if (d.hasConfirmedData) {
        weeks[wk].pnl += d.pnl;
        weeks[wk].hasConfirmed = true;
      }
    }
    return Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div className="cal-widget">
      <style jsx global>{`
        :root {
          --bg: #0b0e14; --panel: #12161f; --panel-border: #1f2530;
          --text: #e4e7ec; --text-dim: #8b93a7; --profit: #3ecf8e;
          --loss: #f2545b; --accent: #e8b339;
        }
        .mono { font-family: 'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', Consolas, monospace; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="month-nav">
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))}>&lsaquo;</button>
        <span className="month-label">{monthLabel(month)}</span>
        <button onClick={() => setMonth((m) => shiftMonth(m, 1))}>&rsaquo;</button>
      </div>

      {error && <div className="err">Couldn't load calendar: {error}</div>}

      {calData?.trackingStart && new Date(month + '-01') < new Date(calData.trackingStart) && (
        <div className="tracking-note">
          P&L tracking began {new Date(calData.trackingStart).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.
          Trades before this show accurately (symbol, side, lots, time) but P&L can't be reconstructed since no balance history exists for this period.
        </div>
      )}

      {calData && !compact && (
        <div className="stat-grid">
          <MiniStat label="Total Trades" value={calData.summary.totalTrades} />
          <MiniStat label="P&L (confirmed)" value={money(calData.summary.totalPnl)} tone={calData.summary.totalPnl >= 0 ? 'profit' : 'loss'} />
          <MiniStat label="Best Day" value={calData.summary.bestDay ? money(calData.summary.bestDay.pnl) : '—'} tone="profit" />
          <MiniStat label="Worst Day" value={calData.summary.worstDay ? money(calData.summary.worstDay.pnl) : '—'} tone="loss" />
          <MiniStat label="Win Rate" value={pct(calData.summary.winRate)} />
        </div>
      )}

      <div className={`cal-grid ${compact ? 'compact' : ''}`}>
        {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {grid.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} className="cal-cell blank" />;
          const day = calData?.days?.[date];
          const dayNum = Number(date.slice(-2));
          const isSelected = date === selectedDate;
          const cellTone = day && day.hasConfirmedData ? (day.pnl >= 0 ? 'profit-day' : 'loss-day') : (day ? 'unconfirmed-day' : '');
          return (
            <div key={date} className={`cal-cell ${cellTone} ${isSelected ? 'selected' : ''}`} onClick={() => loadDay(date)}>
              <span className="cal-daynum">{dayNum}</span>
              {day && (
                <div className="cal-daystats mono">
                  {day.hasConfirmedData ? (
                    <div className={day.pnl >= 0 ? 'profit' : 'loss'}>{money(day.pnl)}</div>
                  ) : (
                    <div className="text-dim">unconfirmed</div>
                  )}
                  {!compact && <div className="text-dim cal-tradecount">{day.tradeCount} trade{day.tradeCount !== 1 ? 's' : ''}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showWeeklySummary && weeklyRows.length > 0 && (
        <div className="weekly-summary">
          <h3>Weekly Breakdown</h3>
          <table>
            <thead><tr><th>Week</th><th>Trades</th><th>P&L</th></tr></thead>
            <tbody>
              {weeklyRows.map(([wk, w]) => (
                <tr key={wk}>
                  <td className="mono text-dim">{wk}</td>
                  <td className="mono">{w.trades}</td>
                  <td className={`mono ${w.hasConfirmed ? (w.pnl >= 0 ? 'profit' : 'loss') : 'text-dim'}`}>
                    {w.hasConfirmed ? money(w.pnl) : 'unconfirmed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedDate && (
        <div className="day-detail">
          <h3>{new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          {!dayData ? (
            <p className="text-dim">Loading…</p>
          ) : dayData.trades.length === 0 ? (
            <p className="text-dim">No trades closed this day.</p>
          ) : (
            <>
              {dayData.balanceHistory.length >= 2 && (
                <ResponsiveContainer width="100%" height={120}>
                  <LineChart data={dayData.balanceHistory}>
                    <XAxis dataKey="recorded_at" tickFormatter={fmtTime} stroke="#8b93a7" tick={{ fontSize: 10, fill: '#8b93a7' }} />
                    <YAxis stroke="#8b93a7" tick={{ fontSize: 10, fill: '#8b93a7' }} tickFormatter={(v) => `$${v.toFixed(0)}`} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: '#12161f', border: '1px solid #1f2530', borderRadius: 6 }} labelFormatter={fmtTime} formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Balance']} />
                    <Line type="monotone" dataKey="balance" stroke="#e8b339" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Symbol</th><th>Side</th><th>Lots</th><th>Closed</th><th>P&L</th></tr></thead>
                  <tbody>
                    {dayData.trades.map((t) => (
                      <tr key={t.id}>
                        <td className="mono">{t.symbol}</td>
                        <td><span className={`side-tag ${t.side}`}>{t.side}</span></td>
                        <td className="mono">{Number(t.lots).toFixed(2)}</td>
                        <td className="mono text-dim">{fmtTime(t.close_time)}</td>
                        <td className={`mono ${t.pnl_source === 'balance_exact' && t.pnl !== null ? (Number(t.pnl) >= 0 ? 'profit' : 'loss') : 'text-dim'}`}>
                          {t.pnl_source === 'balance_exact' && t.pnl !== null ? money(Number(t.pnl)) : 'unconfirmed'}
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
        .cal-widget { color: var(--text); }
        .month-nav { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
        .month-nav button { background: var(--panel); border: 1px solid var(--panel-border); color: var(--text); width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 15px; }
        .month-label { font-size: 14px; font-weight: 600; min-width: 140px; }
        .err { color: var(--loss); padding: 10px 0; font-size: 13px; }
        .tracking-note { background: rgba(139, 147, 167, 0.08); border: 1px solid rgba(139, 147, 167, 0.2); color: var(--text-dim); font-size: 12px; padding: 8px 12px; border-radius: 6px; margin-bottom: 14px; line-height: 1.5; }
        .text-dim { color: var(--text-dim); }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 16px; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; margin-bottom: 16px; }
        .cal-dow { font-size: 10px; color: var(--text-dim); text-align: center; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
        .cal-cell { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 7px; min-height: 66px; padding: 6px; cursor: pointer; transition: border-color 0.15s; }
        .cal-grid.compact .cal-cell { min-height: 46px; padding: 5px; }
        .cal-cell:hover { border-color: var(--accent); }
        .cal-cell.blank { background: transparent; border: none; cursor: default; }
        .cal-cell.selected { border-color: var(--accent); border-width: 2px; }
        .cal-cell.profit-day { background: rgba(62, 207, 142, 0.06); }
        .cal-cell.loss-day { background: rgba(242, 84, 91, 0.06); }
        .cal-cell.unconfirmed-day { background: rgba(139, 147, 167, 0.04); }
        .cal-daynum { font-size: 11px; color: var(--text-dim); }
        .cal-daystats { margin-top: 4px; font-size: 11px; }
        .cal-tradecount { font-size: 10px; margin-top: 2px; }
        .weekly-summary { margin-bottom: 16px; }
        .weekly-summary h3, .day-detail h3 { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
        .day-detail { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; padding: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; color: var(--text-dim); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--panel-border); text-transform: uppercase; font-size: 10px; letter-spacing: 0.04em; }
        td { padding: 7px 8px; border-bottom: 1px solid rgba(31, 37, 48, 0.6); }
        .side-tag { font-size: 10px; padding: 2px 7px; border-radius: 4px; text-transform: capitalize; }
        .side-tag.buy { background: rgba(62, 207, 142, 0.12); color: var(--profit); }
        .side-tag.sell { background: rgba(242, 84, 91, 0.12); color: var(--loss); }
        .profit { color: var(--profit); }
        .loss { color: var(--loss); }
        .table-wrap { overflow-x: auto; margin-top: 12px; }
      `}</style>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div className="mini-stat">
      <div className="mini-label">{label}</div>
      <div className={`mini-value mono ${tone || ''}`}>{value}</div>
      <style jsx>{`
        .mini-stat { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 8px; padding: 10px 12px; }
        .mini-label { font-size: 10px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
        .mini-value { font-size: 16px; font-weight: 600; }
        .mini-value.profit { color: var(--profit); }
        .mini-value.loss { color: var(--loss); }
      `}</style>
    </div>
  );
}
