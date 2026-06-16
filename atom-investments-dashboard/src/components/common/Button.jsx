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
    small: { padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--font-size-xs)' },
    medium: { padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--font-size-sm)' },
    large: { padding: 'var(--space-4) var(--space-8)', fontSize: 'var(--font-size-base)' }
  };

  const baseStyle = {
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-weight-semibold)',
    border: 'none',
    borderRadius: '0.75rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all var(--duration-normal) var(--easing-fluid)',
    opacity: disabled ? 0.6 : 1,
    letterSpacing: 'var(--letter-spacing-wide)',
    ...sizeStyles[size]
  };

  const variantStyle = {
    primary: {
      background: `linear-gradient(135deg, var(--color-gold-primary) 0%, var(--color-purple-primary) 100%)`,
      color: 'white',
      boxShadow: '0 8px 24px rgba(245, 158, 11, 0.2)',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.2)'
    },
    secondary: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      color: 'var(--color-primary)',
      border: '1px solid rgba(255, 255, 255, 0.2)',
      backdropFilter: 'blur(10px)',
      boxShadow: 'none'
    },
    tertiary: {
      backgroundColor: 'transparent',
      color: 'var(--color-gold-primary)',
      border: '2px solid var(--color-gold-primary)',
      boxShadow: 'none'
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
      whileTap={disabled ? {} : { scale: 0.97 }}
      whileHover={disabled ? {} : variant === 'primary' ? {
        boxShadow: '0 12px 32px rgba(245, 158, 11, 0.3)',
        y: -2,
        filter: 'brightness(1.1)'
      } : {
        boxShadow: '0 8px 20px rgba(31, 41, 55, 0.15)',
        y: -2,
        backgroundColor: 'rgba(255, 255, 255, 0.2)'
      }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
