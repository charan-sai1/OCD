(function() {
  if (typeof window === 'undefined') return;
  
  if ('requestIdleCallback' in window) return;
  
  const requestIdleCallback = (window as any).requestIdleCallback = (cb: Function) => {
    const start = Date.now();
    return setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining: () => {
          return Math.max(0, 50 - (Date.now() - start));
        }
      });
    }, 1) as any as number;
  };
  
  (window as any).cancelIdleCallback = (id: number) => {
    clearTimeout(id as number);
  };
})();

