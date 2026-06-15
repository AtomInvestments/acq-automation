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
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    padding: 'var(--space-3) var(--space-6)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all var(--transition-fast)',
    opacity: disabled ? 0.5 : 1,
  };

  const variantStyle = variant === 'primary'
    ? {
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-white)',
      }
    : {
        backgroundColor: 'transparent',
        color: 'var(--color-primary)',
        border: '1px solid var(--color-primary)',
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
      whileTap={disabled ? {} : { scale: 0.95 }}
      transition={{ duration: 0.05 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
