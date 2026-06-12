import Overview from '../components/Overview';
import Projects from '../components/Projects';
import Roadmap from '../components/Roadmap';
import Team from '../components/Team';

export default function Dashboard({ page }) {
  return (
    <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1rem' }}>
      {page === 'dashboard' && <Overview />}
      {page === 'projects' && <Projects />}
      {page === 'roadmap' && <Roadmap />}
      {page === 'team' && <Team />}
    </div>
  );
}
