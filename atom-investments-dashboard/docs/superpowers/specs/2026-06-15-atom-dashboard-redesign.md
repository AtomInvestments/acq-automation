# ATOM Investments Dashboard Redesign — Design Specification

**Date:** 2026-06-15  
**Project:** ATOM Investments Dashboard  
**Status:** Approved  
**Scope:** Complete visual redesign + animations using Framer Motion + 21st.dev components

---

## Overview

Rebuild the ATOM Investments dashboard to be **corporate refined, enterprise-grade, and visually premium**. The current React implementation works but lacks polish, animation, and consistent design language. This spec defines the design system, layout structure, component patterns, and animation strategy for a production-grade dashboard.

**Key Goals:**
- Professional, sophisticated aesthetic (corporate refined style)
- Smooth animations that enhance, not distract (Framer Motion)
- Consistent design tokens (color, typography, spacing)
- Responsive layout: desktop-first, collapse gracefully to tablet/mobile
- Access control: Only Mido, Adam, Kabrina can log in

---

## Design System

### Color Palette

| Role | Color | Hex | Usage |
|------|-------|-----|-------|
| ATOM Primary | Deep Charcoal | #1f2937 | Nav bar, primary buttons, text |
| Project: APG | Blue | #3b82f6 | APG project badges, accents |
| Project: KIN | Purple | #8b5cf6 | KIN project badges, accents |
| Project: ENDATCOURT | Pink | #ec4899 | ENDATCOURT badges, accents |
| Project: FLOAT THEORY | Amber | #f59e0b | FLOAT THEORY badges, accents |
| Project: MEET IN THE MIDDLE | Green | #10b981 | MEET IN THE MIDDLE badges, accents |
| Neutral: Background | Off-white | #f9fafb | Page background, light surfaces |
| Neutral: Card | White | #ffffff | Card backgrounds, elevated content |
| Neutral: Border | Light Gray | #e5e7eb | Card borders, dividers |
| Neutral: Secondary Text | Gray | #6b7280 | Helper text, secondary info |
| Neutral: Primary Text | Charcoal | #111111 | Headings, primary text |
| Status: Completed | Green | #dcfce7 (bg), #15803d (text) | Task completion badges |
| Status: In Progress | Blue | #dbeafe (bg), #0c4a6e (text) | Active task badges |
| Status: Pending | Amber | #fef3c7 (bg), #92400e (text) | Pending task badges |

### Typography

**Font Pairing:**
- **Headers & Navigation:** Geometric Sans-serif (Poppins, DM Sans, or Avenir Next)
  - Weight: 600–700 (bold)
  - Letter-spacing: -0.5px (tight, modern)
  - Use for: Nav items, page headers, card titles, CTA buttons
  
- **Body & Descriptions:** Elegant Serif (Merriweather, Lora, or Crimson Text)
  - Weight: 400–500 (regular to medium)
  - Line-height: 1.6 (generous, readable)
  - Use for: Description text, table content, sidebar info

**Type Scale:**
- **Tiny (12px):** Status labels, small badges, helper text
- **Small (14px):** Button text, form labels, secondary headings
- **Body (16px):** Table rows, card descriptions, main content
- **Section Header (24px):** Tab section titles ("Overview", "Projects", etc.)
- **Page Header (32px):** Welcome messages, major headings
- **Logo (28px):** ATOM wordmark in nav

### Spacing System

Base unit: **8px**

- **Compact:** 4px (internal button padding)
- **Small:** 8px (input padding, tight spacing)
- **Medium:** 16px (card padding, section gaps)
- **Large:** 24px (major section spacing)
- **XL:** 32px (page-level margins)
- **XXL:** 48px (top-level section separation)

All padding, margins, and gaps should be multiples of 8px.

---

## Layout Structure

### Top Navigation Bar

