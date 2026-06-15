import { useState, useEffect } from 'react';
import './App.css';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import ProfilePage from './pages/ProfilePage';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);

  const handleLogin = (user) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentPage('dashboard');
    setMobileMenuOpen(false);
  };

  // Track window resize for responsive design
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 768;

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const navStyle = {
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: '0.75rem 1rem',
    position: 'sticky',
    top: 0,
    zIndex: 50,
  };

  const navContainerStyle = {
    maxWidth: '80rem',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const navItemsStyle = {
    display: isMobile ? 'none' : 'flex',
    alignItems: 'center',
    gap: '2rem',
  };

  const navLinkStyle = (isActive) => ({
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: isActive ? '#2563eb' : '#4b5563',
    borderBottom: isActive ? '2px solid #2563eb' : 'none',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    transition: 'color 0.2s',
    whiteSpace: 'nowrap',
  });

  const mobileMenuStyle = {
    display: !isMobile ? 'none' : 'block',
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    padding: '1rem',
    zIndex: 40,
  };

  const mobileMenuItemStyle = (isActive) => ({
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: isActive ? '#2563eb' : '#4b5563',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    transition: 'color 0.2s',
    display: 'block',
    width: '100%',
    textAlign: 'left',
  });

  const hamburgerStyle = {
    display: isMobile ? 'block' : 'none',
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#4b5563',
    padding: '0.5rem',
  };

  const userButtonStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    borderRadius: '0.375rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  };

  const avatarStyle = {
    width: '2rem',
    height: '2rem',
    backgroundColor: '#3b82f6',
    borderRadius: '9999px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 'bold',
    flexShrink: 0,
  };

  const userNameStyle = {
    fontSize: '0.875rem',
    color: '#374151',
    display: isMobile ? 'none' : 'inline',
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f3f4f6' }}>
      <nav style={navStyle}>
        <div style={navContainerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '1rem' : '2rem' }}>
            <h1 style={{ fontSize: isMobile ? '1.25rem' : '1.5rem', fontWeight: 'bold', color: '#111', whiteSpace: 'nowrap' }}>ATOM</h1>
            <div style={navItemsStyle}>
              <div style={{ display: 'flex', gap: '1.5rem' }}>
                <button
                  onClick={() => setCurrentPage('dashboard')}
                  style={navLinkStyle(currentPage === 'dashboard')}
                >
                  Overview
                </button>
                <button
                  onClick={() => setCurrentPage('projects')}
                  style={navLinkStyle(currentPage === 'projects')}
                >
                  Projects
                </button>
                <button
                  onClick={() => setCurrentPage('roadmap')}
                  style={navLinkStyle(currentPage === 'roadmap')}
                >
                  Roadmap
                </button>
                <button
                  onClick={() => setCurrentPage('team')}
                  style={navLinkStyle(currentPage === 'team')}
                >
                  Team
                </button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setCurrentPage('profile')}
              style={userButtonStyle}
            >
              <div style={avatarStyle}>
                {currentUser.name.charAt(0)}
              </div>
              <span style={userNameStyle}>{currentUser.name}</span>
            </button>
            {!isMobile && (
              <button
                onClick={handleLogout}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: '#dc2626',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                Logout
              </button>
            )}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={hamburgerStyle}
              aria-label="Toggle menu"
              title="Toggle menu"
            >
              ☰
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div style={mobileMenuStyle}>
            <button
              onClick={() => {
                setCurrentPage('dashboard');
                setMobileMenuOpen(false);
              }}
              style={mobileMenuItemStyle(currentPage === 'dashboard')}
            >
              Overview
            </button>
            <button
              onClick={() => {
                setCurrentPage('projects');
                setMobileMenuOpen(false);
              }}
              style={mobileMenuItemStyle(currentPage === 'projects')}
            >
              Projects
            </button>
            <button
              onClick={() => {
                setCurrentPage('roadmap');
                setMobileMenuOpen(false);
              }}
              style={mobileMenuItemStyle(currentPage === 'roadmap')}
            >
              Roadmap
            </button>
            <button
              onClick={() => {
                setCurrentPage('team');
                setMobileMenuOpen(false);
              }}
              style={mobileMenuItemStyle(currentPage === 'team')}
            >
              Team
            </button>
            <button
              onClick={handleLogout}
              style={{
                ...mobileMenuItemStyle(false),
                color: '#dc2626',
                borderTop: '1px solid #e5e7eb',
                marginTop: '0.5rem',
                paddingTop: '1rem',
              }}
            >
              Logout
            </button>
          </div>
        )}
      </nav>

      {currentPage === 'profile' ? (
        <ProfilePage user={currentUser} />
      ) : (
        <Dashboard page={currentPage} />
      )}
    </div>
  );
}

export default App;
