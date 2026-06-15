// src/components/common/LoadingSkeletons.jsx
import { motion } from 'framer-motion';

const shimmer = {
  initial: { backgroundPosition: '200% center' },
  animate: { backgroundPosition: '-200% center' },
};

export default function SkeletonCard() {
  const style = {
    backgroundColor: 'var(--color-neutral-200)',
    backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
    backgroundSize: '200% 100%',
    borderRadius: 'var(--radius-md)',
    height: '120px',
    marginBottom: 'var(--space-4)',
  };

  return (
    <motion.div
      style={style}
      variants={shimmer}
      initial="initial"
      animate="animate"
      transition={{ duration: 2, repeat: Infinity }}
    />
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
