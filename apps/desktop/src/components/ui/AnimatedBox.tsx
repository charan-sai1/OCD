import { lazy, Suspense, memo } from 'react';

const MotionBox = lazy(async () => {
  const { motion } = await import('framer-motion');
  return { default: motion.div };
});

const LoadingFallback = () => null;

interface AnimatedBoxProps {
  children: React.ReactNode;
  animation?: 'fade' | 'slide' | 'scale' | 'stagger';
  delay?: number;
  className?: string;
}

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 1.05 },
};

const animations = {
  fade: fadeIn,
  slide: slideUp,
  scale: scaleIn,
  stagger: fadeIn,
};

const AnimatedBox = memo(({ children, animation = 'fade', delay = 0, className }: AnimatedBoxProps) => {
  const selectedAnimation = animations[animation];

  return (
    <Suspense fallback={<LoadingFallback />}>
      <MotionBox
        className={className}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={selectedAnimation}
        transition={{ duration: 0.3, delay }}
      >
        {children}
      </MotionBox>
    </Suspense>
  );
});

AnimatedBox.displayName = 'AnimatedBox';

export { AnimatedBox };
export default AnimatedBox;
