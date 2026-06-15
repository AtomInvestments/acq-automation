// src/components/common/Card.jsx
import { motion } from 'framer-motion';

export default function Card({ children, className = '', onClick = null, hoverable = true }) {
  const cardStyle = {
    backgroundColor: 'var(--color-white)',
    border: '1px solid var(--color-neutral-200)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-6)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'all var(--transition-fast)',
    cursor: onClick ? 'pointer' : 'default',
  };

  const hoverStyle = hoverable ? {
    onMouseEnter: (e) => {
      e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    },
  } : {};

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={cardStyle}
      onClick={onClick}
      {...hoverStyle}
      className={className}
    >
      {children}
    </motion.div>
  );
}
