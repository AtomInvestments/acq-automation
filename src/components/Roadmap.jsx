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
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const dateHeaderVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const taskVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: 'easeOut' } },
};

// Design tokens
const tokens = {
  space: {
    1: '0.25rem',
    2: '0.5rem',
    4: '1rem',
    6: '1.5rem',
    8: '2rem',
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
  },
  fontWeight: {
    normal: 400,
    semibold: 600,
    bold: 700,
  },
  color: {
    neutral: {
      50: '#f9fafb',
      100: '#f3f4f6',
      200: '#e5e7eb',
      500: '#4b5563',
      900: '#111',
    },
    primary: '#2563eb',
    white: '#fff',
  },
  radius: {
    sm: '0.25rem',
    md: '0.5rem',
    full: '9999px',
  },
  shadow: {
    sm: '0 1px 3px rgba(0,0,0,0.1)',
    md: '0 4px 6px rgba(0,0,0,0.1)',
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
        return { bg: '#dcfce7', text: '#15803d', border: '#86efac' };
      case 'in-progress':
        return { bg: '#dbeafe', text: '#0c4a6e', border: '#7dd3fc' };
      case 'pending':
        return { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' };
      default:
        return { bg: '#f3f4f6', text: '#374151', border: '#d1d5db' };
    }
  };

  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : tokens.color.neutral[500];
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const tasksByDate = getTasksByDate();
  const sortedDates = Object.keys(tasksByDate).sort();

  // Styles using design tokens
  const headerContainerStyle = {
    marginBottom: tokens.space[6],
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const titleStyle = {
    fontSize: tokens.fontSize['3xl'],
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.neutral[900],
    margin: 0,
  };

  const filterSelectStyle = {
    padding: `${tokens.space[2]} ${tokens.space[4]}`,
    border: `1px solid ${tokens.color.neutral[200]}`,
    borderRadius: tokens.radius.md,
    fontSize: tokens.fontSize.sm,
    color: tokens.color.neutral[900],
    backgroundColor: tokens.color.white,
    cursor: 'pointer',
    fontWeight: tokens.fontWeight.semibold,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    outline: 'none',
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.space[6],
  };

  const dateGroupStyle = {
    backgroundColor: tokens.color.white,
    borderRadius: tokens.radius.md,
    boxShadow: tokens.shadow.sm,
    padding: tokens.space[6],
  };

  const dateHeaderStyle = {
    fontSize: tokens.fontSize.lg,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.neutral[900],
    marginBottom: tokens.space[4],
    margin: 0,
  };

  const tasksListStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.space[2],
  };

  const taskCardStyle = (projectColor, statusBg) => ({
    padding: tokens.space[4],
    borderRadius: tokens.radius.sm,
    borderLeft: `4px solid ${projectColor}`,
    backgroundColor: statusBg,
    transition: 'all 0.2s',
  });

  const taskHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: tokens.space[4],
  };

  const taskTitleStyle = {
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.neutral[900],
    margin: 0,
    fontSize: tokens.fontSize.md,
  };

  const taskMetaStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.space[2],
    marginTop: tokens.space[2],
    fontSize: tokens.fontSize.sm,
    flexWrap: 'wrap',
  };

  const projectBadgeStyle = (projectColor) => ({
    padding: `${tokens.space[1]} ${tokens.space[2]}`,
    borderRadius: tokens.radius.sm,
    color: tokens.color.white,
    fontSize: tokens.fontSize.xs,
    fontWeight: tokens.fontWeight.semibold,
    backgroundColor: projectColor,
    display: 'inline-block',
  });

  const assigneeStyle = {
    color: tokens.color.neutral[500],
    fontSize: tokens.fontSize.sm,
  };

  const emptyStateStyle = {
    backgroundColor: tokens.color.white,
    borderRadius: tokens.radius.md,
    boxShadow: tokens.shadow.sm,
    padding: tokens.space[6],
    textAlign: 'center',
    color: tokens.color.neutral[500],
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
          whileFocus={{ boxShadow: `0 0 0 3px ${tokens.color.primary}33` }}
        >
          <option value="">All Projects</option>
          {mockProjects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </motion.select>
      </motion.div>

      <motion.div style={containerStyle} variants={containerVariants} initial="hidden" animate="visible">
        {sortedDates.length > 0 ? (
          sortedDates.map((date, dateIdx) => (
            <motion.div
              key={date}
              style={dateGroupStyle}
              variants={dateHeaderVariants}
              custom={dateIdx}
            >
              <motion.h3
                style={dateHeaderStyle}
                variants={dateHeaderVariants}
              >
                {new Date(date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
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
                      whileHover={{
                        boxShadow: tokens.shadow.md,
                        transform: 'translateX(4px)',
                      }}
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
          ))
        ) : (
          <motion.div
            style={emptyStateStyle}
            variants={dateHeaderVariants}
          >
            No tasks scheduled
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
