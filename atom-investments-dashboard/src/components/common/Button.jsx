import { motion } from 'framer-motion';

export default function Button({
  children,
  variant = 'primary',
  onClick = null,
  disabled = false,
  type = 'button',
  size = 'medium',
  ...props
}) {
  const sizeStyles = {
    small: { padding: '8px 16px', fontSize: 'var(--font-size-xs)' },
    medium: { padding: '12px 28px', fontSize: 'var(--font-size-sm)' },
    large: { padding: '16px 40px', fontSize: 'var(--font-size-base)' }
  };

  const baseStyle = {
    fontFamily: 'var(--font-sans)',
    fontWeight: '700',
    border: 'none',
    borderRadius: '24px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
    opacity: disabled ? 0.4 : 1,
    letterSpacing: '0.5px',
    outline: 'none',
    position: 'relative',
    overflow: 'hidden',
    ...sizeStyles[size]
  };

  const variantStyle = {
    primary: {
      background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #8B5CF6 100%)',
      color: '#fff',
      boxShadow: '0 16px 48px rgba(245, 158, 11, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
      border: 'none',
      textShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
      fontWeight: '700'
    },
    secondary: {
      background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.15) 100%)',
      color: '#fff',
      border: '2px solid rgba(255, 255, 255, 0.4)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
      backdropFilter: 'blur(12px)'
    },
    tertiary: {
      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.2) 0%, rgba(139, 92, 246, 0.1) 100%)',
      color: '#F59E0B',
      border: '2.5px solid #F59E0B',
      boxShadow: '0 8px 20px rgba(245, 158, 11, 0.25)'
    },
    accent: {
      background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
      color: '#fff',
      boxShadow: '0 16px 48px rgba(16, 185, 129, 0.35)',
      textShadow: '0 2px 6px rgba(0, 0, 0, 0.15)'
    }
  };

  const style = { ...baseStyle, ...variantStyle[variant] };

  const handleClick = (e) => {
    if (!disabled && onClick) {
      onClick(e);
    }
  };

  return (
    <motion.button
      type={type}
      style={style}
      onClick={handleClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.92 }}
      whileHover={disabled ? {} : variant === 'primary' ? {
        boxShadow: '0 24px 64px rgba(245, 158, 11, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
        y: -4,
        scale: 1.05
      } : variant === 'secondary' ? {
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.35) 0%, rgba(255, 255, 255, 0.25) 100%)',
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
        y: -3,
        scale: 1.04
      } : variant === 'accent' ? {
        boxShadow: '0 24px 64px rgba(16, 185, 129, 0.45)',
        y: -4,
        scale: 1.05
      } : {
        background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3) 0%, rgba(139, 92, 246, 0.15) 100%)',
        boxShadow: '0 12px 32px rgba(245, 158, 11, 0.35)',
        y: -3,
        scale: 1.04
      }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
