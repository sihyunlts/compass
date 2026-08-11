export const SPRING_PRECISION = 0.001;

export const shouldReduceMotion = (): boolean =>
  document.documentElement.classList.contains('reduce-animation')
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
