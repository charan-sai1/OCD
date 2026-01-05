import React, { memo } from 'react';

interface TransitionProps {
  children: React.ReactNode;
  in?: boolean;
  timeout?: number;
  className?: string;
  onExited?: () => void;
}

const Transition = memo(({ children, in: inProp = true, timeout = 300, className }: TransitionProps) => {
  if (!inProp) {
    return null;
  }

  return (
    <div className={`anim-fade-in ${className || ''}`} style={{ animationDuration: `${timeout}ms` }}>
      {children}
    </div>
  );
});

Transition.displayName = 'Transition';

export { Transition };
export default Transition;
