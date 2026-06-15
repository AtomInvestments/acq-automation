import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';
import Card from './common/Card';
import StatusBadge from './common/StatusBadge';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Overview() {
  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : '#6b7280';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const completedCount = mockTasks.filter(t => t.status === 'completed').length;
  const inProgressCount = mockTasks.filter(t => t.status === 'in-progress').length;

  const heroStyle = {
    marginBottom: 'var(--space-8, 2rem)',
  };

  const greetingStyle = {
    fontSize: 'var(--font-size-3xl, 1.875rem)',
    fontWeight: 'var(--font-weight-bold, 700)',
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
    color: 'var(--color-neutral-900, #111)',
    margin: '0 0 var(--space-2, 0.5rem)',
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-sm, 0.875rem)',
    color: 'var(--color-neutral-500, #4b5563)',
    margin: 0,
    fontFamily: 'var(--font-serif, Georgia, serif)',
  };

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 'var(--space-6, 1.5rem)',
    marginBottom: 'var(--space-8, 2rem)',
  };

  const statLabelStyle = {
    fontSize: 'var(--font-size-xs, 0.75rem)',
    color: 'var(--color-neutral-500, #4b5563)',
    margin: '0 0 var(--space-2, 0.5rem)',
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
    fontWeight: 'var(--font-weight-semibold, 600)',
  };

  const statValueStyle = {
    fontSize: 'var(--font-size-3xl, 1.875rem)',
    fontWeight: 'var(--font-weight-bold, 700)',
    color: 'var(--color-primary, #2563eb)',
    margin: 0,
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
  };

  const theadStyle = {
    backgroundColor: 'var(--color-neutral-100, #f9fafb)',
    borderBottom: '1px solid var(--color-neutral-200, #e5e7eb)',
  };

  const thStyle = {
    padding: 'var(--space-4, 1rem)',
    textAlign: 'left',
    fontSize: 'var(--font-size-xs, 0.75rem)',
    fontWeight: 'var(--font-weight-semibold, 600)',
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
    color: 'var(--color-neutral-900, #374151)',
    textTransform: 'uppercase',
  };

  const tbodyTrStyle = {
    borderBottom: '1px solid var(--color-neutral-200, #e5e7eb)',
    transition: 'background-color var(--transition-fast, 0.2s)',
  };

  const tdStyle = {
    padding: 'var(--space-4, 1rem)',
    fontSize: 'var(--font-size-sm, 0.875rem)',
    color: 'var(--color-neutral-900, #111)',
  };

  const badgeStyle = (color) => ({
    display: 'inline-block',
    padding: 'var(--space-1, 0.25rem) var(--space-4, 1rem)',
    borderRadius: 'var(--radius-full, 9999px)',
    fontSize: 'var(--font-size-xs, 0.75rem)',
    fontWeight: 'var(--font-weight-semibold, 600)',
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
    color: '#fff',
    backgroundColor: color,
  });

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div style={heroStyle} variants={itemVariants}>
        <h1 style={greetingStyle}>Welcome to ATOM</h1>
        <p style={subtitleStyle}>Monitor your projects, tasks, and team activity</p>
      </motion.div>

      <motion.div style={statsGridStyle} variants={containerVariants} initial="hidden" animate="visible">
        {[
          { label: 'Total Tasks', value: mockTasks.length },
          { label: 'In Progress', value: inProgressCount },
          { label: 'Completed', value: completedCount },
        ].map((stat, i) => (
          <motion.div key={i} variants={itemVariants}>
            <Card>
              <p style={statLabelStyle}>{stat.label}</p>
              <motion.p
                style={statValueStyle}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
              >
                {stat.value}
              </motion.p>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <h2 style={{ fontSize: 'var(--font-size-xl, 1.25rem)', fontWeight: 'var(--font-weight-bold, 700)', fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)', color: 'var(--color-neutral-900, #111)', margin: '0 0 var(--space-4, 1rem)' }}>All Tasks</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead style={theadStyle}>
                <tr>
                  <th style={thStyle}>Task</th>
                  <th style={thStyle}>Project</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Due Date</th>
                  <th style={thStyle}>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {mockTasks.map((task, i) => (
                  <motion.tr
                    key={task.id}
                    style={tbodyTrStyle}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 + i * 0.05 }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-neutral-100, #f9fafb)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={tdStyle}>{task.title}</td>
                    <td style={tdStyle}>
                      <span style={badgeStyle(getProjectColor(task.projectId))}>
                        {getProjectName(task.projectId)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={task.status} />
                    </td>
                    <td style={tdStyle}>{task.dueDate}</td>
                    <td style={tdStyle}>{task.assignee}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
