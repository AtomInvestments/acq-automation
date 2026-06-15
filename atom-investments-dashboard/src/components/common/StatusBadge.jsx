// src/components/common/StatusBadge.jsx

export default function StatusBadge({ status }) {
  const statusMap = {
    completed: {
      bg: 'var(--color-status-completed-bg)',
      text: 'var(--color-status-completed-text)',
      label: 'Completed',
    },
    'in-progress': {
      bg: 'var(--color-status-progress-bg)',
      text: 'var(--color-status-progress-text)',
      label: 'In Progress',
    },
    pending: {
      bg: 'var(--color-status-pending-bg)',
      text: 'var(--color-status-pending-text)',
      label: 'Pending',
    },
  };

  const statusData = statusMap[status] || statusMap.pending;

  const style = {
    display: 'inline-block',
    backgroundColor: statusData.bg,
    color: statusData.text,
    padding: 'var(--space-1) var(--space-4)',
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
  };

  return <span style={style}>{statusData.label}</span>;
}
