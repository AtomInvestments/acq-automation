import { motion } from 'framer-motion';

export default function GlassCard({
  children,
  hover = true,
  animated = true,
  gradient = false,
  ...props
}) {
  const baseStyle = {
    background: gradient
      ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.05) 100%)'
      : 'rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(15px)',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
    boxShadow: '0 8px 32px rgba(31, 41, 55, 0.1)',
    transition: 'all var(--duration-normal) var(--easing-fluid)'
  };

  const Component = animated ? motion.div : 'div';

  return (
    <Component
      style={baseStyle}
      whileHover={hover ? {
        boxShadow: '0 16px 48px rgba(31, 41, 55, 0.15)',
        y: -4,
        scale: 1.02
      } : {}}
      initial={animated ? { opacity: 0, y: 20 } : undefined}
      animate={animated ? { opacity: 1, y: 0 } : undefined}
      transition={animated ? { duration: 0.4, ease: 'easeOut' } : undefined}
      {...props}
    >
      {children}
    </Component>
  );
}
