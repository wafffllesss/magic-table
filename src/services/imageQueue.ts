export type ImagePriority = 'inspection' | 'visible' | 'upgrade';
export type ImageOptions = { signal?: AbortSignal; priority?: ImagePriority };
const priorities: Record<ImagePriority, number> = { inspection: 0, visible: 1, upgrade: 2 };
type Job = {
  key: string; priority: number; consumers: number; started: boolean; settled: boolean;
  controller: AbortController; run: (signal: AbortSignal) => Promise<Blob | undefined>;
  promise: Promise<Blob | undefined>; resolve: (blob: Blob | undefined) => void; reject: (error: unknown) => void;
};

/** A cancelled subscriber never interrupts another view of the same image. */
export class ImageQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly waiting: Job[] = [];
  private active = 0;

  constructor(private readonly concurrency = 4) {}

  request(key: string, run: Job['run'], options: ImageOptions = {}): Promise<Blob | undefined> {
    if (options.signal?.aborted) return Promise.reject(aborted());
    const priority = priorities[options.priority ?? 'visible'];
    let job = this.jobs.get(key);
    if (!job) {
      let resolve!: Job['resolve']; let reject!: Job['reject'];
      const promise = new Promise<Blob | undefined>((yes, no) => { resolve = yes; reject = no; });
      job = { key, priority, run, promise, resolve, reject, consumers: 0, started: false, settled: false, controller: new AbortController() };
      this.jobs.set(key, job); this.waiting.push(job);
    }
    job.priority = Math.min(job.priority, priority);
    job.consumers++;
    const shared = job;
    const result = new Promise<Blob | undefined>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        options.signal?.removeEventListener('abort', cancel);
        shared.consumers--;
        if (!shared.consumers && !shared.settled) {
          shared.controller.abort();
          if (this.jobs.get(key) === shared) this.jobs.delete(key);
          if (!shared.started) {
            this.waiting.splice(this.waiting.indexOf(shared), 1);
            shared.settled = true; shared.reject(aborted());
          }
        }
      };
      const cancel = () => { release(); reject(aborted()); };
      options.signal?.addEventListener('abort', cancel, { once: true });
      shared.promise.then(blob => { release(); resolve(blob); }, error => { release(); reject(error); });
    });
    queueMicrotask(() => this.pump());
    return result;
  }

  private pump(): void {
    this.waiting.sort((a, b) => a.priority - b.priority);
    while (this.active < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      job.started = true; this.active++;
      void Promise.resolve().then(() => job.run(job.controller.signal)).then(blob => { job.settled = true; job.resolve(blob); }, error => { job.settled = true; job.reject(error); }).finally(() => {
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
        this.active--; this.pump();
      });
    }
  }
}

export const imageQueue = new ImageQueue();
function aborted(): DOMException { return new DOMException('Imagem cancelada.', 'AbortError'); }

export async function downloadImage(uri: string, signal: AbortSignal): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(uri, { signal, headers: { Accept: 'image/jpeg,image/png,image/webp' } });
    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      // Image CDN retries do not occupy the metadata queue.
      const retryAfter = response.headers.get('Retry-After');
      const seconds = Number(retryAfter);
      const delay = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;
      await response.body?.cancel();
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(aborted()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, Math.min(30_000, Math.max((attempt + 1) * 1000, delay || 0)));
        if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
      });
      continue;
    }
    if (!response.ok) throw new Error(`Falha ao carregar imagem (${response.status}).`);
    return response.blob();
  }
}
