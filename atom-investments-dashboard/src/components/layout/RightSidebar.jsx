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
