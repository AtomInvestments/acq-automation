import { useState } from 'react';
import './App.css';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import ProfilePage from './pages/ProfilePage';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState('dashboard');

  const handleLogin = (user) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentPage('dashboard');
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const navStyle = {
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    padding: '0.75rem 1rem',
  };

  const navContainerStyle = {
    maxWidth: '80rem',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const navItemsStyle = {
    display: 'flex',
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
  });

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
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f3f4f6' }}>
      <nav style={navStyle}>
        <div style={navContainerStyle}>
          <div style={navItemsStyle}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#111' }}>ATOM Investments</h1>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={() => setCurrentPage('profile')}
              style={userButtonStyle}
            >
              <div style={avatarStyle}>
                {currentUser.name.charAt(0)}
              </div>
              <span style={{ fontSize: '0.875rem', color: '#374151' }}>{currentUser.name}</span>
            </button>
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
          </div>
        </div>
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
