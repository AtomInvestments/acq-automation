import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockProjects, mockTasks } from '../mockData';
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

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: 'easeOut' }
  },
  hover: {
    scale: 1.05,
    boxShadow: 'var(--shadow-xl)',
    transition: { duration: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

const detailRowVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: 0.3 + i * 0.05,
      duration: 0.4,
      ease: 'easeOut',
    },
  }),
  hover: {
    backgroundColor: 'var(--color-neutral-100)',
    transition: { duration: 0.2 },
  },
};

export default function Projects() {
  const [selectedProject, setSelectedProject] = useState(null);

  const getProjectTasks = (projectId) => {
    return mockTasks.filter(t => t.projectId === projectId);
  };

  // Styles using design tokens
  const backButtonStyle = {
    marginBottom: 'var(--space-8)',
    color: 'var(--color-primary)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'var(--font-weight-semibold)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-sans)',
    transition: 'color var(--transition-base)',
  };

  const projectHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
  };

  const colorBoxStyle = {
    width: '4rem',
    height: '4rem',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-md)',
  };

  const projectNameStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
  };

  const projectTeamStyle = {
    color: 'var(--color-neutral-500)',
    fontSize: 'var(--font-size-sm)',
    marginTop: 'var(--space-2)',
  };

  const tableContainerStyle = {
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-neutral-200)',
    overflow: 'hidden',
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
    transition: 'background-color var(--transition-base)',
  };

  const tdStyle = {
    padding: 'var(--space-4)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-900)',
    fontFamily: 'var(--font-sans)',
  };

  const gridsCardStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 'var(--space-6)',
  };

  const cardHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  };

  const progressContainerStyle = {
    marginTop: 'var(--space-6)',
    backgroundColor: 'var(--color-neutral-100)',
    borderRadius: 'var(--radius-full)',
    height: '0.625rem',
    overflow: 'hidden',
  };

  const teamMembersContainerStyle = {
    marginTop: 'var(--space-4)',
  };

  const teamMembersBadgeStyle = {
    fontSize: 'var(--font-size-xs)',
    backgroundColor: 'var(--color-neutral-100)',
    color: 'var(--color-neutral-600)',
    padding: 'var(--space-1) var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    display: 'inline-block',
    marginRight: 'var(--space-1)',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    marginBottom: 'var(--space-8)',
  };

  const progressLabelStyle = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-neutral-500)',
    marginBottom: 'var(--space-2)',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const projectNameCardStyle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    marginTop: 'var(--space-4)',
  };

  if (selectedProject) {
    const project = mockProjects.find(p => p.id === selectedProject);
    const tasks = getProjectTasks(selectedProject);
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const inProgressTasks = tasks.filter(t => t.status === 'in-progress').length;

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.button
          onClick={() => setSelectedProject(null)}
          style={backButtonStyle}
          whileHover={{ color: 'var(--color-primary-dark)' }}
          variants={itemVariants}
        >
          ← Back to Projects
        </motion.button>

        <motion.div variants={itemVariants}>
          <Card>
            <div style={projectHeaderStyle}>
              <motion.div
                style={{ ...colorBoxStyle, backgroundColor: project.color }}
                layoutId={`project-color-${project.id}`}
              />
              <div style={{ flex: 1 }}>
                <h2 style={projectNameStyle}>{project.name}</h2>
                <p style={projectTeamStyle}>Team: {project.members.join(', ')}</p>
                <div style={{ display: 'flex', gap: 'var(--space-6)', marginTop: 'var(--space-4)' }}>
                  <div>
                    <p style={{ ...progressLabelStyle, margin: 0 }}>Completed</p>
                    <p style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', color: project.color, margin: 0 }}>{completedTasks}</p>
                  </div>
                  <div>
                    <p style={{ ...progressLabelStyle, margin: 0 }}>In Progress</p>
                    <p style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-info)', margin: 0 }}>{inProgressTasks}</p>
                  </div>
                  <div>
                    <p style={{ ...progressLabelStyle, margin: 0 }}>Total</p>
                    <p style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-neutral-500)', margin: 0 }}>{tasks.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div style={{ marginTop: 'var(--space-8)' }} variants={itemVariants}>
          <div style={tableContainerStyle}>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead style={theadStyle}>
                  <tr>
                    <th style={thStyle}>Task</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Due Date</th>
                    <th style={thStyle}>Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task, i) => (
                    <motion.tr
                      key={task.id}
                      style={tbodyTrStyle}
                      variants={detailRowVariants}
                      custom={i}
                      initial="hidden"
                      animate="visible"
                      whileHover="hover"
                    >
                      <td style={tdStyle}>{task.title}</td>
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
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <h2 style={titleStyle}>Projects</h2>

      <motion.div style={gridsCardStyle} variants={containerVariants} initial="hidden" animate="visible">
        {mockProjects.map((project) => {
          const tasks = getProjectTasks(project.id);
          const completed = tasks.filter(t => t.status === 'completed').length;
          const progressPercentage = tasks.length ? (completed / tasks.length) * 100 : 0;

          return (
            <motion.div
              key={project.id}
              variants={cardVariants}
              whileHover="hover"
              onClick={() => setSelectedProject(project.id)}
              style={{ cursor: 'pointer' }}
            >
              <Card>
                <div style={cardHeaderStyle}>
                  <motion.div
                    style={{ ...colorBoxStyle, backgroundColor: project.color }}
                    layoutId={`project-color-${project.id}`}
                  />
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-neutral-500)', margin: 0, marginBottom: 'var(--space-1)' }}>
                      Progress
                    </p>
                    <p style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', color: project.color, margin: 0 }}>
                      {completed}/{tasks.length}
                    </p>
                  </div>
                </div>

                <h3 style={projectNameCardStyle}>{project.name}</h3>

                <div style={teamMembersContainerStyle}>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-neutral-500)', marginBottom: 'var(--space-2)', margin: '0 0 var(--space-2) 0' }}>Team Members:</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
                    {project.members.slice(0, 3).map((member, idx) => (
                      <span key={idx} style={teamMembersBadgeStyle}>
                        {member}
                      </span>
                    ))}
                    {project.members.length > 3 && (
                      <span style={teamMembersBadgeStyle}>
                        +{project.members.length - 3}
                      </span>
                    )}
                  </div>
                </div>

                <div style={progressContainerStyle}>
                  <motion.div
                    style={{
                      height: '100%',
                      backgroundColor: project.color,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercentage}%` }}
                    transition={{ delay: 0.4, duration: 0.7, ease: 'easeOut' }}
                  />
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
