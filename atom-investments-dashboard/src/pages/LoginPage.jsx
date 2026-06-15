// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase, signInWithGitHub } from '../supabaseConfig';
import { mockUsers } from '../mockData';
import Button from '../components/common/Button';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
      const { error: authError } = await signInWithGitHub();
      if (authError) throw authError;
    } catch (err) {
      setError(err.message || 'GitHub login failed');
      setIsLoading(false);
    }
  };

  const handleLogin = async () => {
    setIsLoading(true);
    setError('');

    try {
      // Check mock auth first (always works as fallback)
      let mockUser = null;

      // Try exact username match
      mockUser = mockUsers[email.toLowerCase()];

      // Try by email address
      if (!mockUser) {
        mockUser = Object.values(mockUsers).find(u => u.email.toLowerCase() === email.toLowerCase());
      }

      // Try extracting username from email (mido from mido@...)
      if (!mockUser && email.includes('@')) {
        const username = email.split('@')[0].toLowerCase();
        mockUser = mockUsers[username];
      }

      // If mock user found and password is 'demo', log in immediately
      if (mockUser && password === 'demo') {
        console.log('Mock login successful:', mockUser);
        onLogin(mockUser);
        return;
      }

      // Otherwise try Supabase
      if (supabase) {
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
      } else {
        setError('No valid credentials. Try: midom, adam, or kabrina (password: demo)');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message || 'Login failed. Try: midom, adam, or kabrina (password: demo)');
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

  const containerStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1f2937 0%, #374151 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-4)',
  };

  const cardStyle = {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-8)',
    boxShadow: 'var(--shadow-xl)',
  };

  const logoStyle = {
    textAlign: 'center',
    marginBottom: 'var(--space-8)',
  };

  const logoTextStyle = {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-primary)',
    margin: '0 0 var(--space-2) 0',
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    margin: 0,
    fontFamily: 'var(--font-serif)',
  };

  const dividerStyle = {
    height: '1px',
    backgroundColor: 'var(--color-neutral-200)',
    margin: 'var(--space-6) 0',
  };

  const formStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  };

  const inputWrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  };

  const labelStyle = {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
  };

  const inputStyle = {
    border: '1px solid var(--color-neutral-200)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-2) var(--space-4)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-serif)',
    transition: 'border-color var(--transition-fast)',
  };

  const errorStyle = {
    padding: 'var(--space-3)',
    backgroundColor: 'var(--color-status-pending-bg)',
    border: '1px solid var(--color-status-pending-text)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-status-pending-text)',
    fontFamily: 'var(--font-sans)',
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
  };

  return (
    <div style={containerStyle}>
      <motion.div
        style={cardStyle}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
      >
        <motion.div style={logoStyle} variants={containerVariants} initial="hidden" animate="visible">
          <motion.h1 style={logoTextStyle} variants={itemVariants}>
            ATOM
          </motion.h1>
          <motion.p style={subtitleStyle} variants={itemVariants}>
            Investments Dashboard
          </motion.p>
        </motion.div>

        {supabase && (
          <motion.div variants={itemVariants} initial="hidden" animate="visible">
            <Button
              onClick={handleGitHubLogin}
              disabled={isLoading}
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in...' : 'Sign in with GitHub'}
            </Button>
            <div style={dividerStyle} />
          </motion.div>
        )}

        <div style={formStyle}>
          <motion.div style={inputWrapperStyle} variants={itemVariants} initial="hidden" animate="visible">
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="mido@atominvestments.com"
              disabled={isLoading}
              style={{ ...inputStyle, opacity: isLoading ? 0.7 : 1 }}
            />
          </motion.div>

          <motion.div style={inputWrapperStyle} variants={itemVariants} initial="hidden" animate="visible">
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="demo"
              disabled={isLoading}
              style={{ ...inputStyle, opacity: isLoading ? 0.7 : 1 }}
            />
          </motion.div>

          {error && (
            <motion.div style={errorStyle} variants={itemVariants} initial="hidden" animate="visible">
              {error}
            </motion.div>
          )}

          <motion.div variants={itemVariants} initial="hidden" animate="visible">
            <button
              type="button"
              onClick={handleLogin}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: 'var(--space-3) var(--space-6)',
                backgroundColor: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-semibold)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.6 : 1,
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => !isLoading && (e.target.style.opacity = '0.9')}
              onMouseLeave={(e) => !isLoading && (e.target.style.opacity = '1')}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </motion.div>
        </div>

        {!supabase && (
          <motion.div
            style={{
              marginTop: 'var(--space-6)',
              paddingTop: 'var(--space-6)',
              borderTop: '1px solid var(--color-neutral-200)',
              textAlign: 'center',
            }}
            variants={itemVariants}
            initial="hidden"
            animate="visible"
          >
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-neutral-500)', margin: 'var(--space-2) 0' }}>
              ⚠️ Mock Demo Mode (Supabase not configured)
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-neutral-500)', margin: 0 }}>
              Username: midom, adam, or kabrina<br />
              Password: demo
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
