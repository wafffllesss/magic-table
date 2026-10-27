# Meu Magic

Meu Magic is an unofficial virtual tabletop for casual Magic: The Gathering Commander games. It provides a four-seat table, deck library, public zones, counters, shortcuts, multiplayer rooms and optional local MCP clients. Players resolve card effects themselves; it is not a rules engine or an anti-cheat system.

The project is **source available for noncommercial use** under the [PolyForm Noncommercial License 1.0.0](LICENSE). Third-party content has separate terms; see [third-party notices](THIRD_PARTY_NOTICES.md). This project is not approved or endorsed by Wizards of the Coast.

## Windows portable app

Once releases are available, download `MeuMagic-<version>-x64.exe` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/wafffllesss/magic-table/releases). The portable app runs on Windows x64 without installing Node.js or pnpm. It is unsigned and has no automatic updater. Close the old app and replace the executable to update.

The app stores decks, preferences, Firebase identity and cache in `%APPDATA%/meu-magic`; these are not included in the executable. On the first launch after the rename, it copies the previous `%APPDATA%/mana-table` profile and imports its IndexedDB data. Close the old version before the first launch; the old profile is retained. The packaged app uses the separate `app://meu-magic` origin.

Choose **Join with code** to enter a multiplayer room. The portable app does not register a `meumagic://` Windows protocol. Multiplayer requires the configured Firebase services and internet access. Scryfall searches and images not already cached also require internet. The app can use cached cards and images offline once loaded, but does not install a service worker to make the web app available offline.

## Run locally

Requirements: Node.js 24, pnpm 11.22.0, and Java 21 or newer for Firebase emulator tests. Functions are built with Node.js 22. On Windows, `pnpm desktop:make` builds the portable executable.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL printed by Vite and choose the local demonstration. The first load resolves 30 bundled preconstructed deck lists with Scryfall; subsequent loads reuse local data. The demo uses four distinct decks. You can also select and save personal decks. If Scryfall is unavailable during the initial load, retry from the application.

```sh
pnpm desktop:dev   # Electron development
pnpm desktop:make  # Windows x64 portable build in out/portable/
```

The renderer uses Vue 3, TypeScript and a CSS 3D table. Mouse or touch gestures move the view; public zones can be inspected, while context menus provide card actions. Keyboard users can open context menus with Shift+F10. See the in-app tutorial for controls.

## Multiplayer and data

For development, copy `.env.example` to `.env.local` and configure your own Firebase Web app. The project uses Authentication and Realtime Database for identity, room coordination and signaling; peer connections use WebRTC, with an optional coturn relay and Firebase fallback. Local emulators isolate development from production. See [multiplayer setup and privacy](docs/multiplayer-p2p.md) and [AI players via MCP](docs/mcp-ai-players.md).

IndexedDB stores local decks, preferences and a 200 MiB combined disposable card/image cache; decks are not evicted with cached images. Images load as needed. The app falls back to memory if IndexedDB is unavailable and warns that data will not persist. See [adaptive images](docs/adaptive-images.md).

The preconstructed lists are in `src/data/precons.json`, derived from original product lists via MTGJSON. `node scripts/import-precons.mjs` refreshes the catalog; review its changes and fixtures. `node scripts/verify-precons.mjs` queries the live Scryfall API, whereas normal tests use controlled fixtures.

## Checks

```sh
pnpm typecheck
pnpm test
node --test scripts/release-version.test.mjs
pnpm test:rules
pnpm exec playwright install chromium
pnpm test:e2e --workers=1
pnpm test:firebase
pnpm build
```

`test:rules` and `test:firebase` start local Firebase emulators and require Java 21+. The latter uses isolated browser profiles and checks multiplayer behavior. Run `npm ci && npm run build` in `functions/` with Node 22. Performance measurements and their limitations are described in [the performance report](docs/performance.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). For maintainer setup and release operation see [publication and releases](docs/publication.md).

The bundled Wizards-derived playmats require a rights review before this repository or its builds are made public. See [third-party notices](THIRD_PARTY_NOTICES.md).

The desktop app checks GitHub for a newer stable release at startup and prepares the starter and local decks, caching card data and small front images. The first preparation may take longer; it can be skipped, and missing cards and images can be loaded later. If an update is available, its release page opens in the browser; close the old app and replace the portable executable manually.
