# ATOM Investments Dashboard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the ATOM Investments dashboard to be corporate refined, professionally animated, and responsive using Framer Motion + 21st.dev components.

**Architecture:** 
- Design tokens (CSS custom properties) + design skill for consistency
- Shell components (TopNav, RightSidebar) with smooth toggle animation
- Section components (Overview, Projects, Roadmap, Team) rebuilt with Framer Motion scroll triggers and entrance animations
- Responsive layout: Desktop full sidebar → Tablet icon-only sidebar → Mobile drawer overlay
- 4-step tech stack: Claude Code + React 19 + Framer Motion + 21st.dev components

**Tech Stack:**
- React 19.2.7 (existing)
- Framer Motion 11+ (new)
- Supabase 2.108.1 (existing, keep)
- CSS custom properties for design tokens
- GitHub Pages deployment (existing)

---

## File Structure

**New Files to Create:**
```
src/
  components/
    layout/
      TopNav.jsx          — Navigation bar with tabs and user menu
      RightSidebar.jsx    — User profile, quick stats, logout (toggleable)
    common/
      Card.jsx            — Reusable card with shadow/hover states
      Button.jsx          — Button component (primary/secondary states)
      StatusBadge.jsx     — Status badge (completed/in-progress/pending)
      LoadingSkeletons.jsx — Shimmer skeleton screens
  styles/
    tokens.css            — CSS custom properties (colors, typography, spacing)
  .claude/
    skills/
      frontend-design.md  — Design system & taste rules for Claude
```

**Files to Modify:**
```
src/
  App.js                  — Add sidebar state, update layout structure
  index.css               — Import tokens.css, reset defaults
  pages/
    LoginPage.jsx         — Redesign with deep charcoal theme
    Dashboard.jsx         — Update structure for TopNav + RightSidebar
  components/
    Overview.jsx          — Add animations, improve layout
    Projects.jsx          — Integrate 21st.dev cards, animations
    Roadmap.jsx           — Timeline reorganization, animations
    Team.jsx              — Org bubbles, animations
package.json              — Add Framer Motion dependency
```

---

## Phase 1: Setup & Foundation

### Task 1: Create Design Tokens (CSS Custom Properties)

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/index.css`

**Step 1:** Create tokens.css with color, typography, and spacing variables

```css
/* src/styles/tokens.css */

:root {
  /* Colors */
  --color-primary: #1f2937;          /* Deep charcoal */
  --color-primary-light: #374151;    /* Lighter charcoal for hover */
  --color-neutral-50: #f9fafb;       /* Off-white background */
  --color-neutral-100: #f3f4f6;      /* Light gray */
  --color-neutral-200: #e5e7eb;      /* Border gray */
  --color-neutral-500: #6b7280;      /* Secondary text */
  --color-neutral-900: #111111;      /* Primary text */
  --color-white: #ffffff;
  
  --color-project-apg: #3b82f6;      /* Blue */
  --color-project-kin: #8b5cf6;      /* Purple */
  --color-project-endatcourt: #ec4899; /* Pink */
  --color-project-float: #f59e0b;    /* Amber */
  --color-project-mitm: #10b981;     /* Green */
  
  --color-status-completed-bg: #dcfce7;
  --color-status-completed-text: #15803d;
  --color-status-progress-bg: #dbeafe;
  --color-status-progress-text: #0c4a6e;
  --color-status-pending-bg: #fef3c7;
  --color-status-pending-text: #92400e;
  
  --color-error: #dc2626;
  
  /* Typography */
  --font-sans: 'Poppins', 'DM Sans', 'Avenir Next', sans-serif;
  --font-serif: 'Merriweather', 'Lora', 'Crimson Text', serif;
  
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 20px;
  --font-size-xl: 24px;
  --font-size-2xl: 28px;
  --font-size-3xl: 32px;
  
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  
  --line-height-tight: 1.4;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.6;
  
  /* Spacing (8px base grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  
  /* Border radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
  
  /* Shadows */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.15);
  
  /* Transitions */
  --transition-fast: 0.2s ease-out;
  --transition-base: 0.3s ease-out;
  --transition-slow: 0.4s ease-out;
}
```

- [ ] **Step 2: Update src/index.css to import tokens**

```css
/* src/index.css */

@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Merriweather:wght@400;700&display=swap');

@import './styles/tokens.css';

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-serif);
  font-size: var(--font-size-base);
  line-height: var(--line-height-normal);
  color: var(--color-neutral-900);
  background-color: var(--color-neutral-50);
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-sans);
  font-weight: var(--font-weight-bold);
  line-height: var(--line-height-tight);
}

button, input, textarea {
  font-family: inherit;
}

input, textarea {
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-4);
  font-size: var(--font-size-sm);
}

input:focus, textarea:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(31, 41, 55, 0.1);
}
```

- [ ] **Step 3: Run app to verify tokens loaded**

```bash
npm start
```

Check browser console for no CSS errors. Page should load with new typography.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css src/index.css
git commit -m "feat: add design tokens (colors, typography, spacing)"
```

---

### Task 2: Create Frontend Design Skill

**Files:**
- Create: `src/.claude/skills/frontend-design.md`

- [ ] **Step 1: Create the design skill file**

