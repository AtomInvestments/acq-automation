import { useState } from 'react';
import { motion } from 'framer-motion';
import GlassCard from '../components/common/GlassCard';

export default function ProfilePage({ user }) {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user.name,
    email: user.email,
    role: 'Partner'
  });

  const handleSave = () => {
    setIsEditing(false);
    console.log('Profile saved:', formData);
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const premiumButtonStyle = (variant = 'primary') => ({
    padding: 'var(--space-3) var(--space-6)',
    borderRadius: '0.75rem',
    border: 'none',
    background: variant === 'primary' ? `linear-gradient(135deg, var(--color-gold-primary) 0%, var(--color-purple-primary) 100%)` : 'transparent',
    color: variant === 'primary' ? 'white' : 'var(--color-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    transition: 'all var(--duration-normal) var(--easing-fluid)',
    boxShadow: variant === 'primary' ? '0 8px 24px rgba(245, 158, 11, 0.2)' : 'none',
    backdropFilter: variant === 'primary' ? 'blur(10px)' : 'none',
    borderColor: variant === 'primary' ? 'rgba(255, 255, 255, 0.2)' : '#d1d5db'
  });

  const inputStyle = {
    width: '100%',
    padding: 'var(--space-3) var(--space-4)',
    border: '1px solid #d1d5db',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-serif)',
    fontSize: 'var(--font-size-sm)',
    transition: 'border-color 0.2s',
    backgroundColor: 'white'
  };

  return (
    <div style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
      <div style={{ maxWidth: '56rem', margin: '0 auto' }}>
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(255, 255, 255, 0.08) 100%)',
            backdropFilter: 'blur(20px)',
            border: '2px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '24px',
            padding: 'var(--space-8)',
            boxShadow: '0 16px 48px rgba(31, 41, 55, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 40px rgba(139, 92, 246, 0.15)',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Header with Avatar & Info */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
            <motion.div
              style={{
                width: '5.5rem',
                height: '5.5rem',
                background: `linear-gradient(135deg, var(--color-gold-primary) 0%, var(--color-purple-primary) 100%)`,
                borderRadius: '9999px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                flexShrink: 0,
                boxShadow: '0 12px 24px rgba(245, 158, 11, 0.2)'
              }}
              whileHover={{ scale: 1.05 }}
            >
              {formData.name.charAt(0)}
            </motion.div>

            <div style={{ flex: 1 }}>
              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--space-2)', color: 'var(--color-secondary-text)' }}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--space-2)', color: 'var(--color-secondary-text)' }}>
                      Role
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => handleChange('role', e.target.value)}
                      style={{...inputStyle, fontFamily: 'var(--font-serif)'}}
                    >
                      <option>Partner</option>
                      <option>Executive</option>
                      <option>Manager</option>
                      <option>Analyst</option>
                    </select>
                  </div>
                </div>
              ) : (
                <>
                  <h1 style={{
                    fontSize: 'var(--font-size-2xl)',
                    fontWeight: 'var(--font-weight-bold)',
                    color: 'var(--color-primary)',
                    fontFamily: 'var(--font-sans)',
                    marginBottom: 'var(--space-1)'
                  }}>
                    {formData.name}
                  </h1>
                  <p style={{
                    fontSize: 'var(--font-size-lg)',
                    color: 'var(--color-secondary-text)',
                    fontFamily: 'var(--font-serif)',
                    marginBottom: 'var(--space-4)'
                  }}>
                    {formData.role}
                  </p>
                </>
              )}
            </div>

            <button
              onClick={() => setIsEditing(!isEditing)}
              style={{...premiumButtonStyle('secondary'), padding: 'var(--space-2) var(--space-4)'}}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#f3f4f6';
                e.target.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = 'transparent';
                e.target.style.transform = 'translateY(0)';
              }}
            >
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {/* Contact Info */}
          <div style={{ paddingBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-6)' }}>
            <h3 style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-secondary-text)',
              fontFamily: 'var(--font-sans)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 'var(--space-4)'
            }}>
              Contact Information
            </h3>
            {isEditing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', marginBottom: 'var(--space-2)', color: 'var(--color-secondary-text)' }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-secondary-text)', fontFamily: 'var(--font-sans)', marginBottom: 'var(--space-1)' }}>
                    Email
                  </p>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-text)', fontFamily: 'var(--font-serif)', fontWeight: 'var(--font-weight-medium)' }}>
                    {formData.email}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-secondary-text)', fontFamily: 'var(--font-sans)', marginBottom: 'var(--space-1)' }}>
                    Access Level
                  </p>
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-primary-text)', fontFamily: 'var(--font-serif)', fontWeight: 'var(--font-weight-medium)' }}>
                    Full Access (Admin)
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {isEditing && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', gap: 'var(--space-3)' }}
            >
              <button
                onClick={handleSave}
                style={premiumButtonStyle('primary')}
                onMouseEnter={(e) => {
                  e.target.style.boxShadow = '0 8px 20px rgba(31, 41, 55, 0.2)';
                  e.target.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.boxShadow = '0 4px 12px rgba(31, 41, 55, 0.15)';
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                Save Changes
              </button>
              <button
                onClick={() => setIsEditing(false)}
                style={{...premiumButtonStyle('secondary')}}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#f3f4f6';
                  e.target.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                Cancel
              </button>
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
