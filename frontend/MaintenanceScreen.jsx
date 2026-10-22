export default function MaintenanceScreen() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: '24px',
    }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🛠️</div>
        <h1 style={{ fontSize: 22, marginBottom: 12, color: '#f8fafc' }}>PackTrack Pro is under maintenance</h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#cbd5e1', marginBottom: 12 }}>
          Our hosting provider (Railway) reported a security incident affecting stored credentials.
          As a precaution, we've taken PackTrack Pro offline while we rotate every affected credential
          and confirm everything is secure.
        </p>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: '#cbd5e1', marginBottom: 12 }}>
          <strong>No action is needed from you.</strong> No PackTrack data was exposed through this app directly —
          this is a precaution tied to our infrastructure provider's incident, not a breach of PackTrack itself.
        </p>
        <p style={{ fontSize: 14, color: '#94a3b8' }}>
          We expect to be back shortly. Please check back soon, or reach out to your PackTrack admin for updates.
        </p>
      </div>
    </div>
  );
}
