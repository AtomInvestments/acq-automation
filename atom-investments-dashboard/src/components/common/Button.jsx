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
    small: { padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--font-size-xs)' },
    medium: { padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--font-size-sm)' },
    large: { padding: 'var(--space-4) var(--space-8)', fontSize: 'var(--font-size-base)' }
  };

  const baseStyle = {
    fontFamily: 'var(--font-sans)',
    fontWeight: '600',
    border: 'none',
    borderRadius: '8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
    opacity: disabled ? 0.5 : 1,
    letterSpacing: '0.4px',
    outline: 'none',
    ...sizeStyles[size]
  };

  const variantStyle = {
    primary: {
      background: 'linear-gradient(135deg, #F59E0B 0%, #8B5CF6 100%)',
      color: '#fff',
      boxShadow: '0 12px 32px rgba(245, 158, 11, 0.3)',
      border: 'none',
      textShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
    },
    secondary: {
      background: 'rgba(255, 255, 255, 0.15)',
      color: '#fff',
      border: '1.5px solid rgba(255, 255, 255, 0.3)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      backdropFilter: 'blur(8px)'
    },
    tertiary: {
      backgroundColor: 'transparent',
      color: '#F59E0B',
      border: '2px solid #F59E0B',
      boxShadow: 'none',
      background: 'rgba(245, 158, 11, 0.08)'
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
      whileTap={disabled ? {} : { scale: 0.96 }}
      whileHover={disabled ? {} : variant === 'primary' ? {
        boxShadow: '0 18px 48px rgba(245, 158, 11, 0.4)',
        y: -3,
        transform: 'scale(1.02)'
      } : variant === 'secondary' ? {
        background: 'rgba(255, 255, 255, 0.25)',
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.15)',
        y: -2
      } : {
        background: 'rgba(245, 158, 11, 0.15)',
        boxShadow: '0 6px 16px rgba(245, 158, 11, 0.2)',
        y: -2
      }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
