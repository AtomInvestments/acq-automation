import { mockTasks, mockProjects } from '../mockData';

export default function Overview() {
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

  return (
    <div>
      <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111', marginBottom: '1.5rem' }}>All Tasks</h2>

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
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Project</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Due Date</th>
                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {mockTasks.map((task) => {
                const project = mockProjects.find(p => p.id === task.projectId);
                const statusColor = getStatusColor(task.status);
                return (
                  <tr key={task.id} style={{ borderBottom: '1px solid #e5e7eb', transition: 'background-color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fff'}>
                    <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#111' }}>{task.title}</td>
                    <td style={{ padding: '1rem' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.75rem',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          color: '#fff',
                          backgroundColor: getProjectColor(task.projectId),
                        }}
                      >
                        {project.name}
                      </span>
                    </td>
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

      <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '0.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: '1.5rem',
        }}>
          <p style={{ color: '#4b5563', fontSize: '0.875rem' }}>Total Tasks</p>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#111', marginTop: '0.5rem' }}>{mockTasks.length}</p>
        </div>
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '0.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: '1.5rem',
        }}>
          <p style={{ color: '#4b5563', fontSize: '0.875rem' }}>In Progress</p>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2563eb', marginTop: '0.5rem' }}>
            {mockTasks.filter(t => t.status === 'in-progress').length}
          </p>
        </div>
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '0.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          padding: '1.5rem',
        }}>
          <p style={{ color: '#4b5563', fontSize: '0.875rem' }}>Completed</p>
          <p style={{ fontSize: '2rem', fontWeight: 'bold', color: '#16a34a', marginTop: '0.5rem' }}>
            {mockTasks.filter(t => t.status === 'completed').length}
          </p>
        </div>
      </div>
    </div>
  );
}
