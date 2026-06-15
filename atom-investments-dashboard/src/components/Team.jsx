import { motion } from 'framer-motion';
import { mockProjects, mockTeamMembers } from '../mockData';

export default function Team() {
  const getProjectMembers = (projectName) => {
    return mockTeamMembers.filter(member =>
      member.projects.includes(projectName)
    );
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1, delayChildren: 0.3 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, scale: 0.8 },
    visible: {
      opacity: 1,
      scale: 1,
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
          Team
        </h1>
        <p style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-secondary-text)',
          fontFamily: 'var(--font-serif)'
        }}>
          Who's building what. Permissions and project access are managed here.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        style={{
          textAlign: 'center',
          marginBottom: 'var(--space-12)'
        }}
      >
        <motion.div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '7.5rem',
            height: '7.5rem',
            borderRadius: '9999px',
            background: `linear-gradient(to bottom right, var(--color-primary), #374151)`,
            color: 'white',
            boxShadow: `0 12px 24px rgba(31, 41, 55, 0.15)`,
            cursor: 'pointer'
          }}
          whileHover={{ scale: 1.08 }}
          transition={{ duration: 0.3 }}
        >
          <div style={{ textAlign: 'center' }}>
            <p style={{
              fontWeight: 'var(--font-weight-bold)',
              fontSize: 'var(--font-size-lg)',
              fontFamily: 'var(--font-sans)',
              marginBottom: '0.25rem'
            }}>
              ATOM
            </p>
            <p style={{
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-serif)',
              opacity: 0.9
            }}>
              Investments
            </p>
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
          gap: 'var(--space-6)',
          marginBottom: 'var(--space-12)',
          justifyItems: 'center'
        }}
      >
        {mockProjects.map((project) => (
          <motion.div
            key={project.id}
            variants={itemVariants}
            style={{ width: '100%', textAlign: 'center' }}
          >
            <motion.div
              style={{
                borderRadius: '9999px',
                width: '6rem',
                height: '6rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'white',
                fontWeight: 'var(--font-weight-bold)',
                textAlign: 'center',
                backgroundColor: project.color,
                boxShadow: `0 8px 16px ${project.color}40`,
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--font-size-sm)',
                padding: 'var(--space-2)',
                margin: '0 auto'
              }}
              whileHover={{
                scale: 1.1,
                boxShadow: `0 12px 24px ${project.color}60`
              }}
              transition={{ duration: 0.3 }}
            >
              {project.name}
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}
      >
        {mockProjects.map((project, projectIdx) => {
          const members = getProjectMembers(project.name);
          return (
            <motion.div
              key={project.id}
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1,
                  y: 0,
                  transition: { delay: 0.3 + projectIdx * 0.1, duration: 0.4 }
                }
              }}
              style={{
                paddingTop: 'var(--space-8)',
                borderTop: `2px solid ${project.color}40`
              }}
            >
              <h2 style={{
                textAlign: 'center',
                fontWeight: 'var(--font-weight-bold)',
                marginBottom: 'var(--space-6)',
                color: project.color,
                fontSize: 'var(--font-size-lg)',
                fontFamily: 'var(--font-sans)'
              }}>
                {project.name}
              </h2>

              {members.length > 0 ? (
                <motion.div
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: { staggerChildren: 0.08, delayChildren: 0.05 }
                    }
                  }}
                  initial="hidden"
                  animate="visible"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: 'var(--space-4)'
                  }}
                >
                  {members.map((member, memberIdx) => (
                    <motion.div
                      key={member.id}
                      variants={{
                        hidden: { opacity: 0, y: 16 },
                        visible: {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.3 }
                        }
                      }}
                      style={{
                        backgroundColor: 'white',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-5)',
                        boxShadow: 'var(--shadow-sm)',
                        borderLeft: `4px solid ${project.color}`,
                        transition: 'all var(--transition-base)'
                      }}
                      whileHover={{
                        y: -2,
                        boxShadow: 'var(--shadow-lg)'
                      }}
                    >
                      <div
                        style={{
                          width: '3rem',
                          height: '3rem',
                          borderRadius: '9999px',
                          backgroundColor: project.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontWeight: 'var(--font-weight-bold)',
                          margin: '0 auto var(--space-3)',
                          fontSize: 'var(--font-size-lg)',
                          fontFamily: 'var(--font-sans)',
                          boxShadow: `0 4px 12px ${project.color}40`
                        }}
                      >
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <p style={{
                        fontWeight: 'var(--font-weight-semibold)',
                        color: 'var(--color-primary)',
                        textAlign: 'center',
                        fontSize: 'var(--font-size-sm)',
                        marginBottom: 'var(--space-1)',
                        fontFamily: 'var(--font-sans)'
                      }}>
                        {member.name}
                      </p>
                      <p style={{
                        color: 'var(--color-secondary-text)',
                        fontSize: 'var(--font-size-xs)',
                        textAlign: 'center',
                        marginBottom: 'var(--space-3)',
                        fontFamily: 'var(--font-serif)'
                      }}>
                        {member.role}
                      </p>
                      <div style={{
                        paddingTop: 'var(--space-3)',
                        borderTop: '1px solid var(--color-border)'
                      }}>
                        <p style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--color-secondary-text)',
                          textAlign: 'center',
                          fontFamily: 'var(--font-sans)'
                        }}>
                          {member.projects.length} project{member.projects.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <p style={{
                  color: 'var(--color-secondary-text)',
                  textAlign: 'center',
                  fontSize: 'var(--font-size-sm)',
                  fontFamily: 'var(--font-serif)'
                }}>
                  No members assigned
                </p>
              )}
            </motion.div>
          );
        })}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        style={{
          marginTop: 'var(--space-12)',
          backgroundColor: 'white',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-6)',
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <h3 style={{
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-primary)',
          fontFamily: 'var(--font-sans)',
          marginBottom: 'var(--space-6)'
        }}>
          Team Summary
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-6)',
          marginBottom: 'var(--space-6)'
        }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7, duration: 0.4 }}
          >
            <p style={{
              color: 'var(--color-secondary-text)',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-serif)',
              marginBottom: 'var(--space-2)'
            }}>
              Total Members
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.4 }}
              style={{
                fontSize: '2.25rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)'
              }}
            >
              {mockTeamMembers.length}
            </motion.p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.75, duration: 0.4 }}
          >
            <p style={{
              color: 'var(--color-secondary-text)',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-serif)',
              marginBottom: 'var(--space-2)'
            }}>
              Total Projects
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.85, duration: 0.4 }}
              style={{
                fontSize: '2.25rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)'
              }}
            >
              {mockProjects.length}
            </motion.p>
          </motion.div>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 'var(--space-4)'
          }}
        >
          {mockProjects.map((project) => (
            <motion.div
              key={project.id}
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
              }}
              style={{
                padding: 'var(--space-4)',
                backgroundColor: '#f9fafb',
                borderRadius: 'var(--radius-sm)',
                borderLeft: `3px solid ${project.color}`
              }}
            >
              <p style={{
                fontWeight: 'var(--font-weight-semibold)',
                color: 'var(--color-primary)',
                fontFamily: 'var(--font-sans)',
                marginBottom: 'var(--space-1)'
              }}>
                {project.name}
              </p>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-secondary-text)',
                fontFamily: 'var(--font-serif)'
              }}>
                {getProjectMembers(project.name).length} member{getProjectMembers(project.name).length !== 1 ? 's' : ''}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </div>
  );
}
