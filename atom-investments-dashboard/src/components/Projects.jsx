import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockProjects, mockTasks } from '../mockData';

export default function Projects() {
  const [selectedProject, setSelectedProject] = useState(null);

  const getProjectTasks = (projectId) => {
    return mockTasks.filter(t => t.projectId === projectId);
  };

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

  if (selectedProject) {
    const project = mockProjects.find(p => p.id === selectedProject);
    const tasks = getProjectTasks(selectedProject);

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}
      >
        <button
          onClick={() => setSelectedProject(null)}
          style={{
            marginBottom: 'var(--space-6)',
            color: 'var(--color-primary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 'var(--font-weight-semibold)',
            fontSize: 'var(--font-size-sm)',
            fontFamily: 'var(--font-sans)',
            transition: 'color var(--transition-fast)'
          }}
        >
          ← Back to Projects
        </button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
          style={{
            backgroundColor: 'white',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-6)',
            marginBottom: 'var(--space-6)',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div
              style={{
                width: '3.5rem',
                height: '3.5rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: project.color,
                boxShadow: `0 4px 12px ${project.color}30`
              }}
            ></div>
            <div>
              <h2 style={{
                fontSize: 'var(--font-size-2xl)',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)',
                marginBottom: 'var(--space-1)'
              }}>
                {project.name}
              </h2>
              <p style={{
                color: 'var(--color-secondary-text)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'var(--font-serif)'
              }}>
                Team: {project.members.join(', ')}
              </p>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
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
              <tbody>
                {tasks.map((task, idx) => {
                  const statusColor = getStatusColor(task.status);
                  return (
                    <motion.tr
                      key={task.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 + idx * 0.05 }}
                      style={{
                        borderBottom: '1px solid var(--color-border)',
                        transition: 'background-color var(--transition-base)'
                      }}
                      whileHover={{ backgroundColor: '#f9fafb' }}
                    >
                      <td style={{
                        padding: 'var(--space-4)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-primary-text)'
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
                        color: 'var(--color-secondary-text)'
                      }}>
                        {task.dueDate}
                      </td>
                      <td style={{
                        padding: 'var(--space-4)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-primary-text)'
                      }}>
                        {task.assignee}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.2 }
    }
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: 'easeOut' }
    }
  };

  return (
    <div style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <h1 style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-primary)',
          fontFamily: 'var(--font-sans)',
          marginBottom: 'var(--space-2)',
          letterSpacing: '-0.5px'
        }}>
          Projects
        </h1>
        <p style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-secondary-text)',
          fontFamily: 'var(--font-serif)'
        }}>
          Every initiative under Atom Investments. Click a card to open its roadmap.
        </p>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 'var(--space-6)'
        }}
      >
        {mockProjects.map((project) => {
          const tasks = getProjectTasks(project.id);
          const completed = tasks.filter(t => t.status === 'completed').length;
          const progressPercent = tasks.length ? (completed / tasks.length) * 100 : 0;

          return (
            <motion.div
              key={project.id}
              variants={cardVariants}
              onClick={() => setSelectedProject(project.id)}
              style={{
                backgroundColor: 'white',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-6)',
                cursor: 'pointer',
                overflow: 'hidden',
                position: 'relative'
              }}
              whileHover={{
                y: -4,
                boxShadow: 'var(--shadow-lg)',
                scale: 1.02
              }}
              transition={{ duration: 0.2 }}
            >
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '8px',
                backgroundColor: project.color
              }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
                <div
                  style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: project.color,
                    boxShadow: `0 4px 12px ${project.color}30`
                  }}
                />
                <span style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  color: 'var(--color-secondary-text)',
                  fontFamily: 'var(--font-sans)',
                  backgroundColor: '#f3f4f6',
                  padding: '0.375rem 0.75rem',
                  borderRadius: 'var(--radius-full)'
                }}>
                  {completed}/{tasks.length}
                </span>
              </div>

              <h3 style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)',
                marginBottom: 'var(--space-2)'
              }}>
                {project.name}
              </h3>

              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-secondary-text)',
                fontFamily: 'var(--font-serif)',
                marginBottom: 'var(--space-4)',
                lineHeight: '1.5'
              }}>
                {project.description}
              </p>

              <div style={{ marginBottom: 'var(--space-4)' }}>
                <p style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-secondary-text)',
                  fontFamily: 'var(--font-sans)',
                  marginBottom: 'var(--space-2)',
                  fontWeight: 'var(--font-weight-semibold)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Team
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  {project.members.slice(0, 3).map((member, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: '9999px',
                        backgroundColor: project.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 'var(--font-weight-bold)',
                        fontFamily: 'var(--font-sans)'
                      }}
                      title={member}
                    >
                      {member.split(' ').map(n => n[0]).join('')}
                    </div>
                  ))}
                  {project.members.length > 3 && (
                    <div
                      style={{
                        width: '2rem',
                        height: '2rem',
                        borderRadius: '9999px',
                        backgroundColor: '#e5e7eb',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#374151',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 'var(--font-weight-bold)',
                        fontFamily: 'var(--font-sans)'
                      }}
                      title={`+${project.members.length - 3} more`}
                    >
                      +{project.members.length - 3}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 'var(--space-6)' }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 'var(--space-2)'
                }}>
                  <span style={{
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-secondary-text)',
                    fontFamily: 'var(--font-serif)'
                  }}>
                    Progress
                  </span>
                  <span style={{
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: project.color,
                    fontFamily: 'var(--font-sans)'
                  }}>
                    {Math.round(progressPercent)}%
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '6px',
                  backgroundColor: '#e5e7eb',
                  borderRadius: '9999px',
                  overflow: 'hidden'
                }}>
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ delay: 0.3, duration: 0.6, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      backgroundColor: project.color,
                      borderRadius: '9999px'
                    }}
                  />
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
