'use client';

import { useState, useEffect } from 'react';

// True below the 768px breakpoint. SSR/first paint returns false (desktop
// markup), then corrects after mount — pages use this to swap heavy tables
// for view-only card lists on phones without touching the desktop tree.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}
