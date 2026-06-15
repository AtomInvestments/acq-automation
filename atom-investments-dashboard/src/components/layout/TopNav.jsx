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
