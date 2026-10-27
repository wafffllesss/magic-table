type Measurement = { visible: boolean; width: number; height: number };
type Entry = { intersecting: boolean; callback: (measurement: Measurement) => void };
const entries = new Map<Element, Entry>();
let intersection: IntersectionObserver | undefined;
let resize: ResizeObserver | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;

function measure(element: Element, entry: Entry): void {
  const rect = element.getBoundingClientRect();
  entry.callback({ visible: entry.intersecting && rect.width > 0 && rect.height > 0, width: rect.width, height: rect.height });
}

/** Camera transforms do not trigger ResizeObserver. Coalesce their final projection. */
export function scheduleImageMeasurements(): void {
  if (!entries.size) return;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    frame = requestAnimationFrame(() => { frame = 0; entries.forEach((entry, element) => measure(element, entry)); });
  }, 200);
}

export function observeImage(element: Element, callback: Entry['callback']): () => void {
  if (!entries.size) {
    intersection = new IntersectionObserver(changes => {
      for (const change of changes) {
        const entry = entries.get(change.target);
        if (entry) { entry.intersecting = change.isIntersecting; measure(change.target, entry); }
      }
    });
    resize = new ResizeObserver(scheduleImageMeasurements);
    window.addEventListener('resize', scheduleImageMeasurements);
    window.addEventListener('scroll', scheduleImageMeasurements, true);
    document.addEventListener('pointerover', scheduleImageMeasurements, true);
    document.addEventListener('focusin', scheduleImageMeasurements, true);
    document.addEventListener('transitionend', scheduleImageMeasurements, true);
  }
  entries.set(element, { callback, intersecting: false });
  intersection!.observe(element); resize!.observe(element);
  return () => {
    entries.delete(element); intersection?.unobserve(element); resize?.unobserve(element);
    if (!entries.size) {
      intersection?.disconnect(); resize?.disconnect(); intersection = undefined; resize = undefined;
      clearTimeout(settleTimer); if (frame) cancelAnimationFrame(frame); frame = 0;
      window.removeEventListener('resize', scheduleImageMeasurements);
      window.removeEventListener('scroll', scheduleImageMeasurements, true);
      document.removeEventListener('pointerover', scheduleImageMeasurements, true);
      document.removeEventListener('focusin', scheduleImageMeasurements, true);
      document.removeEventListener('transitionend', scheduleImageMeasurements, true);
    }
  };
}
