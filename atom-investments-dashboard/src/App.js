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
