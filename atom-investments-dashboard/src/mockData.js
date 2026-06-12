import { vaultProjects, vaultTasks, vaultTeamMembers } from './vaultDataExtractor';

export const mockUsers = {
  midom: { id: 1, name: "Mido Yasser", email: "mido@atominvestments.com", role: "CEO" },
  adam: { id: 2, name: "Adam Chodes", email: "adam@atominvestments.com", role: "Co-Founder" },
  kabrina: { id: 3, name: "Kabrina", email: "kabrina@atominvestments.com", role: "Operations" },
};

// Real data from Atom Investments Vault
export const mockProjects = vaultProjects;
export const mockTasks = vaultTasks;
export const mockTeamMembers = vaultTeamMembers;
