import { mockProjects, mockTeamMembers } from '../mockData';

export default function Team() {
  const getProjectMembers = (projectName) => {
    return mockTeamMembers.filter(member =>
      member.projects.includes(projectName)
    );
  };

  return (
    <div>
      <div style={{ padding: '1rem', backgroundColor: '#a7f3d0', borderRadius: '0.5rem', marginBottom: '1.5rem', color: '#065f46', fontWeight: 'bold' }}>👥 TEAM VIEW</div>
      <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111', marginBottom: '2rem' }}>Team Organization</h2>

      {/* Top Level: ATOM Investments */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '3rem' }}>
        <div style={{
          background: 'linear-gradient(to bottom right, #2563eb, #1e40af)',
          color: '#fff',
          borderRadius: '9999px',
          width: '8rem',
          height: '8rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
          transition: 'transform 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontWeight: 'bold', fontSize: '1.125rem' }}>ATOM</p>
            <p style={{ fontSize: '0.875rem' }}>Investments</p>
          </div>
        </div>
      </div>

      {/* Second Level: Projects */}
      <div style={{ marginBottom: '3rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1.5rem', marginBottom: '3rem', justifyItems: 'center' }}>
          {mockProjects.map((project) => (
            <div key={project.id} style={{ textAlign: 'center', width: '100%' }}>
              <div
                style={{
                  borderRadius: '9999px',
                  width: '7rem',
                  height: '7rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  color: '#fff',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  backgroundColor: project.color,
                  transition: 'transform 0.2s',
                  padding: '0.5rem',
                  fontSize: '0.875rem',
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                {project.name}
              </div>
            </div>
          ))}
        </div>

        {/* Lines connecting projects to team members */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {mockProjects.map((project) => {
            const members = getProjectMembers(project.name);
            return (
              <div key={project.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: '2rem' }}>
                <h3 style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: '1.5rem', color: project.color }}>
                  {project.name}
                </h3>

                {members.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    {members.map((member) => (
                      <div
                        key={member.id}
                        style={{
                          backgroundColor: '#fff',
                          borderRadius: '0.5rem',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          padding: '1rem',
                          transition: 'box-shadow 0.2s',
                          borderLeft: `4px solid ${project.color}`,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 15px rgba(0,0,0,0.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'}
                      >
                        <div style={{
                          width: '3rem',
                          height: '3rem',
                          borderRadius: '9999px',
                          backgroundColor: '#d1d5db',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: 'bold',
                          margin: '0 auto 0.75rem',
                          fontSize: '0.875rem',
                        }}>
                          {member.name.charAt(0)}
                        </div>
                        <p style={{ fontWeight: 'bold', color: '#111', textAlign: 'center', fontSize: '0.875rem' }}>{member.name}</p>
                        <p style={{ color: '#4b5563', fontSize: '0.75rem', textAlign: 'center', marginTop: '0.25rem' }}>{member.role}</p>
                        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb' }}>
                          <p style={{ fontSize: '0.75rem', color: '#4b5563', textAlign: 'center' }}>
                            {member.projects.length} project{member.projects.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#4b5563', textAlign: 'center', fontSize: '0.875rem' }}>No members assigned</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <div style={{
        marginTop: '3rem',
        backgroundColor: '#fff',
        borderRadius: '0.5rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        padding: '1.5rem',
      }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#111', marginBottom: '1rem' }}>Team Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div>
            <p style={{ color: '#4b5563', fontSize: '0.875rem' }}>Total Members</p>
            <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2563eb', marginTop: '0.25rem' }}>{mockTeamMembers.length}</p>
          </div>
          <div>
            <p style={{ color: '#4b5563', fontSize: '0.875rem' }}>Total Projects</p>
            <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2563eb', marginTop: '0.25rem' }}>{mockProjects.length}</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          {mockProjects.map((project) => (
            <div key={project.id} style={{
              padding: '1rem',
              backgroundColor: '#f9fafb',
              borderRadius: '0.375rem',
              borderLeft: `3px solid ${project.color}`,
            }}>
              <p style={{ fontWeight: 500, color: '#111' }}>{project.name}</p>
              <p style={{ fontSize: '0.875rem', color: '#4b5563', marginTop: '0.25rem' }}>
                {getProjectMembers(project.name).length} member{getProjectMembers(project.name).length !== 1 ? 's' : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
