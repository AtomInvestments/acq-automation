import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';

export default function Overview() {
  const totalTasks = mockTasks.length;
  const inProgress = mockTasks.filter(t => t.status === 'in-progress').length;
  const completed = mockTasks.filter(t => t.status === 'completed').length;

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return { bg: '#ecfdf5', text: '#065f46', border: '#d1fae5' };
      case 'in-progress':
        return { bg: '#eff6ff', text: '#0c4a6e', border: '#bfdbfe' };
      case 'pending':
        return { bg: '#fef3c7', text: '#92400e', border: '#fde68a' };
      default:
        return { bg: '#f3f4f6', text: '#374151', border: '#e5e7eb' };
    }
  };

  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : '#6b7280';
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-2"
      >
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-600">Welcome back. Here's what's happening with your projects today.</p>
      </motion.div>

      {/* Stat Cards */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {[
          { label: 'Total Tasks', value: totalTasks, icon: '📋' },
          { label: 'In Progress', value: inProgress, icon: '⚙️' },
          { label: 'Completed', value: completed, icon: '✓' }
        ].map((stat) => (
          <motion.div
            key={stat.label}
            variants={itemVariants}
            className="bg-white border border-slate-200 rounded-lg p-6 hover:shadow-md transition-shadow duration-200"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-600 font-medium">{stat.label}</p>
                <p className="text-2xl font-bold text-slate-900 mt-2">{stat.value}</p>
              </div>
              <span className="text-2xl">{stat.icon}</span>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Data Table */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.4 }}
        className="bg-white border border-slate-200 rounded-lg overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Task</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Project</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Due Date</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-slate-900">Assignee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {mockTasks.slice(0, 8).map((task, idx) => {
                const project = mockProjects.find(p => p.id === task.projectId);
                const statusColor = getStatusColor(task.status);
                return (
                  <motion.tr
                    key={task.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 + idx * 0.03 }}
                    className="hover:bg-slate-50 transition-colors duration-150"
                  >
                    <td className="px-6 py-3 text-sm text-slate-900">{task.title}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center gap-2 text-sm text-slate-600">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: project?.color }}></span>
                        {project?.name}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className="inline-flex px-2 py-1 text-xs font-medium rounded-full"
                        style={{ backgroundColor: statusColor.bg, color: statusColor.text, borderColor: statusColor.border }}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-600">{task.dueDate}</td>
                    <td className="px-6 py-3 text-sm text-slate-900">{task.assignee}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
