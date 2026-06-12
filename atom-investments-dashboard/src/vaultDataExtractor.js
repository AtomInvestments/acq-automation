// Vault Data Extractor
// This file generates real project data from the Atom Investments Vault
// In production, this would sync from a vault API or database

export const vaultProjects = [
  {
    id: 1,
    name: "APG",
    color: "#3b82f6",
    description: "Atom Property Group - Owner-operated acquisitions firm",
    status: "active",
    owner: "Mido Yasser",
    members: ["Mido Yasser", "Adam Chodes", "RJ", "Brady", "Justus"],
    pillars: [
      { name: "Pillar A - Blake Voice Agent", status: "SHIPPED-IDLE", progress: 50 },
      { name: "Pillar B - Listing Pipeline", status: "LIVE", progress: 70 },
      { name: "Pillar C - Vault + Self-Improvement", status: "SHIPPED-IDLE", progress: 50 },
      { name: "Pillar D - Training Videos", status: "DEFERRED", progress: 0 },
    ],
  },
  {
    id: 2,
    name: "KIN",
    color: "#8b5cf6",
    description: "Legacy & Memorialization App",
    status: "in-progress",
    owner: "Mido Yasser",
    members: ["Mido Yasser", "Adam Chodes", "Kabrina"],
    phases: [
      { phase: "Phase 0", status: "current", dueDate: "2026-06-19", completion: 40 },
      { phase: "Phase 1", status: "upcoming", dueDate: "2026-07-01", completion: 0 },
      { phase: "Phase 2", status: "upcoming", dueDate: "2026-07-15", completion: 0 },
      { phase: "Phase 3", status: "upcoming", dueDate: "2026-08-01", completion: 0 },
    ],
  },
  {
    id: 3,
    name: "ENDATCOURT",
    color: "#ec4899",
    description: "Court Records Platform",
    status: "planning",
    owner: "TBD",
    members: ["Mido Yasser"],
  },
  {
    id: 4,
    name: "FLOAT THEORY",
    color: "#f59e0b",
    description: "Financial Modeling Tool",
    status: "planning",
    owner: "TBD",
    members: ["Mido Yasser"],
  },
  {
    id: 5,
    name: "MEET IN THE MIDDLE",
    color: "#10b981",
    description: "Deal Negotiation Platform",
    status: "planning",
    owner: "TBD",
    members: ["Mido Yasser"],
  },
];

export const vaultTasks = [
  // APG Tasks
  { id: 1, projectId: 1, title: "Fix dialer warm-up curve", status: "in-progress", dueDate: "2026-06-15", assignee: "Mido", pillar: "Pillar A" },
  { id: 2, projectId: 1, title: "Wire funnel handoff metric", status: "pending", dueDate: "2026-06-20", assignee: "Mido", pillar: "Pillar A" },
  { id: 3, projectId: 1, title: "Fix realtor web-search lookup", status: "in-progress", dueDate: "2026-06-18", assignee: "Mido", pillar: "Pillar B" },
  { id: 4, projectId: 1, title: "Auto-promote iteration on 50 calls", status: "pending", dueDate: "2026-06-25", assignee: "Mido", pillar: "Pillar C" },

  // KIN Tasks
  { id: 5, projectId: 2, title: "Spin up Replit project skeleton", status: "in-progress", dueDate: "2026-06-13", assignee: "Mido", phase: "Phase 0" },
  { id: 6, projectId: 2, title: "Magic Moment design mock", status: "pending", dueDate: "2026-06-20", assignee: "Mido", phase: "Phase 0" },
  { id: 7, projectId: 2, title: "Author 200+ prompt library", status: "in-progress", dueDate: "2026-07-01", assignee: "Mido", phase: "Phase 0" },
  { id: 8, projectId: 2, title: "Adam legal review", status: "pending", dueDate: "2026-06-16", assignee: "Adam", phase: "Phase 0" },
];

export const vaultTeamMembers = [
  { id: 1, name: "Mido Yasser", role: "CEO / Operations Manager", projects: ["APG", "KIN", "ENDATCOURT", "FLOAT THEORY", "MEET IN THE MIDDLE"] },
  { id: 2, name: "Adam Chodes", role: "Co-Founder / Strategy", projects: ["APG", "KIN", "FLOAT THEORY"] },
  { id: 3, name: "Kabrina", role: "Product / Operations", projects: ["APG", "KIN"] },
  { id: 4, name: "RJ", role: "Acquisitions / Closer", projects: ["APG"] },
  { id: 5, name: "Brady", role: "Operations", projects: ["APG"] },
  { id: 6, name: "Justus", role: "Analyst", projects: ["APG"] },
];
