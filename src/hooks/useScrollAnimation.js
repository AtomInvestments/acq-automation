import { useEffect, useRef, useState } from 'react';

/**
 * Hook that triggers animations when elements scroll into view
 * Uses Intersection Observer API for optimal performance
 * @param {object} options - Configuration options
 * @param {number} options.threshold - Intersection threshold (0-1), default 0.1
 * @param {string} options.rootMargin - Margin around root, default '0px'
 * @returns {object} - { ref, isVisible, animate }
 */
export function useScrollAnimation(options = {}) {
  const {
    threshold = 0.1,
    rootMargin = '0px',
  } = options;

  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [animate, setAnimate] = useState('hidden');

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          setAnimate('visible');
          // Optionally stop observing after the element is visible
          // observer.unobserve(entry.target);
        } else {
          setIsVisible(false);
          setAnimate('hidden');
        }
      },
      {
        threshold,
        rootMargin,
      }
    );

    const currentElement = ref.current;

    if (currentElement) {
      observer.observe(currentElement);
    }

    return () => {
      if (currentElement) {
        observer.unobserve(currentElement);
      }
    };
  }, [threshold, rootMargin]);

  return {
    ref,
    isVisible,
    animate,
  };
}

export default useScrollAnimation;
