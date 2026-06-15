export const mockUsers = {
  midom: { id: 1, name: "Mido Ahmed", email: "mido@atominvestments.com", role: "CEO" },
  adam: { id: 2, name: "Adam Chodes", email: "adam@atominvestments.com", role: "Co-Founder" },
  kabrina: { id: 3, name: "Kabrina", email: "kabrina@atominvestments.com", role: "Operations" },
};

export const mockProjects = [
  { id: 1, name: "APG", color: "#3b82f6", members: ["Mido", "Adam", "Kabrina", "Brady", "Justus"] },
  { id: 2, name: "KIN", color: "#8b5cf6", members: ["Mido", "Adam"] },
  { id: 3, name: "ENDATCOURT", color: "#ec4899", members: ["Mido", "Kabrina"] },
  { id: 4, name: "FLOAT THEORY", color: "#f59e0b", members: ["Adam", "Kabrina"] },
  { id: 5, name: "MEET IN THE MIDDLE", color: "#10b981", members: ["Mido", "Adam", "Kabrina"] },
];

export const mockTasks = [
  // APG
  { id: 1, projectId: 1, title: "Update property listings", status: "in-progress", dueDate: "2026-06-15", assignee: "Brady" },
  { id: 2, projectId: 1, title: "Review market analysis", status: "completed", dueDate: "2026-06-10", assignee: "Justus" },
  { id: 3, projectId: 1, title: "Prepare acquisition proposal", status: "pending", dueDate: "2026-06-20", assignee: "Mido" },
  // KIN
  { id: 4, projectId: 2, title: "Dashboard development", status: "in-progress", dueDate: "2026-06-18", assignee: "Adam" },
  { id: 5, projectId: 2, title: "API integration", status: "pending", dueDate: "2026-06-25", assignee: "Mido" },
  // ENDATCOURT
  { id: 6, projectId: 3, title: "Legal review", status: "in-progress", dueDate: "2026-06-17", assignee: "Kabrina" },
  { id: 7, projectId: 3, title: "Document preparation", status: "pending", dueDate: "2026-06-22", assignee: "Mido" },
  // FLOAT THEORY
  { id: 8, projectId: 4, title: "Strategy meeting", status: "completed", dueDate: "2026-06-12", assignee: "Adam" },
  { id: 9, projectId: 4, title: "Financial modeling", status: "in-progress", dueDate: "2026-06-19", assignee: "Kabrina" },
  // MEET IN THE MIDDLE
  { id: 10, projectId: 5, title: "Kickoff meeting", status: "completed", dueDate: "2026-06-11", assignee: "Mido" },
  { id: 11, projectId: 5, title: "Initial planning", status: "in-progress", dueDate: "2026-06-16", assignee: "Adam" },
];

export const mockTeamMembers = [
  { id: 1, name: "Mido Ahmed", role: "CEO", projects: ["APG", "KIN", "ENDATCOURT", "MEET IN THE MIDDLE"] },
  { id: 2, name: "Adam Chodes", role: "Co-Founder", projects: ["APG", "KIN", "FLOAT THEORY", "MEET IN THE MIDDLE"] },
  { id: 3, name: "Kabrina", role: "Operations", projects: ["APG", "ENDATCOURT", "FLOAT THEORY", "MEET IN THE MIDDLE"] },
  { id: 4, name: "Brady", role: "Project Manager", projects: ["APG"] },
  { id: 5, name: "Justus", role: "Analyst", projects: ["APG"] },
];
