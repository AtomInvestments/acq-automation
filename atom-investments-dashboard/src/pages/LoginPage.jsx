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
      let mockUser = null;

      mockUser = mockUsers[email.toLowerCase()];

      if (!mockUser) {
        mockUser = Object.values(mockUsers).find(u => u.email.toLowerCase() === email.toLowerCase());
      }

      if (!mockUser && email.includes('@')) {
        const username = email.split('@')[0].toLowerCase();
        mockUser = mockUsers[username];
      }

      if (mockUser && password === 'demo') {
        console.log('Mock login successful:', mockUser);
        onLogin(mockUser);
        return;
      }

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

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.3,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, var(--color-gold-primary) 0%, var(--color-purple-primary) 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-4)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute',
        width: '400px',
        height: '400px',
        background: `radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)`,
        borderRadius: '50%',
        top: '-100px',
        right: '-100px',
        pointerEvents: 'none'
      }} />

      <motion.div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(20px)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-8)',
          boxShadow: '0 20px 60px rgba(31, 41, 55, 0.2)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          position: 'relative',
          zIndex: 10
        }}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <motion.div
          style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants} style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{
              width: '64px',
              height: '64px',
              margin: '0 auto var(--space-4)',
              background: `linear-gradient(135deg, white, rgba(255,255,255,0.8))`,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              fontWeight: 'var(--font-weight-bold)',
              color: 'var(--color-gold-primary)',
              boxShadow: '0 12px 24px rgba(245, 158, 11, 0.2)'
            }}>
              ⚛
            </div>
          </motion.div>

          <motion.h1 variants={itemVariants} style={{
            fontSize: 'var(--font-size-3xl)',
            fontWeight: 'var(--font-weight-bold)',
            fontFamily: 'var(--font-sans)',
            color: 'white',
            margin: '0 0 var(--space-2) 0',
            letterSpacing: 'var(--letter-spacing-tight)'
          }}>
            ATOM
          </motion.h1>

          <motion.p variants={itemVariants} style={{
            fontSize: 'var(--font-size-sm)',
            color: 'rgba(255, 255, 255, 0.9)',
            margin: 0,
            fontFamily: 'var(--font-serif)',
            fontWeight: '500'
          }}>
            Investments Dashboard
          </motion.p>
        </motion.div>

        {supabase && (
          <motion.div variants={itemVariants} initial="hidden" animate="visible" style={{ marginBottom: 'var(--space-6)' }}>
            <Button
              onClick={handleGitHubLogin}
              disabled={isLoading}
              variant="secondary"
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in...' : 'Sign in with GitHub'}
            </Button>

            <div style={{
              height: '1px',
              background: 'rgba(255, 255, 255, 0.2)',
              margin: 'var(--space-6) 0',
              position: 'relative'
            }}>
              <span style={{
                position: 'absolute',
                top: '-10px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: `linear-gradient(135deg, var(--color-gold-primary) 0%, var(--color-purple-primary) 100%)`,
                color: 'white',
                fontSize: 'var(--font-size-xs)',
                padding: '0 var(--space-2)',
                fontFamily: 'var(--font-sans)',
                fontWeight: 'var(--font-weight-semibold)'
              }}>
                OR
              </span>
            </div>
          </motion.div>
        )}

        <motion.div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} variants={itemVariants}>
            <label style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              fontFamily: 'var(--font-sans)',
              color: 'rgba(255, 255, 255, 0.9)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--letter-spacing-wide)'
            }}>
              Email or Username
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="midom"
              disabled={isLoading}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'var(--font-serif)',
                color: 'white',
                backdropFilter: 'blur(10px)',
                transition: 'all var(--duration-normal) var(--easing-fluid)',
                opacity: isLoading ? 0.6 : 1
              }}
              onFocus={(e) => {
                e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                e.target.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.2)';
              }}
              onBlur={(e) => {
                e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </motion.div>

          <motion.div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} variants={itemVariants}>
            <label style={{
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              fontFamily: 'var(--font-sans)',
              color: 'rgba(255, 255, 255, 0.9)',
              textTransform: 'uppercase',
              letterSpacing: 'var(--letter-spacing-wide)'
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              disabled={isLoading}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-3) var(--space-4)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'var(--font-serif)',
                color: 'white',
                backdropFilter: 'blur(10px)',
                transition: 'all var(--duration-normal) var(--easing-fluid)',
                opacity: isLoading ? 0.6 : 1
              }}
              onFocus={(e) => {
                e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                e.target.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.2)';
              }}
              onBlur={(e) => {
                e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                e.target.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                e.target.style.boxShadow = 'none';
              }}
            />
          </motion.div>

          {error && (
            <motion.div variants={itemVariants} style={{
              padding: 'var(--space-3) var(--space-4)',
              backgroundColor: 'rgba(220, 38, 38, 0.2)',
              border: '1px solid rgba(220, 38, 38, 0.5)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-xs)',
              color: '#fecaca',
              fontFamily: 'var(--font-sans)',
              backdropFilter: 'blur(10px)'
            }}>
              ⚠️ {error}
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <Button
              onClick={handleLogin}
              disabled={isLoading}
              variant="primary"
              size="large"
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </motion.div>
        </motion.div>

        {!supabase && (
          <motion.div
            style={{
              marginTop: 'var(--space-6)',
              paddingTop: 'var(--space-6)',
              borderTop: '1px solid rgba(255, 255, 255, 0.2)',
              textAlign: 'center',
            }}
            variants={itemVariants}
            initial="hidden"
            animate="visible"
          >
            <p style={{
              fontSize: 'var(--font-size-xs)',
              color: 'rgba(255, 255, 255, 0.8)',
              margin: 'var(--space-2) 0',
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--font-weight-semibold)'
            }}>
              Demo Mode
            </p>
            <p style={{
              fontSize: 'var(--font-size-xs)',
              color: 'rgba(255, 255, 255, 0.7)',
              margin: 0,
              fontFamily: 'var(--font-serif)',
              lineHeight: '1.6'
            }}>
              Try: <strong>midom</strong>, <strong>adam</strong>, or <strong>kabrina</strong><br />
              Password: <strong>demo</strong>
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
