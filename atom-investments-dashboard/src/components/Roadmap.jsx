import { useState } from 'react';
import { mockTasks, mockProjects } from '../mockData';

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
    return project ? project.color : '#6b7280';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const tasksByDate = getTasksByDate();
  const sortedDates = Object.keys(tasksByDate).sort();

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111' }}>Roadmap</h2>
        <select
          value={selectedProject || ''}
          onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
          style={{
            padding: '0.5rem 1rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
            fontSize: '0.875rem',
            outline: 'none',
          }}
        >
          <option value="">All Projects</option>
          {mockProjects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {sortedDates.length > 0 ? (
          sortedDates.map(date => (
            <div key={date} style={{
              backgroundColor: '#fff',
              borderRadius: '0.5rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              padding: '1.5rem',
            }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#111', marginBottom: '1rem' }}>
                {new Date(date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {tasksByDate[date].map(task => {
                  const statusColor = getStatusColor(task.status);
                  return (
                    <div
                      key={task.id}
                      style={{
                        padding: '1rem',
                        borderRadius: '0.375rem',
                        borderLeft: `4px solid ${getProjectColor(task.projectId)}`,
                        backgroundColor: statusColor.bg,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 500, color: '#111' }}>{task.title}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                            <span
                              style={{
                                padding: '0.25rem 0.5rem',
                                borderRadius: '0.25rem',
                                color: '#fff',
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                backgroundColor: getProjectColor(task.projectId),
                              }}
                            >
                              {getProjectName(task.projectId)}
                            </span>
                            <span style={{ color: '#4b5563' }}>{task.assignee}</span>
                          </div>
                        </div>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          padding: '0.25rem 0.75rem',
                          borderRadius: '9999px',
                          backgroundColor: statusColor.bg,
                          color: statusColor.text,
                        }}>
                          {task.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '0.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            padding: '1.5rem',
            textAlign: 'center',
            color: '#4b5563',
          }}>
            No tasks scheduled
          </div>
        )}
      </div>
    </div>
  );
}
