export default function ProfilePage({ user }) {
  return (
    <div style={{ maxWidth: '56rem', margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '0.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        padding: '2rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1.5rem' }}>
          <div style={{
            width: '6rem',
            height: '6rem',
            backgroundColor: '#3b82f6',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: '3rem',
            fontWeight: 'bold',
            flexShrink: 0,
          }}>
            {user.name.charAt(0)}
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111' }}>{user.name}</h1>
            <p style={{ fontSize: '1.125rem', color: '#4b5563', marginTop: '0.25rem' }}>{user.role}</p>
            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div>
                <span style={{ color: '#4b5563' }}>Email:</span>
                <p style={{ color: '#111', fontWeight: 500 }}>{user.email}</p>
              </div>
              <div>
                <span style={{ color: '#4b5563' }}>Access Level:</span>
                <p style={{ color: '#111', fontWeight: 500 }}>Full Access (Admin)</p>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#111', marginBottom: '1rem' }}>Account Settings</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: '0.375rem',
            }}>
              <div>
                <p style={{ fontWeight: 500, color: '#111' }}>Notifications</p>
                <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>Receive task updates and project alerts</p>
              </div>
              <input type="checkbox" defaultChecked style={{ width: '1.25rem', height: '1.25rem' }} />
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1rem',
              border: '1px solid #e5e7eb',
              borderRadius: '0.375rem',
            }}>
              <div>
                <p style={{ fontWeight: 500, color: '#111' }}>Email Digest</p>
                <p style={{ fontSize: '0.875rem', color: '#4b5563' }}>Weekly summary of all projects</p>
              </div>
              <input type="checkbox" defaultChecked style={{ width: '1.25rem', height: '1.25rem' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
