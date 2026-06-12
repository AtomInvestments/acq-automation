# Supabase Authentication Setup

## Overview
The Atom Investments Dashboard uses Supabase for real authentication. This replaces the mock login with secure GitHub OAuth.

## Setup Steps

### 1. ✅ Supabase Project Created
Your project is ready at: https://supabase.com/dashboard/project/fsmvvbyrdrkbyqjloupp

### 2. ✅ Credentials Configured
Environment variables are set in `.env.local` with your Supabase URL and anon key

### 3. ✅ Initialize Database Schema
1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy all content from `supabase-setup.sql` file
4. Paste into the SQL editor and run
5. This creates tables for: projects, tasks, team_members, users

### 4. Configure GitHub OAuth (Recommended)
1. In Supabase, go to **Authentication → Providers → GitHub**
2. Enable GitHub
3. Follow the prompts to create a GitHub OAuth app:
   - Go to GitHub Settings → Developer settings → OAuth Apps → New OAuth App
   - Application name: `Atom Investments Dashboard`
   - Homepage URL: `http://localhost:3000` (for dev) or your production URL
   - Authorization callback URL: (Supabase will provide this)
4. Copy the GitHub Client ID and Secret back into Supabase

### 5. Add GitHub Secrets (for GitHub Pages deployment)
1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add two new secrets:
   - `REACT_APP_SUPABASE_URL`: Your Supabase project URL
   - `REACT_APP_SUPABASE_ANON_KEY`: Your anon key
3. The GitHub Actions workflow will use these during build

### 6. Add Users (if using email/password auth)
1. In Supabase, go to **Authentication → Users**
2. Click "Invite user" and add team members' emails
3. They'll receive an invite link to set their password

## Testing
1. Run `npm start` in the dashboard directory
2. You should now see a "Sign in with GitHub" button (if GitHub OAuth is set up)
3. Or sign in with your Supabase email

## Deployment
When pushing to GitHub Pages:
1. Add these secrets to your GitHub repo settings:
   - `REACT_APP_SUPABASE_URL`
   - `REACT_APP_SUPABASE_ANON_KEY`
2. The GitHub Actions workflow will use these for the build

## Troubleshooting
- **"Supabase not configured" warning**: You haven't set the environment variables yet
- **GitHub OAuth fails**: Check that the callback URL matches in both GitHub and Supabase settings
- **Users can't sign in**: Make sure the user exists in Supabase Authentication → Users
