import { useState } from 'react';
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
      <div>
        <button
          onClick={() => setSelectedProject(null)}
          style={{
            marginBottom: '1.5rem',
            color: '#2563eb',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '0.875rem',
          }}
        >
          ← Back to Projects
        </button>

        <div style={{
          backgroundColor: '#fff',
          borderRadius: '0.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                width: '3rem',
                height: '3rem',
                borderRadius: '0.5rem',
                backgroundColor: project.color,
              }}
            ></div>
            <div>
              <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111' }}>{project.name}</h2>
              <p style={{ color: '#4b5563', fontSize: '0.875rem' }}>Team: {project.members.join(', ')}</p>
            </div>
          </div>
        </div>

        <div style={{
          backgroundColor: '#fff',
          borderRadius: '0.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <tr>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Task</th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Status</th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Due Date</th>
                  <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const statusColor = getStatusColor(task.status);
                  return (
                    <tr key={task.id} style={{ borderBottom: '1px solid #e5e7eb' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}>
                      <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#111' }}>{task.title}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          backgroundColor: statusColor.bg,
                          color: statusColor.text,
                        }}>
                          {task.status}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#4b5563' }}>{task.dueDate}</td>
                      <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#111' }}>{task.assignee}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ padding: '1rem', backgroundColor: '#fecaca', borderRadius: '0.5rem', marginBottom: '1.5rem', color: '#991b1b', fontWeight: 'bold' }}>🎯 PROJECTS VIEW</div>
      <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111', marginBottom: '1.5rem' }}>Projects</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {mockProjects.map((project) => {
          const tasks = getProjectTasks(project.id);
          const completed = tasks.filter(t => t.status === 'completed').length;

          return (
            <div
              key={project.id}
              onClick={() => setSelectedProject(project.id)}
              style={{
                backgroundColor: '#fff',
                borderRadius: '0.5rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                padding: '1.5rem',
                cursor: 'pointer',
                transition: 'box-shadow 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 15px rgba(0,0,0,0.1)'}
              onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: '0.5rem',
                    backgroundColor: project.color,
                  }}
                ></div>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#4b5563' }}>
                  {completed}/{tasks.length} complete
                </span>
              </div>

              <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#111', marginTop: '1rem' }}>{project.name}</h3>

              <div style={{ marginTop: '1rem' }}>
                <p style={{ fontSize: '0.75rem', color: '#4b5563', marginBottom: '0.5rem' }}>Team Members:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                  {project.members.slice(0, 3).map((member, idx) => (
                    <span key={idx} style={{
                      fontSize: '0.75rem',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                    }}>
                      {member}
                    </span>
                  ))}
                  {project.members.length > 3 && (
                    <span style={{
                      fontSize: '0.75rem',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '0.25rem',
                    }}>
                      +{project.members.length - 3}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ marginTop: '1rem', backgroundColor: '#f3f4f6', borderRadius: '9999px', height: '0.5rem', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%`,
                    backgroundColor: project.color,
                    transition: 'width 0.3s',
                  }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
