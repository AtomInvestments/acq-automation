import { motion, AnimatePresence } from 'framer-motion';
import Overview from '../components/Overview';
import Projects from '../components/Projects';
import Roadmap from '../components/Roadmap';
import Team from '../components/Team';

// Page transition variants for smooth fade in/out between tabs
const pageVariants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: 'easeOut',
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.2,
      ease: 'easeIn',
    },
  },
};

export default function Dashboard({ page }) {
  return (
    <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1rem' }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          variants={pageVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {page === 'dashboard' && <Overview />}
          {page === 'projects' && <Projects />}
          {page === 'roadmap' && <Roadmap />}
          {page === 'team' && <Team />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
