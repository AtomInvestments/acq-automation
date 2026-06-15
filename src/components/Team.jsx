import { motion } from 'framer-motion';
import { mockProjects, mockTeamMembers } from '../mockData';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.2,
    },
  },
};

const bubbleVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: 'easeOut',
    },
  },
  hover: {
    scale: 1.05,
    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
  },
};

const memberCardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4 },
  },
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
    charcoal: '#374151',
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
    lg: '0 10px 25px rgba(0,0,0,0.1)',
  },
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
    gap: tokens.space[8],
  };

  const titleStyle = {
    fontSize: tokens.fontSize['3xl'],
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.neutral[900],
    marginBottom: tokens.space[8],
    textAlign: 'center',
  };

  // Level 1: ATOM Investments
  const level1ContainerStyle = {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: tokens.space[8],
  };

  const atomBubbleStyle = {
    width: '120px',
    height: '120px',
    background: `linear-gradient(135deg, ${tokens.color.charcoal} 0%, #1f2937 100%)`,
    color: tokens.color.white,
    borderRadius: tokens.radius.full,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: tokens.shadow.lg,
    textAlign: 'center',
  };

  const atomTitleStyle = {
    fontWeight: tokens.fontWeight.bold,
    fontSize: tokens.fontSize.xl,
    margin: 0,
  };

  const atomSubtitleStyle = {
    fontSize: tokens.fontSize.sm,
    margin: `${tokens.space[1]} 0 0 0`,
    opacity: 0.9,
  };

  // Level 2: Projects
  const level2ContainerStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: tokens.space[6],
    marginBottom: tokens.space[8],
    justifyItems: 'center',
    maxWidth: '900px',
    margin: `0 auto ${tokens.space[8]} auto`,
  };

  const projectBubbleStyle = (projectColor) => ({
    width: '100px',
    height: '100px',
    borderRadius: tokens.radius.full,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: tokens.shadow.md,
    color: tokens.color.white,
    fontWeight: tokens.fontWeight.bold,
    textAlign: 'center',
    backgroundColor: projectColor,
    padding: tokens.space[2],
    fontSize: tokens.fontSize.sm,
    lineHeight: 1.2,
  });

  // Level 3: Team Members
  const projectSectionStyle = {
    marginBottom: tokens.space[8],
    borderTop: `1px solid ${tokens.color.neutral[200]}`,
    paddingTop: tokens.space[8],
  };

  const projectSectionTitleStyle = (projectColor) => ({
    textAlign: 'center',
    fontWeight: tokens.fontWeight.bold,
    color: projectColor,
    marginBottom: tokens.space[6],
    fontSize: tokens.fontSize.lg,
  });

  const memberCardsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.space[4],
  };

  const memberCardStyle = (projectColor) => ({
    backgroundColor: tokens.color.white,
    borderRadius: tokens.radius.md,
    boxShadow: tokens.shadow.sm,
    padding: tokens.space[4],
    borderLeft: `4px solid ${projectColor}`,
    transition: 'all 0.2s',
  });

  const avatarStyle = {
    width: '3rem',
    height: '3rem',
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.neutral[200],
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.color.white,
    fontWeight: tokens.fontWeight.bold,
    margin: `0 auto ${tokens.space[2]} auto`,
    fontSize: tokens.fontSize.sm,
  };

  const memberNameStyle = {
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.neutral[900],
    textAlign: 'center',
    fontSize: tokens.fontSize.sm,
    margin: 0,
  };

  const memberRoleStyle = {
    color: tokens.color.neutral[500],
    fontSize: tokens.fontSize.xs,
    textAlign: 'center',
    marginTop: tokens.space[1],
    margin: tokens.space[1] + ' 0 0 0',
  };

  const memberProjectsStyle = {
    marginTop: tokens.space[4],
    paddingTop: tokens.space[4],
    borderTop: `1px solid ${tokens.color.neutral[200]}`,
  };

  const memberProjectCountStyle = {
    fontSize: tokens.fontSize.xs,
    color: tokens.color.neutral[500],
    textAlign: 'center',
    margin: 0,
  };

  // Summary section
  const summaryContainerStyle = {
    marginTop: tokens.space[8],
    backgroundColor: tokens.color.white,
    borderRadius: tokens.radius.md,
    boxShadow: tokens.shadow.sm,
    padding: tokens.space[6],
  };

  const summaryTitleStyle = {
    fontSize: tokens.fontSize.lg,
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.neutral[900],
    marginBottom: tokens.space[6],
    margin: 0,
  };

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: tokens.space[6],
    marginBottom: tokens.space[6],
  };

  const statLabelStyle = {
    color: tokens.color.neutral[500],
    fontSize: tokens.fontSize.sm,
    margin: 0,
  };

  const statValueStyle = {
    fontSize: tokens.fontSize['3xl'],
    fontWeight: tokens.fontWeight.bold,
    color: tokens.color.primary,
    marginTop: tokens.space[1],
    margin: tokens.space[1] + ' 0 0 0',
  };

  const projectStatsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: tokens.space[4],
  };

  const projectStatCardStyle = (projectColor) => ({
    padding: tokens.space[4],
    backgroundColor: tokens.color.neutral[50],
    borderRadius: tokens.radius.sm,
    borderLeft: `3px solid ${projectColor}`,
  });

  const projectStatNameStyle = {
    fontWeight: tokens.fontWeight.semibold,
    color: tokens.color.neutral[900],
    margin: 0,
  };

  const projectStatCountStyle = {
    fontSize: tokens.fontSize.sm,
    color: tokens.color.neutral[500],
    marginTop: tokens.space[1],
    margin: tokens.space[1] + ' 0 0 0',
  };

  const noMembersStyle = {
    color: tokens.color.neutral[500],
    textAlign: 'center',
    fontSize: tokens.fontSize.sm,
  };

  return (
    <motion.div
      style={pageContainerStyle}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.h2 style={titleStyle} variants={{ visible: { opacity: 1, y: 0 }, hidden: { opacity: 0, y: -20 } }}>
        Team Organization
      </motion.h2>

      {/* Level 1: ATOM Investments */}
      <motion.div style={level1ContainerStyle} variants={bubbleVariants}>
        <motion.div
          style={atomBubbleStyle}
          whileHover="hover"
          variants={bubbleVariants}
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
                      whileHover={{
                        boxShadow: tokens.shadow.lg,
                        y: -2,
                      }}
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
          <motion.div variants={memberCardVariants}>
            <p style={statLabelStyle}>Total Members</p>
            <motion.p
              style={statValueStyle}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              {totalMembers}
            </motion.p>
          </motion.div>

          <motion.div variants={memberCardVariants}>
            <p style={statLabelStyle}>Total Projects</p>
            <motion.p
              style={statValueStyle}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              {totalProjects}
            </motion.p>
          </motion.div>

          <motion.div variants={memberCardVariants}>
            <p style={statLabelStyle}>Members per Project (Avg)</p>
            <motion.p
              style={statValueStyle}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              {(totalMembers / totalProjects).toFixed(1)}
            </motion.p>
          </motion.div>
        </motion.div>

        <motion.div style={projectStatsGridStyle} variants={containerVariants} initial="hidden" animate="visible">
          {mockProjects.map((project, idx) => {
            const projectMemberCount = getProjectMembers(project.name).length;
            return (
              <motion.div key={project.id} style={projectStatCardStyle(project.color)} variants={memberCardVariants} custom={idx}>
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