**Visual:**
- Background: Deep charcoal (#1f2937)
- Height: 64px
- Shadow: `0 1px 3px rgba(0,0,0,0.15)` (subtle depth)
- Sticky: Remains at top during scroll

**Content Grid:**
- **Left (33%):** ATOM logo/wordmark (white text, 28px, sans-serif bold)
- **Center (33%):** Horizontal tab navigation
  - Tabs: Overview | Projects | Roadmap | Team
  - Inactive: Gray text (#6b7280), no background
  - Active: Charcoal text (#111), underline in accent color (project color or #3b82f6 for Overview)
  - Spacing: 24px between tabs
  - Hover: Text color lightens 5%
- **Right (33%):** Flex row with gap 16px
  - Date/Time (small text, gray)
  - User avatar (32px circle, charcoal background, white initials)
  - Hamburger menu icon (dark gray, hover to light gray)

### Right Sidebar (Toggleable)

**Visual:**
- Width: 280px
- Background: Light gray (#f3f4f6)
- Position: Fixed, right edge
- Shadow: `-2px 0 8px rgba(0,0,0,0.1)` (inset shadow to left)
- Transition: Slide in/out 0.4s ease-out (Framer Motion)
- Mobile: Overlay mode (covers content on small screens)

**Content (Top to Bottom):**
1. **Close button** (X icon, top-right, 16px padding)
2. **User Profile Card** (16px padding)
   - Avatar: 48px circle
   - Name: "Mido Yasser" (sans-serif bold, 16px)
   - Role: "CEO" (serif, 14px, gray)
   - Divider line (1px, light gray) below
3. **Quick Stats** (16px padding)
   - "3 Active Projects" (bold header)
   - "8 Tasks Due This Week" (bold header)
   - Stats displayed as small gray labels with bold counts
4. **Logout Button** (16px padding, bottom)
   - Text: "Sign Out"
   - Style: Charcoal text, transparent background, hover to light red (#dc2626)

### Main Content Area

**Visual:**
- Responsive grid layout
- Padding: 32px top/bottom, 24px left/right
- Background: Off-white (#f9fafb)
- Max-width: 1280px (centered on desktop)
- Adjusts width when sidebar opens/closes

**Sections Inside:**
- Each tab (Overview, Projects, Roadmap, Team) fills this area
- Responsiveness: Grid columns adjust 3 → 2 → 1 as viewport shrinks

---

## Component Patterns

### Cards

**Base Style:**
- Background: White (#ffffff)
- Border: 1px solid #e5e7eb
- Border-radius: 8px
- Padding: 24px
- Shadow (rest): `0 1px 3px rgba(0,0,0,0.1)`
- Shadow (hover): `0 10px 15px rgba(0,0,0,0.1)`
- Transition: All 0.2s ease-out

**States:**
- **Hover:** Shadow elevation increases, background very slight white-to-off-white shift
- **Active:** Border color changes to accent (project color)
- **Loading:** Shimmer skeleton effect

### Buttons

**Primary (CTA):**
- Background: Deep charcoal (#1f2937)
- Text: White, sans-serif bold, 14px
- Padding: 12px 24px
- Border-radius: 6px
- Hover: Background lightens 10%, shadow increases
- Click feedback: Scale 0.95 → 1.0 (50ms, Framer Motion)

**Secondary:**
- Background: Transparent
- Text: Charcoal (#111), sans-serif bold, 14px
- Border: 1px solid #111
- Padding: 12px 24px
- Border-radius: 6px
- Hover: Background becomes #f9fafb, text lightens

**Disabled:**
- Opacity: 0.5
- Cursor: not-allowed

### Status Badges

**Completed:**
- Background: #dcfce7
- Text: #15803d, sans-serif medium, 12px
- Padding: 6px 12px
- Border-radius: 9999px (pill shape)

**In Progress:**
- Background: #dbeafe
- Text: #0c4a6e, sans-serif medium, 12px
- Padding: 6px 12px
- Border-radius: 9999px

**Pending:**
- Background: #fef3c7
- Text: #92400e, sans-serif medium, 12px
- Padding: 6px 12px
- Border-radius: 9999px

### Input Fields

**Style:**
- Background: White (#ffffff)
- Border: 1px solid #d1d5db
- Border-radius: 6px
- Padding: 10px 14px
- Font: Serif, 14px
- Focus: Border color → charcoal (#1f2937), shadow `0 0 0 3px rgba(31,41,55,0.1)`

**Placeholder:**
- Color: #9ca3af (light gray)
- Font-style: Normal (no italics)

---

## Dashboard Sections

### Overview Tab

**Hero Section:**
- Large greeting: "Welcome, [User Name]" (sans-serif, 32px bold)
- Subtext: Current date/time (serif, 14px, gray)
- Divider line below

**Stat Cards (Grid):**
- 3-column grid (responsive to 2, then 1)
- Each card shows:
  - Label (small, gray): "Total Tasks", "In Progress", "Completed"
  - Count (bold, 32px): 8, 3, 0
  - Framer Motion: Numbers count up from 0 to final on load (1s duration)

**Main Task Table:**
- Columns: Task | Project | Status | Due Date | Assignee
- Rows: All tasks across projects
- Each project name is a colored badge (project color background, white text)
- Status column shows status badges (completed/in-progress/pending)
- Hover row: Background shifts to #f9fafb
- Framer Motion: Table rows stagger fade-in 0.15s apart

### Projects Tab

**Hero Section:**
- Title: "Projects" (sans-serif, 32px bold)
- Subtitle: "[X] Active" (serif, gray)

**Project Grid:**
- 3-column layout (responsive to 2, then 1 on mobile)
- Card per project with:
  - **Top bar:** Project color accent (8px bar with project color)
  - **Name:** Bold sans-serif, 20px
  - **Description:** Serif, 14px, gray
  - **Team members:** Avatar initials (small circles), show 3, "+X more" if > 3
  - **Progress bar:** Full-width gray bar (#e5e7eb), filled portion in project color
  - **Progress text:** "X/X complete" (small, right-aligned)
- Clickable: Navigate to project detail view
- Framer Motion: Card scales up 1.02 on hover, progress bar animates from 0 to final width on load

### Roadmap Tab

**Hero Section:**
- Title: "Roadmap" (sans-serif, 32px bold)
- Subtitle: "Pick a project to drill down"

**Project Filter:**
- Dropdown: "All Projects" (default) or specific project
- Positioned top-right of content

**Timeline View:**
- Grouped by due date: Month → Week → Day
- Each date group shows as a collapsible section header (sans-serif bold, charcoal)
- Under each date: Task cards
  - Task title (serif, 14px)
  - Project badge (project color, white text)
  - Status badge (completed/in-progress/pending)
  - Assignee name (gray, 12px)
- Framer Motion: Date headers fade in as you scroll, task cards slide in from left per date (staggered 0.1s)

### Team Tab

**Hero Section:**
- Title: "Team" (sans-serif, 32px bold)
- Subtitle: "Organization Structure"

**Org Chart Bubbles:**
- **Level 1:** ATOM Investments (large 120px circle, charcoal gradient, white text, centered)
- **Level 2:** 5 project bubbles (100px circles, each project color, white text, arranged in row)
  - APG (blue), KIN (purple), ENDATCOURT (pink), FLOAT THEORY (amber), MEET IN THE MIDDLE (green)
- **Level 3:** Team member cards under each project
  - Card per member: avatar, name, role, project count
  - Expandable on click (Framer Motion: flip open animation)

**Summary Stats (Bottom):**
- Grid: Total Members | Total Projects | Members per Project
- Each stat in small card format
- Framer Motion: Cards fade in after bubbles settle

---

## Animation Strategy (Framer Motion)

### Page Load Entrance
- Page fades in: opacity 0 → 1 (0.4s ease-out)
- Stat cards stagger fade-in: 0.1s between each
- Table rows fade-in: 0.15s stagger
- Number counts: Animate from 0 to final (1s duration, easing function)

### Scroll Triggers
- Cards fade in when scrolled into view (Intersection Observer + Framer Motion)
- Subtle scale: 0.98 → 1.0 as they enter view

### Interactive Hover States
- Card hover: Shadow elevation (0.2s), slight scale 1.0 → 1.02
- Button hover: Background shift, text color change (0.2s)
- Tab hover: Underline color shift (0.2s)

### Click Feedback
- Button click: Scale 1.0 → 0.95 → 1.0 (50ms total)
- Card click (on Projects): Scale slight expansion
- Sidebar toggle: Slide in/out smooth (0.4s ease-out)

### State Transitions
- Page transitions (tab switches): Fade out current → Fade in new (0.3s)
- Sidebar toggle: Slide in from right 280px (0.4s ease-out), overlay dims (opacity shift)
- Status badge change: Fade to new color (0.2s)

### Loading States
- Skeleton shimmer: Gradient shimmer effect while data loads (repeating animation)
- Loader: Subtle spinning icon or progress bar

---

## Responsive Breakpoints

| Breakpoint | Width | Layout Changes |
|-----------|-------|-----------------|
| Desktop | 1280px+ | Full layout: top nav + right sidebar + main content |
| Tablet | 768px–1279px | Sidebar collapses to icon-only (right edge), main content expands |
| Mobile | <768px | Sidebar becomes overlay/drawer (slides in from right), full-width content |

**Mobile-Specific:**
- Nav height: 56px (smaller)
- Padding: 16px (reduced from 24px)
- Tab text: Hide label, show icons only
- Cards: Full-width, single column
- Sidebar: Drawer overlay mode, close button visible

---

## Login Page

**Layout:**
- Full-screen gradient background: Charcoal to slightly lighter charcoal, subtle diagonal angle
- Centered white card (max-width 420px)

**Card Contents:**
- **Logo:** "ATOM Investments" (sans-serif bold, 28px, centered, charcoal)
- **Subtitle:** "Operations Dashboard" (serif, 16px, gray, centered)
- **Divider:** 1px line below logo
- **Form:**
  - Email input: placeholder "you@example.com"
  - Password input: placeholder "••••••••"
  - Submit button: "Sign In" (Primary style)
  - OR divider
  - GitHub OAuth button: Dark gray, "Sign in with GitHub"
- **Error message:** Red badge at bottom if login fails
- **Footer:** Small text "Authorized personnel only"

**Framer Motion:**
- Card fades in on load (0.4s)
- Form inputs stagger fade-in (0.1s between each)
- Button has subtle pulse on hover (scale 1.0 ↔ 1.05, repeating)

---

## Accessibility & Performance

### Accessibility
- All interactive elements keyboard-navigable (tab order)
- Color contrast: WCAG AA compliance (4.5:1 text, 3:1 graphics)
- Focus states: Clear outline or background shift on focus
- Alt text: All icons have aria-labels
- Semantic HTML: Use proper heading hierarchy, button elements for actions

### Performance
- Lazy load images and off-screen content
- Optimize fonts: Use system fonts as fallback, load serif/sans-serif from Google Fonts or Bunny
- Code splitting: Load 21st.dev components on-demand per page
- Framer Motion: Use `will-change` sparingly, disable animations on `prefers-reduced-motion`
- Lighthouse target: 90+ Performance, 95+ Accessibility

---

## Tech Stack (4-Step Approach)

1. **Claude Code CLI:** Local development, full project editing
2. **Framer Motion:** All animations, scroll triggers, exit/entry effects
3. **Design Skill:** Custom .claude/skills/frontend-design.md with tokens, patterns, taste rules
4. **21st.dev Components:** Production UI blocks (hero, cards, nav, tables) adapted to ATOM brand

**Additional:**
- React 19 (existing)
- Tailwind CSS 4.0 (or inline styles with design tokens)
- Supabase for authentication (existing)
- GitHub Pages deployment (existing)

---

## Success Criteria

- ✅ All 4 dashboard tabs load without errors
- ✅ Animations run smoothly (60fps) on desktop & tablet
- ✅ Responsive layout adapts correctly to mobile
- ✅ Deep charcoal + serif/sans typography throughout
- ✅ All interactive elements have hover/focus states
- ✅ Lighthouse score 90+ (Performance), 95+ (Accessibility)
- ✅ Login/logout flow works with Supabase
- ✅ Right sidebar toggles smoothly without layout shift

---

## Next Steps

1. Write implementation plan using writing-plans skill
2. Set up design tokens file (.claude/skills/frontend-design.md)
3. Install Framer Motion dependency
4. Build login page (hero, form inputs, OAuth button)
5. Build top nav + right sidebar frame
6. Build Overview, Projects, Roadmap, Team tabs with 21st.dev components
7. Wire animations per section
8. Test responsiveness across breakpoints
9. Audit accessibility & performance
10. Deploy to GitHub Pages
