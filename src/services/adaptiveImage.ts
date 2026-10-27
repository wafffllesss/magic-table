import { onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import { imagePixelWidth } from './imagePolicy';
import { observeImage } from './imageVisibility';
import type { ImageOptions } from './imageQueue';

export type ImageLevel = { width: number; load: (options: ImageOptions) => Promise<string | undefined> };
type ImageSource = { key: string; levels: ImageLevel[]; aspect: number; inspection?: boolean };

/** Keep the decoded image visible until a better one is ready. */
export function useAdaptiveImage(element: Ref<HTMLElement | undefined>, source: ComputedRef<ImageSource>) {
  const imageUrl = ref('');
  const resolution = ref(0);
  let visible = false; let pixelWidth = 0; let loaded = -1; let version = 0; let loading = false;
  let controller: AbortController | undefined;
  let unobserve: (() => void) | undefined;
  const attempted = new Set<number>();

  function clear(): void {
    version++; controller?.abort(); loading = false; loaded = -1; attempted.clear();
    revoke(imageUrl.value); imageUrl.value = ''; resolution.value = 0;
  }

  async function advance(): Promise<void> {
    if (!visible || loading || !source.value.levels.length) return;
    const current = source.value;
    const width = Math.max(pixelWidth, current.inspection ? 147 : 0);
    let target = current.levels.findIndex(level => level.width >= width);
    if (target < 0) target = current.levels.length - 1;
    // The first image is always the smallest available version.
    const next = loaded < 0 ? current.levels.findIndex((_, index) => !attempted.has(index)) : target;
    if (next < 0 || next <= loaded || attempted.has(next)) return;
    attempted.add(next); loading = true;
    const requestVersion = version;
    const requestController = new AbortController(); controller = requestController;
    let url: string | undefined;
    try {
      url = await current.levels[next].load({ signal: requestController.signal, priority: current.inspection ? 'inspection' : loaded < 0 ? 'visible' : 'upgrade' });
      if (!url) return;
      if (requestVersion !== version || requestController.signal.aborted) return;
      const decoded = new Image(); decoded.src = url;
      await decoded.decode();
      if (requestVersion !== version || requestController.signal.aborted) return;
      const previous = imageUrl.value;
      imageUrl.value = url; resolution.value = current.levels[next].width;
      url = undefined; loaded = next; revoke(previous);
    } catch { /* Preserve the previous resolution on fetch or decode failure. */ }
    finally {
      revoke(url);
      if (requestVersion === version) {
        loading = false;
        if (requestController.signal.aborted) attempted.delete(next);
        void advance();
      }
    }
  }

  watch(() => source.value.key, () => { clear(); void advance(); });
  watch(() => source.value.inspection, () => { void advance(); });
  onMounted(() => {
    if (!element.value) return;
    unobserve = observeImage(element.value, measurement => {
      visible = measurement.visible;
      pixelWidth = imagePixelWidth(measurement.width, measurement.height, source.value.aspect, window.devicePixelRatio);
      if (!visible) controller?.abort(); else void advance();
    });
  });
  onBeforeUnmount(() => { unobserve?.(); visible = false; clear(); });
  return { imageUrl, resolution };
}

function revoke(url?: string): void { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); }
