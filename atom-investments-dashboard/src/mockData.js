export const mockUsers = {
  midom: { id: 1, name: "Mido Yasser", email: "mido@atominvestments.com", role: "CEO" },
  adam: { id: 2, name: "Adam Chodes", email: "adam@atominvestments.com", role: "Co-Founder" },
  kabrina: { id: 3, name: "Kabrina", email: "kabrina@atominvestments.com", role: "Operations" },
};

export const mockProjects = [
  { id: 1, name: "APG", color: "#3b82f6", description: "Atom Property Group", members: ["Mido Yasser", "Adam Chodes", "RJ", "Brady", "Justus"] },
  { id: 2, name: "KIN", color: "#8b5cf6", description: "Legacy & Memorialization App", members: ["Mido Yasser", "Adam Chodes", "Kabrina"] },
  { id: 3, name: "ENDATCOURT", color: "#ec4899", description: "Court Records Platform", members: ["Mido Yasser"] },
  { id: 4, name: "FLOAT THEORY", color: "#f59e0b", description: "Financial Modeling Tool", members: ["Mido Yasser", "Adam Chodes"] },
  { id: 5, name: "MEET IN THE MIDDLE", color: "#10b981", description: "Deal Negotiation Platform", members: ["Mido Yasser", "Adam Chodes", "Kabrina"] },
];

export const mockTasks = [
  // APG
  { id: 1, projectId: 1, title: "Fix dialer warm-up curve", status: "in-progress", dueDate: "2026-06-15", assignee: "Mido" },
  { id: 2, projectId: 1, title: "Wire funnel handoff metric", status: "pending", dueDate: "2026-06-20", assignee: "Mido" },
  { id: 3, projectId: 1, title: "Fix realtor web-search lookup", status: "in-progress", dueDate: "2026-06-18", assignee: "Mido" },
  { id: 4, projectId: 1, title: "Auto-promote iteration on 50 calls", status: "pending", dueDate: "2026-06-25", assignee: "Mido" },
  // KIN
  { id: 5, projectId: 2, title: "Spin up Replit project skeleton", status: "in-progress", dueDate: "2026-06-13", assignee: "Mido" },
  { id: 6, projectId: 2, title: "Magic Moment design mock", status: "pending", dueDate: "2026-06-20", assignee: "Mido" },
  { id: 7, projectId: 2, title: "Author 200+ prompt library", status: "in-progress", dueDate: "2026-07-01", assignee: "Mido" },
  { id: 8, projectId: 2, title: "Adam legal review", status: "pending", dueDate: "2026-06-16", assignee: "Adam" },
];

export const mockTeamMembers = [
  { id: 1, name: "Mido Yasser", role: "CEO / Operations Manager", projects: ["APG", "KIN", "ENDATCOURT", "FLOAT THEORY", "MEET IN THE MIDDLE"] },
  { id: 2, name: "Adam Chodes", role: "Co-Founder / Strategy", projects: ["APG", "KIN", "FLOAT THEORY", "MEET IN THE MIDDLE"] },
  { id: 3, name: "Kabrina", role: "Product / Operations", projects: ["APG", "KIN", "MEET IN THE MIDDLE"] },
  { id: 4, name: "RJ", role: "Acquisitions / Closer", projects: ["APG"] },
  { id: 5, name: "Brady", role: "Operations", projects: ["APG"] },
  { id: 6, name: "Justus", role: "Analyst", projects: ["APG"] },
];
