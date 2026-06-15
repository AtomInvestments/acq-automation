export default function Card({ children }) {
  const cardStyle = {
    backgroundColor: 'var(--color-white, #fff)',
    borderRadius: 'var(--radius-md, 0.5rem)',
    border: '1px solid var(--color-neutral-200, #e5e7eb)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.1))',
    padding: 'var(--space-6, 1.5rem)',
  };

  return (
    <div style={cardStyle}>
      {children}
    </div>
  );
}
