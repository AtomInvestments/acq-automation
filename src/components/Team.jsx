import { motion } from 'framer-motion';
import { mockProjects, mockTeamMembers } from '../mockData';

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

const bubbleVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: (i) => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay: 0.2 + i * 0.08,
      duration: 0.5,
      ease: 'easeOut',
    },
  }),
  hover: {
    scale: 1.08,
    boxShadow: 'var(--shadow-xl)',
    transition: { duration: 0.2 },
  },
};

const memberCardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.4,
    },
  }),
  hover: {
    boxShadow: 'var(--shadow-lg)',
    y: -4,
    transition: { duration: 0.2 },
  },
};

const statVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: (i) => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay: 0.3 + i * 0.1,
      duration: 0.4,
    },
  }),
};

export default function Team() {
  const getProjectMembers = (projectName) => {
    return mockTeamMembers.filter(member =>
      member.projects.includes(projectName)
    );
  };

  const totalMembers = mockTeamMembers.length;
  const totalProjects = mockProjects.length;

  // Styles using design tokens
  const pageContainerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-12)',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    marginBottom: 'var(--space-8)',
    textAlign: 'center',
    letterSpacing: '-0.02em',
  };

  // Level 1: ATOM Investments
  const level1ContainerStyle = {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 'var(--space-12)',
  };

  const atomBubbleStyle = {
    width: '140px',
    height: '140px',
    background: 'linear-gradient(135deg, var(--color-neutral-700) 0%, var(--color-neutral-900) 100%)',
    color: 'var(--color-white)',
    borderRadius: 'var(--radius-full)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-lg)',
    textAlign: 'center',
  };

  const atomTitleStyle = {
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-2xl)',
    margin: 0,
  };

  const atomSubtitleStyle = {
    fontSize: 'var(--font-size-base)',
    margin: 'var(--space-2) 0 0 0',
    opacity: 0.85,
  };

  // Level 2: Projects
  const level2ContainerStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 'var(--space-6)',
    marginBottom: 'var(--space-12)',
    justifyItems: 'center',
    maxWidth: '1000px',
    margin: '0 auto var(--space-12) auto',
  };

  const projectBubbleStyle = (projectColor) => ({
    width: '110px',
    height: '110px',
    borderRadius: 'var(--radius-full)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-md)',
    color: 'var(--color-white)',
    fontWeight: 'var(--font-weight-bold)',
    textAlign: 'center',
    backgroundColor: projectColor,
    padding: 'var(--space-2)',
    fontSize: 'var(--font-size-sm)',
    lineHeight: 1.3,
    transition: 'all var(--transition-base)',
  });

  // Level 3: Team Members
  const projectSectionStyle = {
    marginBottom: 'var(--space-10)',
    borderTop: '1px solid var(--color-neutral-200)',
    paddingTop: 'var(--space-8)',
  };

  const projectSectionTitleStyle = (projectColor) => ({
    textAlign: 'center',
    fontWeight: 'var(--font-weight-bold)',
    color: projectColor,
    marginBottom: 'var(--space-6)',
    fontSize: 'var(--font-size-lg)',
  });

  const memberCardsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--space-4)',
  };

  const memberCardStyle = (projectColor) => ({
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-4)',
    borderLeft: '4px solid ' + projectColor,
    transition: 'all var(--transition-base)',
  });

  const avatarStyle = {
    width: '3.5rem',
    height: '3.5rem',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-neutral-200)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-white)',
    fontWeight: 'var(--font-weight-bold)',
    margin: '0 auto var(--space-2) auto',
    fontSize: 'var(--font-size-lg)',
  };

  const memberNameStyle = {
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    textAlign: 'center',
    fontSize: 'var(--font-size-base)',
    margin: 0,
  };

  const memberRoleStyle = {
    color: 'var(--color-neutral-500)',
    fontSize: 'var(--font-size-xs)',
    textAlign: 'center',
    marginTop: 'var(--space-1)',
    margin: 'var(--space-1) 0 0 0',
  };

  const memberProjectsStyle = {
    marginTop: 'var(--space-4)',
    paddingTop: 'var(--space-4)',
    borderTop: '1px solid var(--color-neutral-200)',
  };

  const memberProjectCountStyle = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-neutral-500)',
    textAlign: 'center',
    margin: 0,
  };

  // Summary section
  const summaryContainerStyle = {
    marginTop: 'var(--space-12)',
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-8)',
  };

  const summaryTitleStyle = {
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-neutral-900)',
    marginBottom: 'var(--space-6)',
    margin: 0,
  };

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 'var(--space-6)',
    marginBottom: 'var(--space-8)',
  };

  const statLabelStyle = {
    color: 'var(--color-neutral-500)',
    fontSize: 'var(--font-size-sm)',
    margin: 0,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const statValueStyle = {
    fontSize: 'var(--font-size-4xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-primary)',
    marginTop: 'var(--space-2)',
    margin: 'var(--space-2) 0 0 0',
    lineHeight: 1,
  };

  const projectStatsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 'var(--space-4)',
  };

  const projectStatCardStyle = (projectColor) => ({
    padding: 'var(--space-4)',
    backgroundColor: 'var(--color-neutral-50)',
    borderRadius: 'var(--radius-md)',
    borderLeft: '3px solid ' + projectColor,
  });

  const projectStatNameStyle = {
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-neutral-900)',
    margin: 0,
  };

  const projectStatCountStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    marginTop: 'var(--space-1)',
    margin: 'var(--space-1) 0 0 0',
  };

  const noMembersStyle = {
    color: 'var(--color-neutral-500)',
    textAlign: 'center',
    fontSize: 'var(--font-size-base)',
  };

  return (
    <motion.div
      style={pageContainerStyle}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.h2
        style={titleStyle}
        variants={{
          visible: { opacity: 1, y: 0 },
          hidden: { opacity: 0, y: -20 }
        }}
      >
        Team Organization
      </motion.h2>

      {/* Level 1: ATOM Investments */}
      <motion.div style={level1ContainerStyle}>
        <motion.div
          style={atomBubbleStyle}
          variants={bubbleVariants}
          custom={0}
          whileHover="hover"
        >
          <p style={atomTitleStyle}>ATOM</p>
          <p style={atomSubtitleStyle}>Investments</p>
        </motion.div>
      </motion.div>

      {/* Level 2: Projects */}
      <motion.div style={level2ContainerStyle} variants={containerVariants} initial="hidden" animate="visible">
        {mockProjects.map((project, idx) => (
          <motion.div key={project.id} variants={bubbleVariants} custom={idx}>
            <motion.div
              style={projectBubbleStyle(project.color)}
              whileHover="hover"
              variants={bubbleVariants}
            >
              {project.name}
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Level 3: Team Members organized by project */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        {mockProjects.map((project, projectIdx) => {
          const members = getProjectMembers(project.name);
          return (
            <div key={project.id} style={projectSectionStyle}>
              <h3 style={projectSectionTitleStyle(project.color)}>{project.name}</h3>

              {members.length > 0 ? (
                <motion.div
                  style={memberCardsGridStyle}
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {members.map((member, memberIdx) => (
                    <motion.div
                      key={member.id}
                      style={memberCardStyle(project.color)}
                      variants={memberCardVariants}
                      custom={memberIdx}
                      whileHover="hover"
                    >
                      <div style={avatarStyle}>
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <p style={memberNameStyle}>{member.name}</p>
                      <p style={memberRoleStyle}>{member.role}</p>
                      <div style={memberProjectsStyle}>
                        <p style={memberProjectCountStyle}>
                          {member.projects.length} project{member.projects.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <div style={noMembersStyle}>
                  No members assigned
                </div>
              )}
            </div>
          );
        })}
      </motion.div>

      {/* Summary Stats */}
      <motion.div style={summaryContainerStyle} variants={{ visible: { opacity: 1 }, hidden: { opacity: 0 } }}>
        <h3 style={summaryTitleStyle}>Team Summary</h3>

        <motion.div
          style={statsGridStyle}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={statVariants} custom={0}>
            <p style={statLabelStyle}>Total Members</p>
            <motion.p
              style={statValueStyle}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              {totalMembers}
            </motion.p>
          </motion.div>

          <motion.div variants={statVariants} custom={1}>
            <p style={statLabelStyle}>Total Projects</p>
            <motion.p
              style={statValueStyle}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              {totalProjects}
            </motion.p>
          </motion.div>

          <motion.div variants={statVariants} custom={2}>
            <p style={statLabelStyle}>Avg Members/Project</p>
            <motion.p
              style={statValueStyle}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              {(totalMembers / totalProjects).toFixed(1)}
            </motion.p>
          </motion.div>
        </motion.div>

        <motion.div style={projectStatsGridStyle} variants={containerVariants} initial="hidden" animate="visible">
          {mockProjects.map((project, idx) => {
            const projectMemberCount = getProjectMembers(project.name).length;
            return (
              <motion.div
                key={project.id}
                style={projectStatCardStyle(project.color)}
                variants={memberCardVariants}
                custom={idx}
              >
                <p style={projectStatNameStyle}>{project.name}</p>
                <p style={projectStatCountStyle}>
                  {projectMemberCount} member{projectMemberCount !== 1 ? 's' : ''}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
