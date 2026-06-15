import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';

export default function Roadmap() {
  const [selectedProject, setSelectedProject] = useState(null);

  const getTasksByDate = () => {
    const tasksByDate = {};
    mockTasks.forEach(task => {
      if (!selectedProject || task.projectId === selectedProject) {
        if (!tasksByDate[task.dueDate]) {
          tasksByDate[task.dueDate] = [];
        }
        tasksByDate[task.dueDate].push(task);
      }
    });
    return tasksByDate;
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

  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : '#6b7280';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const tasksByDate = getTasksByDate();
  const sortedDates = Object.keys(tasksByDate).sort();

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15, delayChildren: 0.3 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } }
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
          Roadmap
        </h1>
        <p style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-secondary-text)',
          fontFamily: 'var(--font-serif)'
        }}>
          Q+M→D→Task drill-down (full Google-Calendar-style view) is shipping across sessions.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <select
          value={selectedProject || ''}
          onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-sm)',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
            cursor: 'pointer',
            transition: 'all var(--transition-base)',
            backgroundColor: 'white',
            color: 'var(--color-primary-text)'
          }}
        >
          <option value="">All Projects</option>
          {mockProjects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}
      >
        {sortedDates.length > 0 ? (
          sortedDates.map((date, dateIdx) => (
            <motion.div
              key={date}
              variants={itemVariants}
              style={{
                backgroundColor: 'white',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-6)',
                boxShadow: 'var(--shadow-sm)',
                overflow: 'hidden'
              }}
            >
              <h3 style={{
                fontSize: 'var(--font-size-lg)',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)',
                marginBottom: 'var(--space-4)',
                letterSpacing: '-0.5px'
              }}>
                {new Date(date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>

              <motion.div
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: { staggerChildren: 0.1 }
                  }
                }}
                initial="hidden"
                animate="visible"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
              >
                {tasksByDate[date].map((task, taskIdx) => {
                  const statusColor = getStatusColor(task.status);
                  return (
                    <motion.div
                      key={task.id}
                      variants={{
                        hidden: { opacity: 0, x: -16 },
                        visible: {
                          opacity: 1,
                          x: 0,
                          transition: { delay: taskIdx * 0.05, duration: 0.3 }
                        }
                      }}
                      style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-sm)',
                        borderLeft: `4px solid ${getProjectColor(task.projectId)}`,
                        backgroundColor: statusColor.bg,
                        transition: 'all var(--transition-base)',
                        cursor: 'pointer'
                      }}
                      whileHover={{
                        x: 4,
                        boxShadow: 'var(--shadow-md)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{
                            fontWeight: 'var(--font-weight-medium)',
                            color: 'var(--color-primary-text)',
                            fontFamily: 'var(--font-serif)',
                            fontSize: 'var(--font-size-sm)',
                            marginBottom: 'var(--space-2)'
                          }}>
                            {task.title}
                          </p>
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            fontSize: 'var(--font-size-sm)',
                            flexWrap: 'wrap'
                          }}>
                            <span
                              style={{
                                padding: '0.375rem 0.75rem',
                                borderRadius: 'var(--radius-sm)',
                                color: 'white',
                                fontSize: 'var(--font-size-xs)',
                                fontWeight: 'var(--font-weight-medium)',
                                backgroundColor: getProjectColor(task.projectId),
                                fontFamily: 'var(--font-sans)'
                              }}
                            >
                              {getProjectName(task.projectId)}
                            </span>
                            <span style={{
                              color: 'var(--color-secondary-text)',
                              fontFamily: 'var(--font-serif)',
                              fontSize: 'var(--font-size-xs)'
                            }}>
                              {task.assignee}
                            </span>
                          </div>
                        </div>
                        <span style={{
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 'var(--font-weight-medium)',
                          padding: '0.375rem 0.75rem',
                          borderRadius: '9999px',
                          backgroundColor: statusColor.bg,
                          color: statusColor.text,
                          fontFamily: 'var(--font-sans)',
                          textTransform: 'capitalize',
                          whiteSpace: 'nowrap',
                          marginLeft: 'var(--space-3)'
                        }}>
                          {task.status}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            </motion.div>
          ))
        ) : (
          <motion.div
            variants={itemVariants}
            style={{
              backgroundColor: 'white',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-8)',
              textAlign: 'center',
              color: 'var(--color-secondary-text)',
              fontFamily: 'var(--font-serif)'
            }}
          >
            No tasks scheduled
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
