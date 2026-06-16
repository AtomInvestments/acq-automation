import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';
import GlassCard from './common/GlassCard';

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
        style={{
          marginBottom: 'var(--space-8)',
          background: `linear-gradient(135deg, var(--color-gold-primary) 0%, var(--color-purple-primary) 100%)`,
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-8)',
          color: 'white',
          boxShadow: '0 16px 40px rgba(245, 158, 11, 0.2)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <h1 style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'white',
          fontFamily: 'var(--font-sans)',
          marginBottom: 'var(--space-2)',
          letterSpacing: '-0.5px'
        }}>
          Welcome, Mido
        </h1>
        <p style={{
          fontSize: 'var(--font-size-sm)',
          color: 'rgba(255, 255, 255, 0.9)',
          fontFamily: 'var(--font-serif)'
        }}>
          Sunday, June 15, 2026 • All systems operational
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
          { label: 'Total Tasks', count: totalTasks, color: '#8B5CF6', bgGradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.05) 100%)', glowColor: 'rgba(139, 92, 246, 0.3)' },
          { label: 'In Progress', count: inProgress, color: '#06B6D4', bgGradient: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(6, 182, 212, 0.05) 100%)', glowColor: 'rgba(6, 182, 212, 0.3)' },
          { label: 'Completed', count: completed, color: '#10B981', bgGradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%)', glowColor: 'rgba(16, 185, 129, 0.3)' }
        ].map((stat, idx) => (
          <motion.div
            key={idx}
            variants={itemVariants}
            style={{
              background: stat.bgGradient,
              backdropFilter: 'blur(12px)',
              border: `2px solid ${stat.color}30`,
              borderRadius: '20px',
              padding: 'var(--space-6)',
              boxShadow: `0 12px 32px ${stat.glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
              transition: 'all var(--duration-normal) var(--easing-fluid)',
              cursor: 'pointer',
              position: 'relative',
              overflow: 'hidden'
            }}
            whileHover={{
              boxShadow: `0 20px 48px ${stat.glowColor}, inset 0 1px 0 rgba(255, 255, 255, 0.15)`,
              y: -6,
              scale: 1.03
            }}
          >
            <div style={{
              position: 'absolute',
              top: '-50%',
              right: '-50%',
              width: '200px',
              height: '200px',
              background: `radial-gradient(circle, ${stat.glowColor}, transparent)`,
              borderRadius: '50%',
              pointerEvents: 'none',
              opacity: 0.3
            }} />

            <p style={{
              fontSize: 'var(--font-size-sm)',
              color: 'rgba(255, 255, 255, 0.8)',
              fontFamily: 'var(--font-serif)',
              marginBottom: 'var(--space-2)',
              fontWeight: '500',
              position: 'relative',
              zIndex: 1
            }}>
              {stat.label}
            </p>
            <motion.p
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 + idx * 0.1, duration: 0.6 }}
              style={{
                fontSize: '3rem',
                fontWeight: 'var(--font-weight-bold)',
                color: stat.color,
                fontFamily: 'var(--font-sans)',
                textShadow: `0 4px 12px ${stat.glowColor}`,
                position: 'relative',
                zIndex: 1
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
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(31, 41, 55, 0.08)'
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
                      backgroundColor: idx % 2 === 0 ? 'rgba(245, 158, 11, 0.03)' : 'transparent',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                      transition: 'background-color var(--duration-normal) var(--easing-fluid)'
                    }}
                    whileHover={{ backgroundColor: 'rgba(245, 158, 11, 0.08)' }}
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
