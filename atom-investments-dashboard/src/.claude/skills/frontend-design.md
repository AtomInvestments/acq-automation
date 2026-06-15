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
