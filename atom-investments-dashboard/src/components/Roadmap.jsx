import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';

export default function Roadmap() {
  const [selectedProject, setSelectedProject] = useState(null);
  const [currentDate, setCurrentDate] = useState(new Date(2026, 5, 15)); // June 2026

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

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const tasksByDate = getTasksByDate();

  // Calendar calculation
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const calendarDays = [];
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  const getTasksForDate = (day) => {
    if (!day) return [];
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return tasksByDate[dateStr] || [];
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const previousMonth = () => setCurrentDate(new Date(year, month - 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1));

  return (
    <div style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-8)' }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ marginBottom: 'var(--space-6)' }}
      >
        <h1 style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-primary)',
          fontFamily: 'var(--font-sans)',
          marginBottom: 'var(--space-2)',
          letterSpacing: '-0.5px'
        }}>
          Roadmap
        </h1>
        <p style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-secondary-text)',
          fontFamily: 'var(--font-serif)'
        }}>
          Project timeline at a glance. Click a date to see tasks.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        style={{ marginBottom: 'var(--space-8)' }}
      >
        <select
          value={selectedProject || ''}
          onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--font-size-sm)',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
            cursor: 'pointer',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            color: 'var(--color-primary-text)',
            backdropFilter: 'blur(10px)',
            transition: 'all var(--duration-normal) var(--easing-fluid)'
          }}
        >
          <option value="">All Projects</option>
          {mockProjects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-6)',
          boxShadow: '0 8px 32px rgba(31, 41, 55, 0.1)'
        }}
      >
        {/* Calendar Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-6)'
        }}>
          <button
            onClick={previousMonth}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.08)',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-primary-text)',
              transition: 'all var(--duration-normal) var(--easing-fluid)'
            }}
          >
            ← Prev
          </button>
          <h2 style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--font-weight-bold)',
            color: 'var(--color-primary)',
            fontFamily: 'var(--font-sans)',
            margin: 0
          }}>
            {monthNames[month]} {year}
          </h2>
          <button
            onClick={nextMonth}
            style={{
              padding: 'var(--space-2) var(--space-3)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.08)',
              backdropFilter: 'blur(10px)',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--color-primary-text)',
              transition: 'all var(--duration-normal) var(--easing-fluid)'
            }}
          >
            Next →
          </button>
        </div>

        {/* Weekday Headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)'
        }}>
          {dayNames.map(day => (
            <div
              key={day}
              style={{
                textAlign: 'center',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-secondary-text)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'var(--font-sans)',
                padding: 'var(--space-2)'
              }}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 'var(--space-2)'
        }}>
          {calendarDays.map((day, idx) => {
            const tasksForDay = day ? getTasksForDate(day) : [];
            const isToday = day === 15 && month === 5 && year === 2026;

            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.02 }}
                style={{
                  minHeight: '120px',
                  backgroundColor: day ? (isToday ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.08)') : 'transparent',
                  backdropFilter: 'blur(10px)',
                  border: isToday ? '2px solid var(--color-gold-primary)' : '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2)',
                  cursor: day ? 'pointer' : 'default',
                  transition: 'all var(--duration-normal) var(--easing-fluid)',
                  boxShadow: isToday ? '0 0 12px rgba(245, 158, 11, 0.3)' : 'none'
                }}
                whileHover={day ? { boxShadow: '0 8px 20px rgba(31, 41, 55, 0.1)', y: -2 } : {}}
              >
                {day && (
                  <>
                    <div style={{
                      fontWeight: 'var(--font-weight-semibold)',
                      fontSize: 'var(--font-size-sm)',
                      fontFamily: 'var(--font-sans)',
                      marginBottom: 'var(--space-2)',
                      backgroundColor: isToday ? 'var(--color-gold-primary)' : 'transparent',
                      color: isToday ? 'white' : 'var(--color-primary-text)',
                      padding: isToday ? '0.25rem 0.5rem' : '0',
                      borderRadius: 'var(--radius-sm)',
                      display: 'inline-block'
                    }}>
                      {day}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {tasksForDay.slice(0, 2).map(task => (
                        <div
                          key={task.id}
                          style={{
                            fontSize: '0.65rem',
                            padding: '0.25rem 0.375rem',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: getProjectColor(task.projectId),
                            color: 'white',
                            fontFamily: 'var(--font-sans)',
                            fontWeight: 'var(--font-weight-medium)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                          title={task.title}
                        >
                          {task.title.substring(0, 15)}
                        </div>
                      ))}
                      {tasksForDay.length > 2 && (
                        <div style={{
                          fontSize: '0.65rem',
                          color: 'var(--color-secondary-text)',
                          fontFamily: 'var(--font-sans)',
                          fontWeight: 'var(--font-weight-semibold)'
                        }}>
                          +{tasksForDay.length - 2} more
                        </div>
                      )}
                    </div>
                  </>
                )}
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
