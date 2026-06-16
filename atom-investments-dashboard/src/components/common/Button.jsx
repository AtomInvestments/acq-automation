// src/components/common/Button.jsx
import { motion } from 'framer-motion';

export default function Button({
  children,
  variant = 'primary',
  onClick = null,
  disabled = false,
  type = 'button',
  ...props
}) {
  const baseStyle = {
    fontFamily: 'var(--font-serif)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    padding: 'var(--space-3) var(--space-6)',
    border: '1px solid transparent',
    borderRadius: '0.5rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
    opacity: disabled ? 0.6 : 1,
    letterSpacing: '0.3px',
  };

  const variantStyle = variant === 'primary'
    ? {
        backgroundColor: 'var(--color-primary)',
        color: 'white',
        borderColor: 'var(--color-primary)',
        boxShadow: '0 4px 12px rgba(31, 41, 55, 0.15)',
      }
    : {
        backgroundColor: 'transparent',
        color: 'var(--color-primary)',
        borderColor: '#d1d5db',
        boxShadow: 'none',
      };

  const style = { ...baseStyle, ...variantStyle };

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
      whileTap={disabled ? {} : { scale: 0.98 }}
      whileHover={disabled ? {} : variant === 'primary'
        ? {
            boxShadow: '0 8px 20px rgba(31, 41, 55, 0.2)',
            y: -2
          }
        : {
            backgroundColor: '#f3f4f6',
            borderColor: 'var(--color-primary)',
            y: -2
          }
      }
      transition={{ duration: 0.2 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
