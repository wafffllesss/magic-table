import { describe, expect, it, vi } from 'vitest';
import { ImageQueue } from './imageQueue';

function deferred() {
  let resolve!: (value: Blob) => void;
  const promise = new Promise<Blob>(yes => { resolve = yes; });
  return { promise, resolve: () => resolve(new Blob(['image'])) };
}

describe('shared image queue', () => {
  it('limits concurrent work and promotes a shared queued request for inspection', async () => {
    const queue = new ImageQueue(4); const order: string[] = [];
    const blockers = Array.from({ length: 4 }, deferred);
    const running = blockers.map((blocker, index) => queue.request(`busy-${index}`, () => { order.push(`busy-${index}`); return blocker.promise; }));
    await vi.waitFor(() => expect(order).toHaveLength(4));
    const upgrade = queue.request('upgrade', async () => { order.push('upgrade'); return new Blob(); }, { priority: 'upgrade' });
    const visible = queue.request('visible', async () => { order.push('visible'); return new Blob(); });
    const inspection = queue.request('upgrade', async () => { throw new Error('Should share'); }, { priority: 'inspection' });
    expect(order).toHaveLength(4);
    blockers[0].resolve(); await upgrade; await inspection; await visible;
    expect(order.slice(4)).toEqual(['upgrade', 'visible']);
    blockers.forEach(blocker => blocker.resolve()); await Promise.all(running);
  });
  it('only aborts active work when its last subscriber leaves and allows a new subscriber to retry', async () => {
    const queue = new ImageQueue(); const blocker = deferred(); let sharedSignal!: AbortSignal;
    const first = new AbortController(); const second = new AbortController();
    const one = queue.request('same', signal => { sharedSignal = signal; return blocker.promise; }, { signal: first.signal });
    const two = queue.request('same', async () => { throw new Error('Should share'); }, { signal: second.signal });
    const rejectedOne = expect(one).rejects.toMatchObject({ name: 'AbortError' });
    const rejectedTwo = expect(two).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(sharedSignal).toBeDefined());
    first.abort(); await rejectedOne; expect(sharedSignal.aborted).toBe(false);
    second.abort(); await rejectedTwo; expect(sharedSignal.aborted).toBe(true);
    const fresh = vi.fn(async () => new Blob());
    await queue.request('same', fresh); expect(fresh).toHaveBeenCalledOnce();
    blocker.resolve();
  });
  it('removes cancelled queued work without running it', async () => {
    const queue = new ImageQueue(1); const blocker = deferred();
    const running = queue.request('block', () => blocker.promise);
    await Promise.resolve(); await Promise.resolve();
    const controller = new AbortController(); const run = vi.fn(async () => new Blob());
    const waiting = queue.request('cancelled', run, { signal: controller.signal });
    const rejected = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; blocker.resolve(); await running;
    expect(run).not.toHaveBeenCalled();
  });
});
