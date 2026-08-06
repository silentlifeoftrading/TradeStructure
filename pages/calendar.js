import { useState, useEffect } from 'react';
import CalendarWidget from '../components/CalendarWidget';

export default function CalendarPage() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => {
        setAccounts(d.accounts || []);
        if (d.accounts && d.accounts.length > 0) setAccountId(d.activeAccountId || d.accounts[0].id);
      });
  }, []);

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
      `}</style>

      <div className="header">
        <div>
          <h1>Trade Calendar</h1>
          <p className="subtitle">Daily P&L — <a href="/dashboard">back to dashboard</a></p>
        </div>
        {accounts.length > 0 && (
          <select className="account-select" value={accountId || ''} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name} · {a.account_type}</option>
            ))}
          </select>
        )}
      </div>

      {accountId && <CalendarWidget accountId={accountId} compact={false} showWeeklySummary={true} />}

      <style jsx>{`
        .page { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; }
        .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
        h1 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
        .subtitle { margin: 2px 0 0; font-size: 13px; color: var(--text-dim); }
        .subtitle a { color: var(--accent); text-decoration: none; }
        .account-select { background: var(--panel); border: 1px solid var(--panel-border); color: var(--text); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
      `}</style>
    </div>
  );
}