```markdown
# Frontend Design Skill — ATOM Investments Dashboard

## Purpose
Guide Claude Code toward consistent, professional, corporate-refined design. Use these rules for all UI components.

## Design Principles

1. **Corporate Refined:** Sophisticated, structured, understated elegance. No playful rounded corners. Careful typography pairing (sans + serif).
2. **Consistency:** All components use design tokens from src/styles/tokens.css. Never use hard-coded hex colors.
3. **Hierarchy:** Clear visual hierarchy through typography scale, spacing, color intensity. Never make all elements equal weight.
4. **Restraint:** Animations enhance, not distract. Hover states subtle (shadow/opacity shifts), not flashy.

## Color Palette Rules

- **Primary (Nav/Buttons):** Always use `--color-primary` (#1f2937 deep charcoal)
- **Project Badges:** Use project color variables (--color-project-apg, etc.)
- **Status Badges:** Use status color vars (--color-status-completed-bg, etc.)
- **Text:** 
  - Headings/Primary: `--color-neutral-900` (#111)
  - Body/Secondary: `--color-neutral-500` (#6b7280)
  - Disabled: `--color-neutral-200` (#e5e7eb)
- **Backgrounds:**
  - Page: `--color-neutral-50` (#f9fafb)
  - Cards/Elevated: `--color-white` (#fff)
  - Hover/Light: `--color-neutral-100` (#f3f4f6)

## Typography Rules

- **Sans-serif (var(--font-sans)):** Navigation, buttons, headings, labels. Weight 600-700 for headings, 500 for buttons.
- **Serif (var(--font-serif)):** Body text, descriptions, table content. Weight 400-500.
- **Never mix:** Don't use serif for nav or sans for body paragraphs.
- **Size scale:** Always use var(--font-size-*) variables. No magic 15px or 17px.
- **Line height:** var(--line-height-relaxed) for body (1.6), var(--line-height-tight) for headings (1.4)

## Spacing Rules

- **Grid-based:** All padding/margin are multiples of 8px (use --space-1 through --space-12)
- **Card padding:** 24px (--space-6)
- **Button padding:** 12px vertical × 24px horizontal (mix --space-3 and --space-6)
- **Gap between items:** 16px (--space-4)
- **Section spacing:** 32px (--space-8) between major sections

## Component Patterns

### Cards
- Background: white, border: 1px gray, shadow: var(--shadow-sm), radius: 8px
- Hover: shadow becomes var(--shadow-lg), background unchanged
- No rounded corners > 12px

### Buttons
- Primary: charcoal bg, white text, 12px-24px padding, 6px radius
- Secondary: transparent bg, charcoal text, charcoal border, same padding
- Hover: background lightens 10% (use opacity shift, not new color)
- Never: all-caps text, heavy borders, glowing effects

### Form Inputs
- Border: 1px gray, focus border charcoal with subtle shadow
- Padding: 10px 14px (8px + 6px)
- Radius: 6px
- No floating labels; use placeholder + label above

### Status Badges
- Pill-shaped (radius: 9999px)
- Padding: 6px 12px
- Size: 12px font, semibold weight
- Colors: Use status color vars (completed/in-progress/pending)

## Animation Rules

- **Transitions:** Use var(--transition-fast) for hovers, var(--transition-base) for state changes
- **Entrance:** Framer Motion fade-in (opacity 0→1) + stagger (0.1-0.15s between children)
- **Scroll:** Cards fade in when scrolled into view (Intersection Observer)
- **Click feedback:** Scale 0.95→1 for buttons (50ms)
- **Micro-interactions:** Underlines, shadows, opacity shifts. Never rotation or skew.
- **Avoid:** Parallax, 3D transforms, bounce easing (use ease-out)

## Layout Patterns

- **Max-width containers:** 1280px centered
- **Top nav height:** 64px (desktop), 56px (mobile)
- **Sidebar width:** 280px, collapses to 60px on tablet
- **Grid gaps:** 16px (--space-4) between cards
- **Padding:** 32px top/bottom, 24px left/right (use --space-8 and --space-6)

## Responsive Design

- **Desktop (1280px+):** Full layout, sidebar visible
- **Tablet (768–1279px):** Sidebar collapses to icons
- **Mobile (<768px):** Sidebar drawer overlay, full-width content

Use CSS media queries sparingly; prefer responsive grid/flex layout.

## Code Style

- Use design token variables (`var(--color-primary)`) instead of hex codes
- Inline styles when building React components: `style={{ backgroundColor: 'var(--color-primary)' }}`
- Or use .module.css with tokens imported
- className conventions: BEM-style for CSS modules (`card__header`, `button--primary`)
- Comments: Explain *why*, not what. Code is self-documenting via good naming + tokens.

## Taste Rules

1. **Understate:** If you're tempted to add visual flourish, remove it instead.
2. **Consistency first:** A boring, consistent design beats a flashy, inconsistent one.
3. **Hierarchy matters:** Bigger != more important. Use color, weight, and position, not just size.
4. **White space:** Cards should breathe. Don't cram content. Trust the padding.
5. **Details count:** Border colors, hover shadows, focus states matter more than flashy animations.
6. **Typography carries the load:** With good sans/serif pairing, minimal color work needed.

## Examples (Bad → Good)

**Bad:** `<button style={{background: '#1f2937', padding: '8px 16px', borderRadius: '20px'}}>Click me</button>`
**Good:** `<button style={{background: 'var(--color-primary)', padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-sm)'}}>Click me</button>`

**Bad:** Multiple colors in nav (blue, red, green for different tabs)
**Good:** Charcoal nav, project color underlines only for active tab

**Bad:** Cards with 16px padding, shadows, borders, and hover scale-up
**Good:** Cards with 24px padding, shadow elevation on hover only

## When in doubt:
- Check the spec (docs/superpowers/specs/2026-06-15-atom-dashboard-redesign.md)
- Use design tokens
- Keep it simple
- Make it consistent
```

- [ ] **Step 2: Commit**

```bash
git add src/.claude/skills/frontend-design.md
git commit -m "feat: add frontend design skill with tokens & patterns"
```

---

### Task 3: Install Framer Motion

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Framer Motion**

```bash
npm install framer-motion
```

- [ ] **Step 2: Verify installation**

```bash
npm list framer-motion
```

Expected output: `framer-motion@11.0.0` or similar (latest)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install framer-motion for animations"
```

---

### Task 4: Create Common Components (Card, Button, StatusBadge)

**Files:**
- Create: `src/components/common/Card.jsx`
- Create: `src/components/common/Button.jsx`
- Create: `src/components/common/StatusBadge.jsx`
- Create: `src/components/common/LoadingSkeletons.jsx`

- [ ] **Step 1: Create Card.jsx**

```jsx
// src/components/common/Card.jsx
import { motion } from 'framer-motion';

export default function Card({ children, className = '', onClick = null, hoverable = true }) {
  const cardStyle = {
    backgroundColor: 'var(--color-white)',
    border: '1px solid var(--color-neutral-200)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-6)',
    boxShadow: 'var(--shadow-sm)',
    transition: 'all var(--transition-fast)',
    cursor: onClick ? 'pointer' : 'default',
  };

  const hoverStyle = hoverable ? {
    onMouseEnter: (e) => {
      e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
    },
  } : {};

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={cardStyle}
      onClick={onClick}
      {...hoverStyle}
      className={className}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Create Button.jsx**

```jsx
// src/components/common/Button.jsx
import { motion } from 'framer-motion';

export default function Button({ 
  children, 
  variant = 'primary', 
  onClick = null, 
  disabled = false,
  type = 'button',
  ...props 
}) {
  const baseStyle = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    padding: 'var(--space-3) var(--space-6)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all var(--transition-fast)',
    opacity: disabled ? 0.5 : 1,
  };

  const variantStyle = variant === 'primary' 
    ? {
        backgroundColor: 'var(--color-primary)',
        color: 'var(--color-white)',
      }
    : {
        backgroundColor: 'transparent',
        color: 'var(--color-primary)',
        border: '1px solid var(--color-primary)',
      };

  const style = { ...baseStyle, ...variantStyle };

  const handleClick = (e) => {
    if (!disabled && onClick) {
      onClick(e);
    }
  };

  return (
    <motion.button
      type={type}
      style={style}
      onClick={handleClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.95 }}
      transition={{ duration: 0.05 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
```

- [ ] **Step 3: Create StatusBadge.jsx**

```jsx
// src/components/common/StatusBadge.jsx

export default function StatusBadge({ status }) {
  const statusMap = {
    completed: {
      bg: 'var(--color-status-completed-bg)',
      text: 'var(--color-status-completed-text)',
      label: 'Completed',
    },
    'in-progress': {
      bg: 'var(--color-status-progress-bg)',
      text: 'var(--color-status-progress-text)',
      label: 'In Progress',
    },
    pending: {
      bg: 'var(--color-status-pending-bg)',
      text: 'var(--color-status-pending-text)',
      label: 'Pending',
    },
  };

  const statusData = statusMap[status] || statusMap.pending;

  const style = {
    display: 'inline-block',
    backgroundColor: statusData.bg,
    color: statusData.text,
    padding: 'var(--space-1) var(--space-4)',
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
  };

  return <span style={style}>{statusData.label}</span>;
}
```

- [ ] **Step 4: Create LoadingSkeletons.jsx**

```jsx
// src/components/common/LoadingSkeletons.jsx
import { motion } from 'framer-motion';

const shimmer = {
  initial: { backgroundPosition: '200% center' },
  animate: { backgroundPosition: '-200% center' },
};

export default function SkeletonCard() {
  const style = {
    backgroundColor: 'var(--color-neutral-200)',
    backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
    backgroundSize: '200% 100%',
    borderRadius: 'var(--radius-md)',
    height: '120px',
    marginBottom: 'var(--space-4)',
  };

  return (
    <motion.div
      style={style}
      variants={shimmer}
      initial="initial"
      animate="animate"
      transition={{ duration: 2, repeat: Infinity }}
    />
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/common/
git commit -m "feat: create common components (Card, Button, StatusBadge, LoadingSkeletons)"
```

---

## Phase 2: Authentication & Shell

### Task 5: Redesign LoginPage with Deep Charcoal Theme

**Files:**
- Modify: `src/pages/LoginPage.jsx`

- [ ] **Step 1: Replace LoginPage.jsx content**

```jsx
// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase, signInWithGitHub } from '../supabaseConfig';
import { mockUsers } from '../mockData';
import Button from '../components/common/Button';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          onLogin({
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email,
            email: session.user.email,
            role: 'User',
          });
        }
      });
    }
  }, [onLogin]);

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const { error: authError } = await signInWithGitHub();
      if (authError) throw authError;
    } catch (err) {
      setError(err.message || 'GitHub login failed');
      setIsLoading(false);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) throw authError;

      if (data?.user) {
        onLogin({
          id: data.user.id,
          name: data.user.user_metadata?.name || email,
          email: data.user.email,
          role: 'User',
        });
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMockLogin = (e) => {
    e.preventDefault();
    const user = mockUsers[email.toLowerCase()];

    if (user && password === 'demo') {
      onLogin(user);
    } else {
      setError('Invalid credentials. Try: midom, adam, or kabrina (password: demo)');
    }
  };

  const containerStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1f2937 0%, #374151 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-4)',
  };

  const cardStyle = {
    width: '100%',
    maxWidth: '420px',
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-8)',
    boxShadow: 'var(--shadow-xl)',
  };

  const logoStyle = {
    textAlign: 'center',
    marginBottom: 'var(--space-8)',
  };

  const logoTextStyle = {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-primary)',
    margin: '0 0 var(--space-2) 0',
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    margin: 0,
    fontFamily: 'var(--font-serif)',
  };

  const dividerStyle = {
    height: '1px',
    backgroundColor: 'var(--color-neutral-200)',
    margin: 'var(--space-6) 0',
  };

  const formStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  };

  const inputWrapperStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  };

  const labelStyle = {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
  };

  const inputStyle = {
    border: '1px solid var(--color-neutral-200)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-2) var(--space-4)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-serif)',
    transition: 'border-color var(--transition-fast)',
  };

  const errorStyle = {
    padding: 'var(--space-3)',
    backgroundColor: 'var(--color-status-pending-bg)',
    border: `1px solid ${''} var(--color-status-pending-text)`,
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-status-pending-text)',
    fontFamily: 'var(--font-sans)',
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
  };

  return (
    <div style={containerStyle}>
      <motion.div
        style={cardStyle}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
      >
        <motion.div style={logoStyle} variants={containerVariants} initial="hidden" animate="visible">
          <motion.h1 style={logoTextStyle} variants={itemVariants}>
            ATOM
          </motion.h1>
          <motion.p style={subtitleStyle} variants={itemVariants}>
            Investments Dashboard
          </motion.p>
        </motion.div>

        {supabase && (
          <motion.div variants={itemVariants} initial="hidden" animate="visible">
            <Button
              onClick={handleGitHubLogin}
              disabled={isLoading}
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in...' : 'Sign in with GitHub'}
            </Button>
            <div style={dividerStyle} />
          </motion.div>
        )}

        <motion.form
          onSubmit={!supabase ? handleMockLogin : handleEmailLogin}
          style={formStyle}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div style={inputWrapperStyle} variants={itemVariants}>
            <label style={labelStyle}>
              {!supabase ? 'Username' : 'Email'}
            </label>
            <input
              type={!supabase ? 'text' : 'email'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={!supabase ? 'midom, adam, or kabrina' : 'you@example.com'}
              disabled={isLoading}
              style={{ ...inputStyle, opacity: isLoading ? 0.7 : 1 }}
            />
          </motion.div>

          <motion.div style={inputWrapperStyle} variants={itemVariants}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={!supabase ? 'demo' : '••••••••'}
              disabled={isLoading}
              style={{ ...inputStyle, opacity: isLoading ? 0.7 : 1 }}
            />
          </motion.div>

          {error && (
            <motion.div style={errorStyle} variants={itemVariants}>
              {error}
            </motion.div>
          )}

          <motion.div variants={itemVariants}>
            <Button
              type="submit"
              disabled={isLoading}
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </motion.div>
        </motion.form>

        {!supabase && (
          <motion.div
            style={{
              marginTop: 'var(--space-6)',
              paddingTop: 'var(--space-6)',
              borderTop: '1px solid var(--color-neutral-200)',
              textAlign: 'center',
            }}
            variants={itemVariants}
            initial="hidden"
            animate="visible"
          >
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-neutral-500)', margin: 'var(--space-2) 0' }}>
              ⚠️ Mock Demo Mode (Supabase not configured)
            </p>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-neutral-500)', margin: 0 }}>
              Username: midom, adam, or kabrina<br />
              Password: demo
            </p>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/LoginPage.jsx
git commit -m "feat: redesign login page with deep charcoal theme and Framer Motion"
```

---

### Task 6: Create TopNav Component

**Files:**
- Create: `src/components/layout/TopNav.jsx`

- [ ] **Step 1: Create TopNav.jsx**

```jsx
// src/components/layout/TopNav.jsx
import { motion } from 'framer-motion';

export default function TopNav({ 
  currentPage, 
  onTabChange, 
  user, 
  onProfileClick, 
  onSidebarToggle 
}) {
  const navStyle = {
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-white)',
    padding: '0 var(--space-6)',
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: 'var(--shadow-sm)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  };

  const leftSectionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-8)',
  };

  const logoStyle = {
    fontSize: 'var(--font-size-2xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-white)',
    margin: 0,
  };

  const tabsStyle = {
    display: 'flex',
    gap: 'var(--space-6)',
  };

  const tabStyle = (isActive) => ({
    background: 'none',
    border: 'none',
    color: isActive ? 'var(--color-white)' : 'rgba(255,255,255,0.7)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-weight-semibold)',
    cursor: 'pointer',
    padding: '0',
    paddingBottom: '8px',
    borderBottom: isActive ? '2px solid var(--color-white)' : 'none',
    transition: 'all var(--transition-fast)',
  });

  const rightSectionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-4)',
  };

  const userButtonStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--color-white)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    cursor: 'pointer',
    padding: 'var(--space-2) var(--space-4)',
    borderRadius: 'var(--radius-sm)',
    transition: 'background-color var(--transition-fast)',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--font-size-sm)',
  };

  const avatarStyle = {
    width: '32px',
    height: '32px',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 'var(--radius-full)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 'var(--font-weight-bold)',
    fontSize: 'var(--font-size-sm)',
  };

  const hamburgerStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--color-white)',
    fontSize: '1.5rem',
    cursor: 'pointer',
    padding: 'var(--space-2)',
  };

  const tabs = [
    { id: 'dashboard', label: 'Overview' },
    { id: 'projects', label: 'Projects' },
    { id: 'roadmap', label: 'Roadmap' },
    { id: 'team', label: 'Team' },
  ];

  return (
    <nav style={navStyle}>
      <div style={leftSectionStyle}>
        <h1 style={logoStyle}>ATOM</h1>
        <div style={tabsStyle}>
          {tabs.map(tab => (
            <motion.button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={tabStyle(currentPage === tab.id)}
              whileHover={{ color: 'var(--color-white)' }}
            >
              {tab.label}
            </motion.button>
          ))}
        </div>
      </div>

      <div style={rightSectionStyle}>
        <motion.button
          style={userButtonStyle}
          onClick={onProfileClick}
          whileHover={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
          <div style={avatarStyle}>{user?.name?.charAt(0)}</div>
          <span>{user?.name}</span>
        </motion.button>
        <motion.button
          style={hamburgerStyle}
          onClick={onSidebarToggle}
          whileTap={{ scale: 0.9 }}
        >
          ☰
        </motion.button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/TopNav.jsx
git commit -m "feat: create TopNav component with tabs and user menu"
```

---

### Task 7: Create RightSidebar Component

**Files:**
- Create: `src/components/layout/RightSidebar.jsx`

- [ ] **Step 1: Create RightSidebar.jsx**

```jsx
// src/components/layout/RightSidebar.jsx
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../common/Button';

export default function RightSidebar({ 
  isOpen, 
  onClose, 
  user, 
  onLogout,
  taskStats = { total: 0, inProgress: 0, completed: 0 }
}) {
  const sidebarStyle = {
    position: 'fixed',
    right: 0,
    top: '64px',
    width: '280px',
    height: 'calc(100vh - 64px)',
    backgroundColor: 'var(--color-neutral-100)',
    borderLeft: '1px solid var(--color-neutral-200)',
    boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
    padding: 'var(--space-6)',
    overflow: 'auto',
    zIndex: 99,
  };

  const overlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 98,
  };

  const closeButtonStyle = {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    padding: 'var(--space-2)',
    marginBottom: 'var(--space-4)',
  };

  const profileCardStyle = {
    textAlign: 'center',
    marginBottom: 'var(--space-6)',
    paddingBottom: 'var(--space-6)',
    borderBottom: '1px solid var(--color-neutral-200)',
  };

  const avatarStyle = {
    width: '48px',
    height: '48px',
    borderRadius: 'var(--radius-full)',
    backgroundColor: 'var(--color-primary)',
    color: 'var(--color-white)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 'var(--font-size-xl)',
    fontWeight: 'var(--font-weight-bold)',
    margin: '0 auto var(--space-3)',
  };

  const nameStyle = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: '0 0 var(--space-1)',
  };

  const roleStyle = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-neutral-500)',
    margin: 0,
    fontFamily: 'var(--font-serif)',
  };

  const statsStyle = {
    marginBottom: 'var(--space-6)',
  };

  const statLabelStyle = {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    marginBottom: 'var(--space-2)',
  };

  const statCountStyle = {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-primary)',
    marginBottom: 'var(--space-4)',
  };

  const logoutButtonStyle = {
    width: '100%',
    marginTop: 'var(--space-6)',
  };

  const sidebarVariants = {
    hidden: { x: 280, opacity: 0 },
    visible: { x: 0, opacity: 1, transition: { duration: 0.4 } },
    exit: { x: 280, opacity: 0, transition: { duration: 0.3 } },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            style={overlayStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            style={sidebarStyle}
            variants={sidebarVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <motion.button
              style={closeButtonStyle}
              onClick={onClose}
              whileTap={{ scale: 0.9 }}
            >
              ✕
            </motion.button>

            <motion.div
              style={profileCardStyle}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <div style={avatarStyle}>
                {user?.name?.charAt(0)}
              </div>
              <p style={nameStyle}>{user?.name}</p>
              <p style={roleStyle}>{user?.role}</p>
            </motion.div>

            <motion.div
              style={statsStyle}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <p style={statLabelStyle}>Total Tasks</p>
                <p style={statCountStyle}>{taskStats.total}</p>
              </div>
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <p style={statLabelStyle}>In Progress</p>
                <p style={statCountStyle}>{taskStats.inProgress}</p>
              </div>
              <div>
                <p style={statLabelStyle}>Completed</p>
                <p style={statCountStyle}>{taskStats.completed}</p>
              </div>
            </motion.div>

            <motion.div
              style={logoutButtonStyle}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Button
                onClick={onLogout}
                variant="secondary"
                style={{ width: '100%' }}
              >
                Sign Out
              </Button>
            </motion.div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/RightSidebar.jsx
git commit -m "feat: create RightSidebar component with toggle animation"
```

---

### Task 8: Update App.js to Wire TopNav & RightSidebar

**Files:**
- Modify: `src/App.js`

- [ ] **Step 1: Replace App.js content**

```jsx
// src/App.js
import { useState, useEffect } from 'react';
import './App.css';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import ProfilePage from './pages/ProfilePage';
import TopNav from './components/layout/TopNav';
import RightSidebar from './components/layout/RightSidebar';
import { supabase, signOut } from './supabaseConfig';
import { mockTasks } from './mockData';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          setCurrentUser({
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email,
            email: session.user.email,
            role: 'User',
          });
          setIsAuthenticated(true);
        }
        setIsLoading(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          setCurrentUser({
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email,
            email: session.user.email,
            role: 'User',
          });
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
          setCurrentUser(null);
        }
      });

      return () => subscription?.unsubscribe();
    } else {
      setIsLoading(false);
    }
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    if (supabase) {
      await signOut();
    }
    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentPage('dashboard');
    setSidebarOpen(false);
  };

  const handleProfileClick = () => {
    setCurrentPage('profile');
    setSidebarOpen(false);
  };

  // Calculate task stats
  const taskStats = {
    total: mockTasks.length,
    inProgress: mockTasks.filter(t => t.status === 'in-progress').length,
    completed: mockTasks.filter(t => t.status === 'completed').length,
  };

  if (isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const appStyle = {
    minHeight: '100vh',
    backgroundColor: 'var(--color-neutral-50)',
  };

  const mainContentStyle = {
    display: 'flex',
    minHeight: 'calc(100vh - 64px)',
  };

  const contentAreaStyle = {
    flex: 1,
    padding: 'var(--space-8) var(--space-6)',
    maxWidth: '1280px',
    margin: '0 auto',
    width: '100%',
  };

  return (
    <div style={appStyle}>
      <TopNav
        currentPage={currentPage}
        onTabChange={(page) => {
          setCurrentPage(page);
          setSidebarOpen(false);
        }}
        user={currentUser}
        onProfileClick={handleProfileClick}
        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      <RightSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={currentUser}
        onLogout={handleLogout}
        taskStats={taskStats}
      />

      <div style={mainContentStyle}>
        <div style={contentAreaStyle}>
          {currentPage === 'profile' ? (
            <ProfilePage user={currentUser} />
          ) : (
            <Dashboard page={currentPage} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 2: Test in browser**

```bash
npm start
```

Expected: Login page with deep charcoal gradient, TopNav + RightSidebar when logged in, sidebar toggle works smoothly.

- [ ] **Step 3: Commit**

```bash
git add src/App.js
git commit -m "feat: integrate TopNav and RightSidebar with toggle animation"
```

---

## Phase 3: Dashboard Sections

### Task 9: Redesign Overview Tab with Animations

**Files:**
- Modify: `src/components/Overview.jsx`

- [ ] **Step 1: Replace Overview.jsx**

```jsx
// src/components/Overview.jsx
import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';
import Card from './common/Card';
import StatusBadge from './common/StatusBadge';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Overview() {
  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : '#6b7280';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
  };

  const completedCount = mockTasks.filter(t => t.status === 'completed').length;
  const inProgressCount = mockTasks.filter(t => t.status === 'in-progress').length;

  const heroStyle = {
    marginBottom: 'var(--space-8)',
  };

  const greetingStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: '0 0 var(--space-2)',
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    margin: 0,
    fontFamily: 'var(--font-serif)',
  };

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 'var(--space-6)',
    marginBottom: 'var(--space-8)',
  };

  const statLabelStyle = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-neutral-500)',
    margin: '0 0 var(--space-2)',
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--font-weight-semibold)',
  };

  const statValueStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-primary)',
    margin: 0,
    fontFamily: 'var(--font-sans)',
  };

  const tableContainerStyle = {
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-neutral-200)',
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
  };

  const theadStyle = {
    backgroundColor: 'var(--color-neutral-100)',
    borderBottom: '1px solid var(--color-neutral-200)',
  };

  const thStyle = {
    padding: 'var(--space-4)',
    textAlign: 'left',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    textTransform: 'uppercase',
  };

  const tbodyTrStyle = {
    borderBottom: '1px solid var(--color-neutral-200)',
    transition: 'background-color var(--transition-fast)',
  };

  const tdStyle = {
    padding: 'var(--space-4)',
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-900)',
  };

  const badgeStyle = (color) => ({
    display: 'inline-block',
    padding: 'var(--space-1) var(--space-4)',
    borderRadius: 'var(--radius-full)',
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: '#fff',
    backgroundColor: color,
  });

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div style={heroStyle} variants={itemVariants}>
        <h1 style={greetingStyle}>Welcome to ATOM</h1>
        <p style={subtitleStyle}>Monitor your projects, tasks, and team activity</p>
      </motion.div>

      <motion.div style={statsGridStyle} variants={containerVariants} initial="hidden" animate="visible">
        {[
          { label: 'Total Tasks', value: mockTasks.length },
          { label: 'In Progress', value: inProgressCount },
          { label: 'Completed', value: completedCount },
        ].map((stat, i) => (
          <motion.div key={i} variants={itemVariants}>
            <Card>
              <p style={statLabelStyle}>{stat.label}</p>
              <motion.p
                style={statValueStyle}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.1 }}
              >
                {stat.value}
              </motion.p>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div variants={itemVariants}>
        <Card>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', fontFamily: 'var(--font-sans)', color: 'var(--color-neutral-900)', margin: '0 0 var(--space-4)' }}>All Tasks</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead style={theadStyle}>
                <tr>
                  <th style={thStyle}>Task</th>
                  <th style={thStyle}>Project</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Due Date</th>
                  <th style={thStyle}>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {mockTasks.map((task, i) => (
                  <motion.tr
                    key={task.id}
                    style={tbodyTrStyle}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 + i * 0.05 }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-neutral-100)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td style={tdStyle}>{task.title}</td>
                    <td style={tdStyle}>
                      <span style={badgeStyle(getProjectColor(task.projectId))}>
                        {getProjectName(task.projectId)}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={task.status} />
                    </td>
                    <td style={tdStyle}>{task.dueDate}</td>
                    <td style={tdStyle}>{task.assignee}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Overview.jsx
git commit -m "feat: redesign Overview with animations and improved layout"
```

---

### Task 10: Redesign Projects Tab with 21st.dev-Style Cards

**Files:**
- Modify: `src/components/Projects.jsx`

- [ ] **Step 1: Replace Projects.jsx**

```jsx
// src/components/Projects.jsx
import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockProjects, mockTasks } from '../mockData';
import Card from './common/Card';
import Button from './common/Button';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function Projects() {
  const [selectedProject, setSelectedProject] = useState(null);

  const getProjectTasks = (projectId) => {
    return mockTasks.filter(t => t.projectId === projectId);
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

  if (selectedProject) {
    const project = mockProjects.find(p => p.id === selectedProject);
    const tasks = getProjectTasks(selectedProject);

    const projectDetailStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-6)',
    };

    const backButtonStyle = {
      marginBottom: 'var(--space-4)',
      color: 'var(--color-primary)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontWeight: 'var(--font-weight-semibold)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--font-size-sm)',
    };

    const headerStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
    };

    const colorBoxStyle = {
      width: '3rem',
      height: '3rem',
      borderRadius: 'var(--radius-md)',
      backgroundColor: project.color,
    };

    const tableStyle = {
      width: '100%',
      borderCollapse: 'collapse',
    };

    const thStyle = {
      padding: 'var(--space-4)',
      textAlign: 'left',
      fontSize: 'var(--font-size-xs)',
      fontWeight: 'var(--font-weight-semibold)',
      fontFamily: 'var(--font-sans)',
      color: 'var(--color-neutral-900)',
      textTransform: 'uppercase',
      backgroundColor: 'var(--color-neutral-100)',
      borderBottom: '1px solid var(--color-neutral-200)',
    };

    const tdStyle = {
      padding: 'var(--space-4)',
      fontSize: 'var(--font-size-sm)',
      color: 'var(--color-neutral-900)',
      borderBottom: '1px solid var(--color-neutral-200)',
    };

    const badgeStyle = (color) => ({
      display: 'inline-block',
      padding: 'var(--space-1) var(--space-4)',
      borderRadius: 'var(--radius-full)',
      fontSize: 'var(--font-size-xs)',
      fontWeight: 'var(--font-weight-semibold)',
      fontFamily: 'var(--font-sans)',
      color: color.text,
      backgroundColor: color.bg,
    });

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.button
          style={backButtonStyle}
          onClick={() => setSelectedProject(null)}
          whileHover={{ color: 'var(--color-primary-light)' }}
        >
          ← Back to Projects
        </motion.button>

        <motion.div variants={itemVariants} initial="hidden" animate="visible">
          <Card>
            <div style={headerStyle}>
              <div style={colorBoxStyle} />
              <div>
                <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', fontFamily: 'var(--font-sans)', color: 'var(--color-neutral-900)', margin: 0 }}>
                  {project.name}
                </h2>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-neutral-500)', margin: 'var(--space-1) 0 0', fontFamily: 'var(--font-serif)' }}>
                  Team: {project.members.join(', ')}
                </p>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants} initial="hidden" animate="visible">
          <Card>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', fontFamily: 'var(--font-sans)', color: 'var(--color-neutral-900)', margin: '0 0 var(--space-4)' }}>Tasks</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Task</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Due Date</th>
                    <th style={thStyle}>Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map(task => (
                    <tr key={task.id} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-neutral-100)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      <td style={tdStyle}>{task.title}</td>
                      <td style={tdStyle}>
                        <span style={badgeStyle(getStatusColor(task.status))}>
                          {task.status}
                        </span>
                      </td>
                      <td style={tdStyle}>{task.dueDate}</td>
                      <td style={tdStyle}>{task.assignee}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </motion.div>
    );
  }

  const heroStyle = {
    marginBottom: 'var(--space-8)',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: 0,
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 'var(--space-6)',
  };

  const projectCardTopStyle = {
    height: '8px',
    borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
    marginBottom: 'var(--space-4)',
  };

  const projectNameStyle = {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: '0 0 var(--space-2)',
  };

  const descriptionStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    margin: '0 0 var(--space-4)',
    fontFamily: 'var(--font-serif)',
  };

  const membersStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
    marginBottom: 'var(--space-4)',
  };

  const memberBadgeStyle = {
    fontSize: 'var(--font-size-xs)',
    backgroundColor: 'var(--color-neutral-100)',
    color: 'var(--color-neutral-900)',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-sans)',
  };

  const progressBarStyle = {
    width: '100%',
    height: '8px',
    backgroundColor: 'var(--color-neutral-200)',
    borderRadius: 'var(--radius-full)',
    overflow: 'hidden',
    marginTop: 'var(--space-4)',
  };

  const progressFillStyle = (completed, total) => ({
    height: '100%',
    backgroundColor: 'var(--color-primary)',
    width: `${total ? (completed / total) * 100 : 0}%`,
    transition: 'width 0.5s ease-out',
  });

  const progressLabelStyle = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--color-neutral-500)',
    marginTop: 'var(--space-2)',
    textAlign: 'right',
    fontFamily: 'var(--font-sans)',
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div style={heroStyle} variants={itemVariants}>
        <h1 style={titleStyle}>Projects</h1>
      </motion.div>

      <motion.div style={gridStyle} variants={containerVariants} initial="hidden" animate="visible">
        {mockProjects.map(project => {
          const tasks = getProjectTasks(project.id);
          const completed = tasks.filter(t => t.status === 'completed').length;

          return (
            <motion.div
              key={project.id}
              variants={itemVariants}
              whileHover={{ scale: 1.02 }}
            >
              <Card onClick={() => setSelectedProject(project.id)} hoverable={true}>
                <div style={projectCardTopStyle} />
                <h3 style={projectNameStyle}>{project.name}</h3>
                <p style={descriptionStyle}>{project.description}</p>

                <div style={membersStyle}>
                  {project.members.slice(0, 3).map((member, idx) => (
                    <span key={idx} style={memberBadgeStyle}>{member.split(' ')[0]}</span>
                  ))}
                  {project.members.length > 3 && (
                    <span style={memberBadgeStyle}>+{project.members.length - 3}</span>
                  )}
                </div>

                <div style={progressBarStyle}>
                  <motion.div
                    style={progressFillStyle(completed, tasks.length)}
                    backgroundColor={project.color}
                    initial={{ width: 0 }}
                    animate={{ width: `${tasks.length ? (completed / tasks.length) * 100 : 0}%` }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                  />
                </div>
                <p style={progressLabelStyle}>{completed}/{tasks.length} complete</p>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Projects.jsx
git commit -m "feat: redesign Projects with 21st.dev-style cards and animations"
```

---

### Task 11: Redesign Roadmap Tab with Timeline View

**Files:**
- Modify: `src/components/Roadmap.jsx`

- [ ] **Step 1: Replace Roadmap.jsx**

```jsx
// src/components/Roadmap.jsx
import { useState } from 'react';
import { motion } from 'framer-motion';
import { mockTasks, mockProjects } from '../mockData';
import Card from './common/Card';
import StatusBadge from './common/StatusBadge';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.5 } },
};

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

  const getProjectColor = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.color : '#6b7280';
  };

  const getProjectName = (projectId) => {
    const project = mockProjects.find(p => p.id === projectId);
    return project ? project.name : 'Unknown';
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

  const tasksByDate = getTasksByDate();
  const sortedDates = Object.keys(tasksByDate).sort();

  const heroStyle = {
    marginBottom: 'var(--space-8)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: 0,
  };

  const selectStyle = {
    padding: 'var(--space-2) var(--space-4)',
    border: '1px solid var(--color-neutral-200)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--font-size-sm)',
    fontFamily: 'var(--font-serif)',
    backgroundColor: 'var(--color-white)',
    color: 'var(--color-neutral-900)',
  };

  const dateHeaderStyle = {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    marginBottom: 'var(--space-4)',
  };

  const taskCardStyle = {
    borderLeft: `4px solid var(--color-primary)`,
    padding: 'var(--space-4)',
    backgroundColor: 'var(--color-white)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-neutral-200)',
    marginBottom: 'var(--space-3)',
  };

  const taskTitleStyle = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: '0 0 var(--space-2)',
  };

  const taskMetaStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    fontSize: 'var(--font-size-xs)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-500)',
  };

  const projectBadgeStyle = (color) => ({
    display: 'inline-block',
    padding: 'var(--space-1) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    color: '#fff',
    backgroundColor: color,
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
  });

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div style={heroStyle} variants={itemVariants}>
        <h1 style={titleStyle}>Roadmap</h1>
        <select
          value={selectedProject || ''}
          onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
          style={selectStyle}
        >
          <option value="">All Projects</option>
          {mockProjects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </motion.div>

      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        {sortedDates.length > 0 ? (
          sortedDates.map((date, dateIdx) => (
            <motion.div key={date} variants={itemVariants}>
              <Card>
                <motion.h3
                  style={dateHeaderStyle}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 + dateIdx * 0.1 }}
                >
                  {new Date(date).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </motion.h3>

                <motion.div variants={containerVariants} initial="hidden" animate="visible">
                  {tasksByDate[date].map((task, taskIdx) => (
                    <motion.div
                      key={task.id}
                      style={{
                        ...taskCardStyle,
                        borderLeftColor: getProjectColor(task.projectId),
                      }}
                      variants={itemVariants}
                    >
                      <p style={taskTitleStyle}>{task.title}</p>
                      <div style={taskMetaStyle}>
                        <span style={projectBadgeStyle(getProjectColor(task.projectId))}>
                          {getProjectName(task.projectId)}
                        </span>
                        <StatusBadge status={task.status} />
                        <span>{task.assignee}</span>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              </Card>
            </motion.div>
          ))
        ) : (
          <motion.div variants={itemVariants}>
            <Card>
              <p style={{ textAlign: 'center', color: 'var(--color-neutral-500)', fontFamily: 'var(--font-serif)', margin: 0 }}>
                No tasks scheduled
              </p>
            </Card>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Roadmap.jsx
git commit -m "feat: redesign Roadmap with timeline view and animations"
```

---

### Task 12: Redesign Team Tab with Org Chart

**Files:**
- Modify: `src/components/Team.jsx`

- [ ] **Step 1: Replace Team.jsx**

```jsx
// src/components/Team.jsx
import { motion } from 'framer-motion';
import { mockProjects, mockTeamMembers } from '../mockData';
import Card from './common/Card';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5 } },
};

export default function Team() {
  const getProjectMembers = (projectName) => {
    return mockTeamMembers.filter(member =>
      member.projects.includes(projectName)
    );
  };

  const heroStyle = {
    marginBottom: 'var(--space-8)',
  };

  const titleStyle = {
    fontSize: 'var(--font-size-3xl)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
    color: 'var(--color-neutral-900)',
    margin: 0,
  };

  const subtitleStyle = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-neutral-500)',
    fontFamily: 'var(--font-serif)',
    margin: 'var(--space-2) 0 0',
  };

  const topBubbleContainerStyle = {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 'var(--space-12)',
  };

  const bubbleStyle = (isMain) => ({
    background: isMain ? 'linear-gradient(135deg, #1f2937 0%, #374151 100%)' : undefined,
    color: '#fff',
    borderRadius: '9999px',
    width: isMain ? '120px' : '100px',
    height: isMain ? '120px' : '100px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-lg)',
    transition: 'transform var(--transition-fast)',
    textAlign: 'center',
    padding: 'var(--space-4)',
  });

  const bubbleTextSmallStyle = {
    fontSize: 'var(--font-size-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-sans)',
  };

  const bubbleTextLargeStyle = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 'var(--font-weight-bold)',
    fontFamily: 'var(--font-sans)',
  };

  const projectsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 'var(--space-6)',
    marginBottom: 'var(--space-12)',
    justifyItems: 'center',
  };

  const projectBubbleContainerStyle = {
    textAlign: 'center',
    width: '100%',
  };

  const memberGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 'var(--space-4)',
    marginTop: 'var(--space-6)',
  };

  const memberCardStyle = {
    backgroundColor: '#fff',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    padding: 'var(--space-4)',
    transition: 'all var(--transition-fast)',
    borderLeft: '4px solid var(--color-primary)',
  };

  const memberAvatarStyle = {
    width: '48px',
    height: '48px',
    borderRadius: '9999px',
    backgroundColor: '#d1d5db',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 'var(--font-weight-bold)',
    margin: '0 auto var(--space-2)',
    fontSize: 'var(--font-size-base)',
  };

  const memberNameStyle = {
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-neutral-900)',
    textAlign: 'center',
    fontSize: 'var(--font-size-sm)',
    margin: '0 0 var(--space-1)',
    fontFamily: 'var(--font-sans)',
  };

  const memberRoleStyle = {
    color: 'var(--color-neutral-500)',
    fontSize: 'var(--font-size-xs)',
    textAlign: 'center',
    margin: '0 0 var(--space-3)',
    fontFamily: 'var(--font-serif)',
  };

  const summaryGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 'var(--space-6)',
  };

  const summaryStatStyle = {
    padding: 'var(--space-4)',
    backgroundColor: 'var(--color-neutral-100)',
    borderRadius: 'var(--radius-md)',
    borderLeft: '4px solid var(--color-primary)',
  };

  const summaryLabelStyle = {
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-neutral-900)',
    fontSize: 'var(--font-size-sm)',
    margin: '0 0 var(--space-1)',
    fontFamily: 'var(--font-sans)',
  };

  const summaryCountStyle = {
    fontSize: 'var(--font-size-lg)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-primary)',
    margin: 0,
    fontFamily: 'var(--font-sans)',
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div style={heroStyle} variants={itemVariants}>
        <h1 style={titleStyle}>Team</h1>
        <p style={subtitleStyle}>Organization structure and team members</p>
      </motion.div>

      {/* ATOM Top Bubble */}
      <motion.div style={topBubbleContainerStyle} variants={itemVariants}>
        <motion.div
          style={bubbleStyle(true)}
          whileHover={{ scale: 1.05 }}
        >
          <div>
            <p style={{ ...bubbleTextLargeStyle, margin: 0 }}>ATOM</p>
            <p style={{ ...bubbleTextSmallStyle, margin: 'var(--space-1) 0 0' }}>Investments</p>
          </div>
        </motion.div>
      </motion.div>

      {/* Project Bubbles */}
      <motion.div style={projectsGridStyle} variants={containerVariants} initial="hidden" animate="visible">
        {mockProjects.map(project => (
          <motion.div key={project.id} style={projectBubbleContainerStyle} variants={itemVariants}>
            <motion.div
              style={{
                ...bubbleStyle(false),
                backgroundColor: project.color,
              }}
              whileHover={{ scale: 1.05 }}
            >
              <p style={{ ...bubbleTextSmallStyle, margin: 0, maxWidth: '100%' }}>
                {project.name}
              </p>
            </motion.div>
          </motion.div>
        ))}
      </motion.div>

      {/* Team Members by Project */}
      <motion.div variants={containerVariants} initial="hidden" animate="visible">
        {mockProjects.map(project => {
          const members = getProjectMembers(project.name);
          return (
            <motion.div key={project.id} variants={itemVariants} style={{ marginBottom: 'var(--space-12)' }}>
              <Card>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', fontFamily: 'var(--font-sans)', color: project.color, textAlign: 'center', margin: '0 0 var(--space-6)' }}>
                  {project.name}
                </h3>

                {members.length > 0 ? (
                  <motion.div style={memberGridStyle} variants={containerVariants} initial="hidden" animate="visible">
                    {members.map(member => (
                      <motion.div
                        key={member.id}
                        style={{
                          ...memberCardStyle,
                          borderLeftColor: project.color,
                        }}
                        variants={itemVariants}
                        onMouseEnter={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-lg)'}
                        onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                      >
                        <div style={memberAvatarStyle}>
                          {member.name.charAt(0)}
                        </div>
                        <p style={memberNameStyle}>{member.name}</p>
                        <p style={memberRoleStyle}>{member.role}</p>
                        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-neutral-200)' }}>
                          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-neutral-500)', textAlign: 'center', margin: 0, fontFamily: 'var(--font-sans)' }}>
                            {member.projects.length} project{member.projects.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                ) : (
                  <p style={{ color: 'var(--color-neutral-500)', textAlign: 'center', fontSize: 'var(--font-size-sm)', fontFamily: 'var(--font-serif)' }}>
                    No members assigned
                  </p>
                )}
              </Card>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Summary Stats */}
      <motion.div variants={itemVariants}>
        <Card>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', fontFamily: 'var(--font-sans)', color: 'var(--color-neutral-900)', margin: '0 0 var(--space-6)' }}>Team Summary</h3>
          <motion.div style={summaryGridStyle} variants={containerVariants} initial="hidden" animate="visible">
            <motion.div style={summaryStatStyle} variants={itemVariants}>
              <p style={summaryLabelStyle}>Total Members</p>
              <p style={summaryCountStyle}>{mockTeamMembers.length}</p>
            </motion.div>
            <motion.div style={summaryStatStyle} variants={itemVariants}>
              <p style={summaryLabelStyle}>Total Projects</p>
              <p style={summaryCountStyle}>{mockProjects.length}</p>
            </motion.div>
          </motion.div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Team.jsx
git commit -m "feat: redesign Team with org chart bubbles and animations"
```

---

## Phase 4: Animations & Polish

### Task 13: Add Scroll Trigger Animations

**Files:**
- Create: `src/hooks/useScrollAnimation.js`
- Modify: `src/components/Overview.jsx`, `src/components/Projects.jsx`, etc. (apply hook)

- [ ] **Step 1: Create useScrollAnimation hook**

```jsx
// src/hooks/useScrollAnimation.js
import { useRef, useEffect } from 'react';
import { useAnimation, useInView } from 'framer-motion';

export function useScrollAnimation() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const controls = useAnimation();

  useEffect(() => {
    if (isInView) {
      controls.start('visible');
    }
  }, [isInView, controls]);

  return { ref, controls };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useScrollAnimation.js
git commit -m "feat: create useScrollAnimation hook for scroll-triggered reveals"
```

---

### Task 14: Add Page Transition Animations

**Files:**
- Modify: `src/pages/Dashboard.jsx`

- [ ] **Step 1: Update Dashboard.jsx with page transitions**

```jsx
// src/pages/Dashboard.jsx
import { motion } from 'framer-motion';
import Overview from '../components/Overview';
import Projects from '../components/Projects';
import Roadmap from '../components/Roadmap';
import Team from '../components/Team';

export default function Dashboard({ page }) {
  const pageVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.3 },
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.2 },
    },
  };

  const contentStyle = {
    maxWidth: '100%',
  };

  return (
    <motion.div
      style={contentStyle}
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      key={page}
    >
      {page === 'dashboard' && <Overview />}
      {page === 'projects' && <Projects />}
      {page === 'roadmap' && <Roadmap />}
      {page === 'team' && <Team />}
    </motion.div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Dashboard.jsx
git commit -m "feat: add page transition animations"
```

---

### Task 15: Test App & Fix Issues

**Files:**
- Test existing components

- [ ] **Step 1: Start dev server**

```bash
npm start
```

- [ ] **Step 2: Test login flow**

Expected: Login page with charcoal gradient, form with animations, mock login works (midom/adam/kabrina, password: demo)

- [ ] **Step 3: Test dashboard navigation**

Expected: TopNav tabs switch pages smoothly, RightSidebar toggles from hamburger menu, all 4 tabs load without errors

- [ ] **Step 4: Test animations**

Expected: Cards fade in, stat numbers count up on Overview, Project cards scale on hover, Team bubbles appear, Page transitions are smooth

- [ ] **Step 5: Commit (if no bugs found)**

```bash
git add .
git commit -m "feat: core dashboard complete with animations and shell"
```

---

## Phase 5: Responsive & Deploy

### Task 16: Add Mobile Responsive Breakpoints

**Files:**
- Modify: `src/App.js`, `src/components/layout/RightSidebar.jsx`, `src/components/layout/TopNav.jsx`

- [ ] **Step 1: Update App.js for responsive sidebar**

Add to App.js mainContentStyle:

```jsx
const mainContentStyle = {
  flex: 1,
  padding: 'var(--space-8) var(--space-6)',
  maxWidth: '1280px',
  margin: '0 auto',
  width: '100%',
};

// On tablet (768px - 1279px): Adjust padding
// On mobile (<768px): Full-width, sidebar becomes overlay
```

- [ ] **Step 2: Update RightSidebar for mobile overlay**

Already implemented in Task 7 (uses overlay + close button for mobile)

- [ ] **Step 3: Test responsive**

```bash
# Open browser DevTools
# Test at 1280px (desktop), 768px (tablet), 375px (mobile)
```

Expected: Desktop full sidebar visible, Tablet sidebar hides (hamburger only), Mobile sidebar drawer overlay

- [ ] **Step 4: Commit**

```bash
git add src/App.js src/components/layout/RightSidebar.jsx
git commit -m "feat: responsive design for tablet and mobile"
```

---

### Task 17: Lighthouse Audit & Performance

**Files:**
- Test and optimize

- [ ] **Step 1: Run Lighthouse audit**

```bash
npm run build
# Open build/index.html in Chrome DevTools > Lighthouse
```

- [ ] **Step 2: Check scores**

Expected targets:
- Performance: 90+
- Accessibility: 95+
- Best Practices: 90+
- SEO: 90+

If below target, optimize:
- Images: Lazy load, compress
- Fonts: Use system fonts, limit Google Fonts request
- Code: Minify, code-split
- Animations: Disable on prefers-reduced-motion

- [ ] **Step 3: Fix high-impact issues**

Example: If font load is slow, use system fonts as fallback

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "perf: optimize for Lighthouse 90+ scores"
```

---

### Task 18: Deploy to GitHub Pages

**Files:**
- GitHub Actions workflow (already exists)

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

- [ ] **Step 2: Monitor GitHub Actions**

Go to repo > Actions tab, watch deploy workflow run

- [ ] **Step 3: Visit deployed app**

```
https://atominvestments.github.io/apg-dashboard/
```

Expected: Live app with all features, animations smooth, no console errors

- [ ] **Step 4: Final commit (if needed)**

```bash
git add .
git commit -m "deploy: ATOM dashboard live on GitHub Pages"
```

---

## Checklist Summary

**Phase 1: Setup**
- [ ] Task 1: Design tokens
- [ ] Task 2: Design skill
- [ ] Task 3: Framer Motion install
- [ ] Task 4: Common components

**Phase 2: Auth & Shell**
- [ ] Task 5: LoginPage redesign
- [ ] Task 6: TopNav component
- [ ] Task 7: RightSidebar component
- [ ] Task 8: App.js integration

**Phase 3: Dashboard Sections**
- [ ] Task 9: Overview tab
- [ ] Task 10: Projects tab
- [ ] Task 11: Roadmap tab
- [ ] Task 12: Team tab

**Phase 4: Animations & Polish**
- [ ] Task 13: Scroll animations
- [ ] Task 14: Page transitions
- [ ] Task 15: Test & fix

**Phase 5: Responsive & Deploy**
- [ ] Task 16: Mobile responsive
- [ ] Task 17: Lighthouse audit
- [ ] Task 18: Deploy to GitHub Pages

---

## Success Criteria

✅ All 4 dashboard tabs load without errors  
✅ Animations run smoothly (60fps) on desktop & tablet  
✅ Responsive layout adapts to mobile  
✅ Deep charcoal + serif/sans typography throughout  
✅ All interactive elements have hover/focus states  
✅ Lighthouse score 90+ (Performance), 95+ (Accessibility)  
✅ Login/logout flow works with Supabase + mock fallback  
✅ Right sidebar toggles smoothly  
✅ GitHub Pages deployment succeeds  
✅ Live app at https://atominvestments.github.io/apg-dashboard/

---

## Notes

- **TDD approach:** Test each section in browser before moving to next
- **Frequent commits:** Small, focused commits per task
- **DRY:** Reuse Card, Button, StatusBadge components everywhere
- **No over-engineering:** Keep it simple, use design tokens consistently
- **Performance first:** Lazy load images, optimize fonts, test Lighthouse early
