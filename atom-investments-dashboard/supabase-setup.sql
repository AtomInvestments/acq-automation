-- Atom Investments Dashboard Database Schema

-- Enable Auth (already enabled by default in Supabase)

-- Users table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Team members table
CREATE TABLE IF NOT EXISTS public.team_members (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  projects TEXT[], -- Array of project IDs/names
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending', -- pending, in-progress, completed
  due_date DATE,
  assignee TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Project members junction table
CREATE TABLE IF NOT EXISTS public.project_members (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Allow users to read all data (for now - can be restricted later)
CREATE POLICY "users_read" ON public.users
  FOR SELECT USING (true);

CREATE POLICY "projects_read" ON public.projects
  FOR SELECT USING (true);

CREATE POLICY "tasks_read" ON public.tasks
  FOR SELECT USING (true);

CREATE POLICY "team_members_read" ON public.team_members
  FOR SELECT USING (true);

CREATE POLICY "project_members_read" ON public.project_members
  FOR SELECT USING (true);

-- Allow authenticated users to insert
CREATE POLICY "users_insert" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Initial data insert - Atom Investments Projects
INSERT INTO public.projects (name, color, description) VALUES
  ('APG', '#3b82f6', 'Atom Property Group - RE Acquisitions'),
  ('KIN', '#8b5cf6', 'Legacy & Memorialization App'),
  ('ENDATCOURT', '#ec4899', 'Court Records Platform'),
  ('FLOAT THEORY', '#f59e0b', 'Financial Modeling Tool'),
  ('MEET IN THE MIDDLE', '#10b981', 'Deal Negotiation Platform')
ON CONFLICT (name) DO NOTHING;
