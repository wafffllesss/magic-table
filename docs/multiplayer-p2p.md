# Multiplayer P2P

The Electron app uses a star-shaped WebRTC topology: the host orders public changes and other participants keep local checkpoints. Firebase Authentication identifies participants; Realtime Database provides the directory, admission, members, presence, signaling and a temporary fallback channel. Peers try direct STUN and, when configured, Cloudflare TURN ICE relay. After 15 seconds with TURN (eight without it), an unopened connection falls back to Firebase. A definitive WebRTC failure falls back immediately; a transient close waits three seconds. Fallback remains active until that participant rejoins. All participants should use the same current version.

## Local development

1. Copy `.env.example` to `.env.local` and fill in your own Firebase Web configuration. For local emulators, the following isolated demo values work without a production account. `pnpm emulator:p2p` starts Auth on port 9099 and Database on 9000.
2. Start `pnpm emulator:p2p`. Cloudflare TURN is optional; an HTTPS Worker URL may be set in `VITE_TURN_WORKER_URL` in `.env.local` for testing. Local Firebase emulator identities cannot authenticate against production Firebase; use a dedicated real Firebase project to test the deployed Worker.
3. Start `pnpm desktop:dev` in another terminal. Use distinct Windows profiles or separate machines/VMs to test multiple Electron installations: one app instance runs per profile.

```dotenv
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-magic-table.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://demo-magic-table.firebaseio.com
VITE_FIREBASE_PROJECT_ID=demo-magic-table
VITE_FIREBASE_APP_ID=demo-app
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
```

The emulator host is enabled only in development builds.

To test the TURN relay with a real Firebase project and a deployed Worker, set `VITE_FORCE_TURN=true` in `.env.local` and restart the Vite dev server. This forces WebRTC to use relay candidates in development only; Firebase fallback may still be selected if the relay fails. Check that the connection indicator says TURN relay and exercise game actions between two participants. Remove the setting and restart Vite after testing. Both participants must be able to reach the same Firebase project, and emulator identities cannot authenticate with the deployed Worker.

Database rules restrict writes to authenticated members, protect seats and limit rooms to four players and eight spectators. Clients update their own data and presence; the host controls the phase and seats for the next match. Signaling and fallback messages are limited to a participant and the host; recipients remove processed messages and stale messages expire after 60 seconds.

## Operating your own services

Create your own Firebase project with anonymous Authentication and Realtime Database, review and deploy the rules. Never deploy development changes to the maintainers' project. Optional room passwords are application-level checks and a modified client may bypass them; do not reuse passwords. Rooms whose host stops renewing presence disappear from the directory after expiry.

### Optional Cloudflare TURN relay

The Cloudflare Worker verifies Firebase ID tokens and checks room membership and the room's open status through Realtime Database before issuing TURN credentials. It keeps the Cloudflare token server-side. Credentials last one hour; clients refresh five minutes before expiry. STUN and Firebase fallback remain available if TURN is unavailable. This integration does not require Firebase Functions or Blaze.

1. Enable Workers Free and a workers.dev subdomain in your Cloudflare account, then create a TURN key in the Realtime dashboard. Keep its API token private. See [Cloudflare credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).
2. In `turn-worker/wrangler.jsonc`, set `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL` (the HTTPS database URL from the Firebase console) and `CLOUDFLARE_TURN_KEY_ID`. These values are not secret. Use the same Firebase project as the app and ensure its Realtime Database rules are deployed.
3. Run `pnpm exec wrangler login`, then `pnpm exec wrangler deploy --config turn-worker/wrangler.jsonc`. Set the TURN API token interactively with `pnpm exec wrangler secret put CLOUDFLARE_TURN_API_TOKEN --config turn-worker/wrangler.jsonc`; do not share it or commit it. See [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/). Record the public Worker URL.
4. Set `VITE_TURN_WORKER_URL` to that HTTPS URL in `.env.local` for local app builds and in GitHub Actions Variables for releases. Rebuild the application; existing releases still use the old Function and cannot use the Worker. Never put the private token in a Vite variable or GitHub build configuration.
5. Test separate networks and inspect the selected candidate pair using `RTCPeerConnection.getStats()`; a selected `relay` candidate confirms TURN is in use. Test beyond one hour and with UDP blocked to verify renewal and TCP/TLS. Automated tests and dry-run builds do not validate a live relay.
6. Monitor Cloudflare Realtime and Workers usage and billing. TURN and SFU share the free monthly allowance; traffic beyond it may incur charges. See [Cloudflare pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
## Privacy and operation

Hands, library order and face-down identities stay in local IndexedDB. Clients hold the public projection in memory. A participant returning without private data loses the seat and enters the next-game queue. Actions pause when a seated player goes offline; that player has up to 120 seconds to return with their identity and local checkpoint. Existing queued players have priority in the next game.

Direct P2P actions do not write game state to RTDB. Firebase fallback transfers only public game messages in ordered temporary mailboxes, which are removed after processing. Visual presence is replaceable and limited to two updates per second. Check Firebase usage and billing before operating a public service.

For the portable Windows app and its profile migration, see the [README](../README.md). The development HTTP origin and packaged app origin have separate local data.
