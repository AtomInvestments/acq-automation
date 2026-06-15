import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';

export default function Overview() {
  const totalTasks = mockTasks.length;
  const inProgress = mockTasks.filter(t => t.status === 'in-progress').length;
  const completed = mockTasks.filter(t => t.status === 'completed').length;

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

  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : '#6b7280';
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } }
  };

  return (
    <div style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <h1 style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-primary)',
          fontFamily: 'var(--font-sans)',
          marginBottom: 'var(--space-2)',
          letterSpacing: '-0.5px'
        }}>
          Welcome, Mido
        </h1>
        <p style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-secondary-text)',
          fontFamily: 'var(--font-serif)'
        }}>
          Sunday, June 15, 2026
        </p>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--space-6)',
          marginBottom: 'var(--space-8)'
        }}
      >
        {[
          { label: 'Total Tasks', count: totalTasks, color: '#6b7280' },
          { label: 'In Progress', count: inProgress, color: '#0c4a6e' },
          { label: 'Completed', count: completed, color: '#15803d' }
        ].map((stat, idx) => (
          <motion.div
            key={idx}
            variants={itemVariants}
            style={{
              backgroundColor: 'white',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-6)',
              boxShadow: 'var(--shadow-sm)',
              transition: 'all var(--transition-base)',
              cursor: 'pointer'
            }}
            whileHover={{ boxShadow: 'var(--shadow-lg)', y: -4 }}
          >
            <p style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-secondary-text)',
              fontFamily: 'var(--font-serif)',
              marginBottom: 'var(--space-2)'
            }}>
              {stat.label}
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 + idx * 0.1, duration: 0.6 }}
              style={{
                fontSize: '2.5rem',
                fontWeight: 'var(--font-weight-bold)',
                color: stat.color,
                fontFamily: 'var(--font-sans)'
              }}
            >
              {stat.count}
            </motion.p>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4, ease: 'easeOut' }}
        style={{
          backgroundColor: 'white',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'var(--font-serif)'
          }}>
            <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid var(--color-border)' }}>
              <tr>
                <th style={{
                  padding: 'var(--space-4)',
                  textAlign: 'left',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-secondary-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>Task</th>
                <th style={{
                  padding: 'var(--space-4)',
                  textAlign: 'left',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-secondary-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>Project</th>
                <th style={{
                  padding: 'var(--space-4)',
                  textAlign: 'left',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-secondary-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>Status</th>
                <th style={{
                  padding: 'var(--space-4)',
                  textAlign: 'left',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-secondary-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>Due Date</th>
                <th style={{
                  padding: 'var(--space-4)',
                  textAlign: 'left',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-secondary-text)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>Assignee</th>
              </tr>
            </thead>
            <motion.tbody
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              {mockTasks.map((task, idx) => {
                const project = mockProjects.find(p => p.id === task.projectId);
                const statusColor = getStatusColor(task.status);
                return (
                  <motion.tr
                    key={task.id}
                    variants={{
                      hidden: { opacity: 0 },
                      visible: {
                        opacity: 1,
                        transition: { delay: 0.5 + idx * 0.05, duration: 0.3 }
                      }
                    }}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      transition: 'background-color var(--transition-base)'
                    }}
                    whileHover={{ backgroundColor: '#f9fafb' }}
                  >
                    <td style={{
                      padding: 'var(--space-4)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-primary-text)',
                      fontFamily: 'var(--font-serif)'
                    }}>
                      {task.title}
                    </td>
                    <td style={{ padding: 'var(--space-4)' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.375rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 'var(--font-weight-medium)',
                        color: 'white',
                        backgroundColor: getProjectColor(task.projectId),
                        fontFamily: 'var(--font-sans)'
                      }}>
                        {project.name}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-4)' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.375rem 0.75rem',
                        borderRadius: '9999px',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 'var(--font-weight-medium)',
                        backgroundColor: statusColor.bg,
                        color: statusColor.text,
                        fontFamily: 'var(--font-sans)',
                        textTransform: 'capitalize'
                      }}>
                        {task.status}
                      </span>
                    </td>
                    <td style={{
                      padding: 'var(--space-4)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-secondary-text)',
                      fontFamily: 'var(--font-serif)'
                    }}>
                      {task.dueDate}
                    </td>
                    <td style={{
                      padding: 'var(--space-4)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-primary-text)',
                      fontFamily: 'var(--font-serif)'
                    }}>
                      {task.assignee}
                    </td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
