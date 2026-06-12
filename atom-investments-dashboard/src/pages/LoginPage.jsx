import { useState, useEffect } from 'react';
import { supabase, signInWithGitHub } from '../supabaseConfig';
import { mockUsers } from '../mockData';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useMock, setUseMock] = useState(!supabase);

  // Check for existing session
  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          onLogin({
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email,
            email: session.user.email,
            role: 'User',
          });
        }
      });
    }
  }, [onLogin]);

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const { data, error: authError } = await signInWithGitHub();
      if (authError) throw authError;
    } catch (err) {
      setError(err.message || 'GitHub login failed');
      setIsLoading(false);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      if (data?.user) {
        onLogin({
          id: data.user.id,
          name: data.user.user_metadata?.name || email,
          email: data.user.email,
          role: 'User',
        });
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMockLogin = (e) => {
    e.preventDefault();
    const user = mockUsers[email.toLowerCase()];

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

          {supabase && (
            <div style={{ marginBottom: '1.5rem' }}>
              <button
                onClick={handleGitHubLogin}
                disabled={isLoading}
                style={{
                  width: '100%',
                  backgroundColor: '#1f2937',
                  color: '#fff',
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                {isLoading ? 'Signing in...' : 'Sign in with GitHub'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '1rem 0' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
                <span style={{ color: '#9ca3af', fontSize: '0.875rem' }}>or</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
              </div>
            </div>
          )}

          <form onSubmit={useMock ? handleMockLogin : handleEmailLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.5rem' }}>
                {useMock ? 'Username' : 'Email'}
              </label>
              <input
                type={useMock ? 'text' : 'email'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={useMock ? 'midom, adam, or kabrina' : 'you@example.com'}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '0.5rem 1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  fontSize: '1rem',
                  outline: 'none',
                  opacity: isLoading ? 0.7 : 1,
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
                placeholder={useMock ? 'demo' : '••••••••'}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '0.5rem 1rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  fontSize: '1rem',
                  outline: 'none',
                  opacity: isLoading ? 0.7 : 1,
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
              disabled={isLoading}
              style={{
                width: '100%',
                backgroundColor: isLoading ? '#9ca3af' : '#2563eb',
                color: '#fff',
                padding: '0.5rem',
                borderRadius: '0.375rem',
                fontWeight: 500,
                border: 'none',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
              }}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {!supabase && (
            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid #e5e7eb' }}>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'center', marginBottom: '0.5rem' }}>
                ⚠️ Mock Demo Mode (Supabase not configured)
              </p>
              <p style={{ fontSize: '0.75rem', color: '#6b7280', textAlign: 'center' }}>
                Username: midom, adam, or kabrina<br />
                Password: demo<br />
                <br />
                For real authentication, see SUPABASE_SETUP.md
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
