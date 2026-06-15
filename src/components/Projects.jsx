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
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  hover: { scale: 1.02, boxShadow: '0 10px 25px rgba(0,0,0,0.15)' },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Projects() {
  const [selectedProject, setSelectedProject] = useState(null);

  const getProjectTasks = (projectId) => {
    return mockTasks.filter(t => t.projectId === projectId);
  };

  // Styles using design tokens
  const backButtonStyle = {
    marginBottom: 'var(--space-8, 2rem)',
    color: 'var(--color-primary, #2563eb)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 'var(--font-weight-semibold, 600)',
    fontSize: 'var(--font-size-sm, 0.875rem)',
    fontFamily: 'var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif)',
    transition: 'opacity 0.2s',
  };

  const projectHeaderStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4, 1rem)',
  };

  const colorBoxStyle = {
    width: '3rem',
    height: '3rem',
    borderRadius: 'var(--radius-md, 0.5rem)',
  };

  const projectNameStyle = {
    fontSize: 'var(--font-size-3xl, 1.875rem)',
    fontWeight: 'var(--font-weight-bold, 700)',
    color: 'var(--color-neutral-900, #111)',
  };

  const projectTeamStyle = {
    color: 'var(--color-neutral-500, #4b5563)',
    fontSize: 'var(--font-size-sm, 0.875rem)',
  };

  const tableContainerStyle = {
    backgroundColor: 'var(--color-white, #fff)',
    borderRadius: 'var(--radius-md, 0.5rem)',
    border: '1px solid var(--color-neutral-200, #e5e7eb)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.1))',
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

  const gridsCardStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 'var(--space-6, 1.5rem)',
  };

  const cardHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  };

  const progressContainerStyle = {
    marginTop: 'var(--space-4, 1rem)',
    backgroundColor: 'var(--color-neutral-100, #f3f4f6)',
    borderRadius: 'var(--radius-full, 9999px)',
    height: '0.5rem',
    overflow: 'hidden',
  };

  const teamMembersContainerStyle = {
    marginTop: 'var(--space-4, 1rem)',
  };

  const teamMembersBadgeStyle = {
    fontSize: 'var(--font-size-xs, 0.75rem)',
    backgroundColor: 'var(--color-neutral-100, #f3f4f6)',
    color: 'var(--color-neutral-900, #374151)',
    padding: 'var(--space-1, 0.25rem) var(--space-2, 0.5rem)',
    borderRadius: 'var(--radius-sm, 0.25rem)',
    display: 'inline-block',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl, 1.875rem)',
    fontWeight: 'var(--font-weight-bold, 700)',
    color: 'var(--color-neutral-900, #111)',
    marginBottom: 'var(--space-6, 1.5rem)',
  };

  if (selectedProject) {
    const project = mockProjects.find(p => p.id === selectedProject);
    const tasks = getProjectTasks(selectedProject);

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.button
          onClick={() => setSelectedProject(null)}
          style={backButtonStyle}
          whileHover={{ opacity: 0.7 }}
          variants={itemVariants}
        >
          ← Back to Projects
        </motion.button>

        <motion.div variants={itemVariants}>
          <Card>
            <div style={projectHeaderStyle}>
              <div style={{ ...colorBoxStyle, backgroundColor: project.color }}></div>
              <div>
                <h2 style={projectNameStyle}>{project.name}</h2>
                <p style={projectTeamStyle}>Team: {project.members.join(', ')}</p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div style={{ marginTop: 'var(--space-6, 1.5rem)' }} variants={itemVariants}>
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
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 + i * 0.05 }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-neutral-100, #f9fafb)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
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
                  <div style={{ ...colorBoxStyle, backgroundColor: project.color }}></div>
                  <span style={{ fontSize: 'var(--font-size-xs, 0.75rem)', fontWeight: 'var(--font-weight-semibold, 600)', color: 'var(--color-neutral-500, #4b5563)' }}>
                    {completed}/{tasks.length} complete
                  </span>
                </div>

                <h3 style={{ fontSize: 'var(--font-size-xl, 1.25rem)', fontWeight: 'var(--font-weight-bold, 700)', color: 'var(--color-neutral-900, #111)', marginTop: 'var(--space-4, 1rem)' }}>{project.name}</h3>

                <div style={teamMembersContainerStyle}>
                  <p style={{ fontSize: 'var(--font-size-xs, 0.75rem)', color: 'var(--color-neutral-500, #4b5563)', marginBottom: 'var(--space-2, 0.5rem)' }}>Team Members:</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1, 0.25rem)' }}>
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
                    transition={{ delay: 0.3, duration: 0.6, ease: 'easeOut' }}
                  ></motion.div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
