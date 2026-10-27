# Table performance — 2026-10-16

The camera and cursor update their own layers without rebuilding groups or rerendering card fields. History shares immutable definitions and keeps ten actions in total across undo and redo. Name queries use batches, and P2P checkpoints are sent only to the reconnecting participant.

## Measured comparison

Median of three samples after warmup, using isolated production builds and the same data and movements:

| Measurement | Before | After |
| --- | ---: | ---: |
| `GameTable` renders during camera gesture | 54 | 0 |
| Template group-filter calls during gesture | 2,808 | 0 |
| History retained after 200 actions, post-GC heap | 175.40 MiB | 5.49 MiB |
| History entries after 200 actions | 200 | 10 |
| History retained after 1,000 actions, post-GC heap | Not run | 5.50 MiB |
| 200 actions with history | 1,650.0 ms | 1,823.7 ms |
| Deck reads loading 30 cold lists | 1,724 | 31 |
| Loading those lists with controlled API | 27,667.4 ms | 11,189.1 ms |
| Reconnection checkpoint bytes, three open channels | 1,309,806 | 145,534 |
| Reconnection packets | 81 | 9 |
| Reconnection serializations/splits | 9 | 1 |

The history retained 96.9% less heap; recording 200 actions took 10.5% longer, about 0.87 ms more per action. Cold loading used 98.2% fewer deck reads and took 59.6% less time. Checkpoint bytes fell by 88.9% with targeted delivery. Twelve optimized scenes had no `GameTable` rerenders, field updates or index rebuilds during camera/cursor motion. Older `TableField` render counts are not comparable because the component was extracted during the change.

## Frames and images

Intervals between `requestAnimationFrame` callbacks in milliseconds; each gesture has 16 movements. Values are medians of sample percentiles.

| Scene | Cache | P50 before → after | P95 before → after |
| --- | --- | ---: | ---: |
| 200 tokens | Cold | 114.55 → 72.60 | 130.60 → 98.70 |
| 200 tokens | Warm | 125.20 → 67.85 | 154.20 → 76.90 |
| 200 permanents with images and metadata | Cold | 111.45 → 75.00 | 124.20 → 142.80 |
| 200 permanents with images and metadata | Warm | 136.60 → 82.45 | 144.70 → 138.20 |

Median long tasks during the gesture fell from 19 to zero across these scenes. This does not establish 60 FPS: intervals remain above 16.7 ms and cold-image P95 worsened. Validation on a real GPU remains necessary. Image scenes use precon fixture metadata and deterministic synthetic JPEGs of 146, 488 and 672 px; both builds served 201 images totaling 2,011,809 bytes cold, and zero warm. Zoom, drag and inspection are exercised but their latency is not separately measured.

## Environment and reproduction

Windows x64 10.0.26200, Ryzen 5 3600X, 15.95 GiB RAM, Node 24.14.0, Chromium 156.0.8078.4, viewport 1280 × 720, ANGLE/Vulkan SwiftShader software rendering. Heap means JavaScript heap after GC, not total Electron, decoded image or GPU memory.

```sh
pnpm benchmark:performance --label before
# Make the change.
pnpm benchmark:performance --label after
```

Run without concurrent tests or builds. Each run uses one warmup and three isolated samples with deterministic inputs and controlled Scryfall/image responses. Results, hashes, environment and screenshots go to `.cache/performance/{before,after}/`. The history comparison uses previous full snapshots versus `MatchHistory`; P2P measurements count serialized packets without WebRTC/UDP headers. `--reuse-build` requires a previously preserved build.

The reference build SHA-256 was `f1ad28512a690ca7de788c3b918a40406bc00fd1365e221291ecea4d7c836b4a`; the optimized build SHA-256 was `3c5986d553058447e1e853d0ffb968d1421324d6366a2e2af94a120915548e4c`. Historical validation covered unit tests, emulator rules, browser tests, Firebase multiplayer integration, typechecking and production builds. These historical results are not a substitute for running current checks.
