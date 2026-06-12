# Supabase Authentication Setup

## Overview
The Atom Investments Dashboard uses Supabase for real authentication. This replaces the mock login with secure GitHub OAuth.

## Setup Steps

### 1. Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and sign up
2. Create a new project (free tier available)
3. Wait for the project to initialize (~2 minutes)

### 2. Get Your Credentials
1. In Supabase dashboard, go to **Settings → API**
2. Copy your **Project URL** (should look like `https://xxxxxx.supabase.co`)
3. Copy your **anon public** key (under `anon key`)

### 3. Configure Environment Variables
1. In the `atom-investments-dashboard/` directory, create a `.env.local` file
2. Add these lines:
```
REACT_APP_SUPABASE_URL=https://your-project-url.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Configure GitHub OAuth (Optional but Recommended)
1. In Supabase, go to **Authentication → Providers → GitHub**
2. Enable GitHub
3. Follow the prompts to create a GitHub OAuth app:
   - Go to GitHub Settings → Developer settings → OAuth Apps → New OAuth App
   - Application name: `Atom Investments Dashboard`
   - Homepage URL: `http://localhost:3000` (for dev) or your production URL
   - Authorization callback URL: (Supabase will provide this)
4. Copy the GitHub Client ID and Secret back into Supabase

### 5. Add Users (if using email/password auth)
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
