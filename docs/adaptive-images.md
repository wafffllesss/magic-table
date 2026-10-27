# Adaptive images

Cards and playmats request images only when visible. The smallest available image is loaded first and remains visible until an upgrade has downloaded and decoded. Failed upgrades retain the previous image.

Card image sizes are `small` (146 px), `normal` (488 px), and `large` (672 px); projected dimensions and device density capped at 1.5 determine the choice. Inspection requests at least `normal`. Playmats start with a 320 px thumbnail and upgrade to 1600 px as needed. Resolution never drops during a display; changing card, face or source resets the selection. Face-down cards do not request images. Shared visibility and size observers and a 200 ms camera-stability delay reduce measurements. The DOM exposes the selected width through `data-image-width`.

A shared queue permits four concurrent image operations, separate from the rate-limited Scryfall metadata queue. Inspections take precedence over thumbnails, followed by upgrades. Consumers share requests; the last consumer cancels pending work. `ScryfallService.image(card, size, face, {signal, priority})` supports `large` and independent object URLs.

IndexedDB v3 stores sizes and last access in `cacheEntries`; its byte counter updates atomically with writes and eviction. Usage and eviction do not load all blobs, and reads do not rewrite images. Migration preserves v1/v2 decks, preferences and images. The disposable cache limit remains 200 MiB, with least-recently-used eviction and an in-memory fallback.

## Reproducing the comparison

The opt-in benchmark uses deterministic decks, shuffle and JPEGs. `before` reproduces the former image component, serial queue and cache rereads without changing the app. In PowerShell, without concurrent tests or builds:

```powershell
$env:IMAGE_BENCHMARK='before'
pnpm exec playwright test e2e/images-benchmark.spec.ts --workers=1
$env:IMAGE_BENCHMARK='after'
pnpm exec playwright test e2e/images-benchmark.spec.ts --workers=1
Remove-Item Env:IMAGE_BENCHMARK
```

Results and screenshots are written to `.cache/image-benchmark-{before,after}.*`; the benchmark is skipped when the variable is absent. A local Chromium measurement at 1280 × 720 on 2026-10-15 reduced initial cold-cache image bodies from 1,378,118 to 351,274 bytes (74.5%); the initial requests changed from 15 small plus 7 normal to 22 small. The last initial request started at 4,792 ms before and 416 ms after. Cold-cache long tasks were one at 178 ms before and one at 144 ms after; warm-cache downloads were zero and long tasks were one at 60 ms in each run. Response bytes exclude headers. The last request is not total render time, and these results do not establish an overall FPS improvement.
