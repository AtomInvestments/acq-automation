export default function StatusBadge({ status }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return { bg: '#dcfce7', text: '#15803d' };
      case 'in-progress':
        return { bg: '#dbeafe', text: '#0c4a6e' };
      case 'pending':
        return { bg: '#fef3c7', text: '#92400e' };
      default:
        return { bg: '#f3f4f6', text: '#374151' };
    }
  };

  const colors = getStatusColor(status);

  const badgeStyle = {
    display: 'inline-block',
    padding: 'var(--space-1, 0.25rem) var(--space-4, 1rem)',
    borderRadius: 'var(--radius-full, 9999px)',
    fontSize: 'var(--font-size-xs, 0.75rem)',
    fontWeight: 'var(--font-weight-semibold, 600)',
    backgroundColor: colors.bg,
    color: colors.text,
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
  };

  return (
    <span style={badgeStyle}>
      {status}
    </span>
  );
}
