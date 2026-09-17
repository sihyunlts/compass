export const SPRING_PRECISION = 0.001;

export const shouldReduceMotion = (): boolean =>
  document.documentElement.classList.contains('reduce-animation')
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const shouldReduceBlur = (): boolean =>
  document.documentElement.classList.contains('reduce-blur');

export type SpringMotionOptions = {
  stiffness: number;
  damping: number;
  precision: number;
};

export type SpringTransition = {
  durationMs: number;
  easing: (progress: number) => number;
};

const sampleCubicBezierCoordinate = (
  parameter: number,
  firstControlPoint: number,
  secondControlPoint: number,
): number => {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * firstControlPoint
    + 3 * inverse * parameter * parameter * secondControlPoint
    + parameter * parameter * parameter;
};

export const createCubicBezierEasing = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): ((progress: number) => number) => (progress) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  let lowerParameter = 0;
  let upperParameter = 1;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const parameter = (lowerParameter + upperParameter) / 2;
    const sampledProgress = sampleCubicBezierCoordinate(parameter, x1, x2);
    if (sampledProgress < progress) {
      lowerParameter = parameter;
    } else {
      upperParameter = parameter;
    }
  }

  return sampleCubicBezierCoordinate(
    (lowerParameter + upperParameter) / 2,
    y1,
    y2,
  );
};

export const createSpringTransition = (
  options: SpringMotionOptions,
): SpringTransition => {
  const frameDurationMs = 1000 / 60;
  const progressSamples = [0];
  let previousProgress = 0;
  let currentProgress = 0;

  for (let frame = 0; frame < 600; frame += 1) {
    const distance = 1 - currentProgress;
    const velocity = currentProgress - previousProgress;
    const acceleration = options.stiffness * distance
      - options.damping * velocity;
    const displacement = velocity + acceleration;

    if (
      Math.abs(displacement) < options.precision
      && Math.abs(distance) < options.precision
    ) {
      progressSamples.push(1);
      break;
    }

    previousProgress = currentProgress;
    currentProgress += displacement;
    progressSamples.push(currentProgress);
  }

  return {
    durationMs: (progressSamples.length - 1) * frameDurationMs,
    easing: (progress: number): number => {
      const samplePosition = progress * (progressSamples.length - 1);
      const lowerSampleIndex = Math.floor(samplePosition);
      const upperSampleIndex = Math.min(
        progressSamples.length - 1,
        lowerSampleIndex + 1,
      );
      const interpolation = samplePosition - lowerSampleIndex;
      const lowerSample = progressSamples[lowerSampleIndex];
      const upperSample = progressSamples[upperSampleIndex];
      return lowerSample + (upperSample - lowerSample) * interpolation;
    },
  };
};
