import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';
import StatusBadge from './common/StatusBadge';

// Animation variants
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

const dateHeaderVariants = {
  hidden: { opacity: 0, y: -10, scale: 0.95 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: 0.2 + i * 0.1,
      duration: 0.5,
      ease: 'easeOut'
    }
  }),
};

const taskVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.4,
      ease: 'easeOut'
    }
  }),
  hover: {
    boxShadow: 'var(--shadow-md)',
    x: 4,
    transition: { duration: 0.2 },
  },
};

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
        return { bg: 'var(--color-success-light)', text: 'var(--color-success-dark)', border: 'var(--color-success)' };
      case 'in-progress':
        return { bg: 'var(--color-info-light)', text: 'var(--color-info-dark)', border: 'var(--color-info)' };
      case 'pending':
        return { bg: 'var(--color-warning-light)', text: 'var(--color-warning-dark)', border: 'var(--color-warning)' };
      default:
        return { bg: 'var(--color-neutral-100)', text: 'var(--color-neutral-600)', border: 'var(--color-neutral-300)' };
    }
  };

  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : 'var(--color-neutral-500)';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const tasksByDate = getTasksByDate();
  const sortedDates = Object.keys(tasksByDate).sort();

  // Styles using design tokens
  const headerContainerStyle = {
    marginBottom: 'var(--space-8)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    margin: 0,
  };

  const filterSelectStyle = {
    padding: 'var(--space-2) var(--space-4)',
    border: '1px solid var(--color-neutral-200)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-900)',
    backgroundColor: 'var(--color-white)',
    cursor: 'pointer',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    transition: 'all var(--transition-base)',
    outline: 'none',
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-6)',
  };

  const dateGroupStyle = {
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-6)',
    borderTop: '4px solid',
  };

  const dateHeaderStyle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    marginBottom: 'var(--space-4)',
    margin: 0,
  };

  const tasksListStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  };

  const taskCardStyle = (projectColor, statusBg) => ({
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-md)',
    borderLeft: `3px solid ${projectColor}`,
    backgroundColor: statusBg,
    transition: 'all var(--transition-base)',
  });

  const taskHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 'var(--space-4)',
  };

  const taskTitleStyle = {
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-neutral-900)',
    margin: 0,
    fontSize: 'var(--font-size-base)',
  };

  const taskMetaStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginTop: 'var(--space-2)',
    fontSize: 'var(--font-size-sm)',
    flexWrap: 'wrap',
  };

  const projectBadgeStyle = (projectColor) => ({
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-white)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    backgroundColor: projectColor,
    display: 'inline-block',
  });

  const assigneeStyle = {
    color: 'var(--color-neutral-500)',
    fontSize: 'var(--font-size-sm)',
  };

  const emptyStateStyle = {
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-8)',
    textAlign: 'center',
    color: 'var(--color-neutral-500)',
    fontSize: 'var(--font-size-base)',
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div style={headerContainerStyle}>
        <h2 style={titleStyle}>Roadmap</h2>
        <motion.select
          value={selectedProject || ''}
          onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
          style={filterSelectStyle}
          whileFocus={{ boxShadow: 'var(--shadow-md), 0 0 0 3px var(--color-primary-light)' }}
        >
          <option value="">All Projects</option>
          {mockProjects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </motion.select>
      </motion.div>

      <motion.div style={containerStyle} variants={containerVariants} initial="hidden" animate="visible">
        {sortedDates.length > 0 ? (
          sortedDates.map((date, dateIdx) => {
            const dateObj = new Date(date);
            const formattedDate = dateObj.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            });
            const dateColor = dateObj.getTime() < new Date().getTime() ? 'var(--color-neutral-300)' : 'var(--color-primary)';

            return (
              <motion.div
                key={date}
                style={{ ...dateGroupStyle, borderTopColor: dateColor }}
                variants={dateHeaderVariants}
                custom={dateIdx}
              >
                <motion.h3
                  style={dateHeaderStyle}
                  variants={dateHeaderVariants}
                  custom={dateIdx}
                >
                  {formattedDate}
                </motion.h3>

                <motion.div
                  style={tasksListStyle}
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {tasksByDate[date].map((task, taskIdx) => {
                    const statusColor = getStatusColor(task.status);
                    const projectColor = getProjectColor(task.projectId);

                    return (
                      <motion.div
                        key={task.id}
                        style={taskCardStyle(projectColor, statusColor.bg)}
                        variants={taskVariants}
                        custom={taskIdx}
                        whileHover="hover"
                      >
                        <div style={taskHeaderStyle}>
                          <div style={{ flex: 1 }}>
                            <p style={taskTitleStyle}>{task.title}</p>
                            <div style={taskMetaStyle}>
                              <span style={projectBadgeStyle(projectColor)}>
                                {getProjectName(task.projectId)}
                              </span>
                              <span style={assigneeStyle}>{task.assignee}</span>
                            </div>
                          </div>
                          <StatusBadge status={task.status} />
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </motion.div>
            );
          })
        ) : (
          <motion.div
            style={emptyStateStyle}
            variants={dateHeaderVariants}
            custom={0}
          >
            No tasks scheduled
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
