import { useState } from 'react';
import { mockUsers } from '../mockData';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e) => {
    e.preventDefault();

    const user = mockUsers[username.toLowerCase()];

    if (user && password === 'demo') {
      onLogin(user);
    } else {
      setError('Invalid credentials. Try: midom, adam, or kabrina (password: demo)');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(to bottom right, #2563eb, #1e40af)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: '28rem' }}>
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '0.5rem',
          boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
          padding: '2rem',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{ fontSize: '2.25rem', fontWeight: 'bold', color: '#111', marginBottom: '0.5rem' }}>ATOM</h1>
            <p style={{ color: '#4b5563' }}>Investments Dashboard</p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.5rem' }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="midom, adam, or kabrina"
                style={{
                  width: '100%',
                  padding: '0.5rem 1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  fontSize: '1rem',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.5rem' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  padding: '0.5rem 1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  fontSize: '1rem',
                  outline: 'none',
                }}
              />
            </div>

            {error && (
              <div style={{
                padding: '0.75rem',
                backgroundColor: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                color: '#b91c1c',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              style={{
                width: '100%',
                backgroundColor: '#2563eb',
                color: '#fff',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Sign In
            </button>
          </form>

          <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'center' }}>
              Demo Credentials:<br />
              Username: midom, adam, or kabrina<br />
              Password: demo
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
