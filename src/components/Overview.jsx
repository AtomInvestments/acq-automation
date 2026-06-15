import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';
import Card from './common/Card';
import StatusBadge from './common/StatusBadge';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' }
  },
};

const statCardVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.5, ease: 'easeOut' }
  },
  hover: {
    scale: 1.02,
    boxShadow: 'var(--shadow-lg)',
    transition: { duration: 0.2 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: 0.4 + i * 0.05,
      duration: 0.4,
      ease: 'easeOut',
    },
  }),
  hover: {
    backgroundColor: 'var(--color-neutral-100)',
    paddingLeft: 'var(--space-1)',
    transition: { duration: 0.2 },
  },
};

const statValueVariants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: (i) => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay: 0.5 + i * 0.1,
      duration: 0.4,
      ease: 'easeOut',
    },
  }),
};

export default function Overview() {
  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : 'var(--color-neutral-500)';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const completedCount = mockTasks.filter(t => t.status === 'completed').length;
  const inProgressCount = mockTasks.filter(t => t.status === 'in-progress').length;
  const pendingCount = mockTasks.filter(t => t.status === 'pending').length;

  const heroStyle = {
    marginBottom: 'var(--space-12)',
  };

  const greetingStyle = {
    fontSize: 'var(--font-size-4xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: '0 0 var(--space-3)',
    letterSpacing: '-0.02em',
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-lg)',
    color: 'var(--color-neutral-500)',
    margin: 0,
    fontFamily: 'var(--font-sans)',
  };

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--space-6)',
    marginBottom: 'var(--space-12)',
  };

  const statCardInnerStyle = {
    textAlign: 'center',
  };

  const statLabelStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    margin: '0 0 var(--space-3)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-weight-semibold)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const statValueStyle = {
    fontSize: 'var(--font-size-4xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-primary)',
    margin: 0,
    fontFamily: 'var(--font-sans)',
    lineHeight: 1,
  };

  const tableWrapperStyle = {
    overflowX: 'auto',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
  };

  const theadStyle = {
    backgroundColor: 'var(--color-neutral-100)',
    borderBottom: '1px solid var(--color-neutral-200)',
  };

  const thStyle = {
    padding: 'var(--space-4)',
    textAlign: 'left',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-600)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const tbodyTrStyle = {
    borderBottom: '1px solid var(--color-neutral-200)',
    transition: 'background-color var(--transition-base), padding-left var(--transition-base)',
  };

  const tdStyle = {
    padding: 'var(--space-4)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-900)',
    fontFamily: 'var(--font-sans)',
  };

  const badgeStyle = (color) => ({
    display: 'inline-block',
    padding: 'var(--space-1) var(--space-4)',
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-white)',
    backgroundColor: color,
  });

  const tableHeadingStyle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: '0 0 var(--space-6)',
  };

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
          { label: 'Total Tasks', value: mockTasks.length, color: 'var(--color-primary)' },
          { label: 'In Progress', value: inProgressCount, color: 'var(--color-info)' },
          { label: 'Completed', value: completedCount, color: 'var(--color-success)' },
          { label: 'Pending', value: pendingCount, color: 'var(--color-warning)' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            variants={statCardVariants}
            whileHover="hover"
            custom={i}
          >
            <Card>
              <div style={statCardInnerStyle}>
                <p style={statLabelStyle}>{stat.label}</p>
                <motion.p
                  style={{ ...statValueStyle, color: stat.color }}
                  variants={statValueVariants}
                  custom={i}
                  initial="hidden"
                  animate="visible"
                >
                  {stat.value}
                </motion.p>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <h2 style={tableHeadingStyle}>All Tasks</h2>
          <motion.div style={tableWrapperStyle}>
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
                    variants={rowVariants}
                    custom={i}
                    initial="hidden"
                    animate="visible"
                    whileHover="hover"
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
          </motion.div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
