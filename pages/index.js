export default function Home() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '3rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Trade Journal — Phase 1</h1>
      <p>Backend is live. Dashboard UI comes in Phase 1b.</p>
      <p>
        Ingest endpoint: <code>/api/ingest</code> (POST, requires <code>x-ingest-key</code> header)
      </p>
      <p>
        Health check: <a href="/api/health">/api/health</a>
      </p>
    </div>
  );
}
