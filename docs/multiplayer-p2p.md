# Multiplayer P2P

The Electron app uses a star-shaped WebRTC topology: the host orders public changes and other participants keep local checkpoints. Firebase Authentication identifies participants; Realtime Database provides the directory, admission, members, presence, signaling and a temporary fallback channel. Peers try direct STUN and, when configured, coturn ICE relay. After 15 seconds with TURN (eight without it), an unopened connection falls back to Firebase. A definitive WebRTC failure falls back immediately; a transient close waits three seconds. Fallback remains active until that participant rejoins. All participants should use the same current version.

## Local development

1. Copy `.env.example` to `.env.local` and fill in your own Firebase Web configuration. For local emulators, the following isolated demo values work without a production account. `pnpm emulator:p2p` starts Auth on port 9099 and Database on 9000.
2. For local TURN issuance, build Functions and also start its emulator on port 5001, configuring `TURN_HOST` in `functions/.env` and `TURN_SHARED_SECRET` in `functions/.secret.local`. Without TURN the app can use STUN and Firebase fallback.
3. Run `pnpm emulator:p2p`, then `pnpm desktop:dev` in another terminal. Use distinct Windows profiles or separate machines/VMs to test multiple Electron installations: one app instance runs per profile.

```dotenv
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-magic-table.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://demo-magic-table.firebaseio.com
VITE_FIREBASE_PROJECT_ID=demo-magic-table
VITE_FIREBASE_APP_ID=demo-app
VITE_FIREBASE_EMULATOR_HOST=127.0.0.1
```

The emulator host is enabled only in development builds. For Functions, install and build in `functions/` with Node 22 (`npm ci && npm run build`), then run `pnpm exec firebase emulators:start --only auth,database,functions --project demo-magic-table` from the project root instead of `pnpm emulator:p2p`.

Database rules restrict writes to authenticated members, protect seats and limit rooms to four players and eight spectators. Clients update their own data and presence; the host controls the phase and seats for the next match. Signaling and fallback messages are limited to a participant and the host; recipients remove processed messages and stale messages expire after 60 seconds.

## Operating your own services

Create your own Firebase project with anonymous Authentication and Realtime Database, review and deploy the rules, and deploy the required Functions explicitly. Never deploy development changes to the maintainers' project. Optional room passwords are application-level checks and a modified client may bypass them; do not reuse passwords. Rooms whose host stops renewing presence disappear from the directory after expiry.

### Optional coturn relay

Coturn can relay WebRTC when direct connections fail, including symmetric NAT. It does not replace Firebase signaling. The client requests one-hour credentials from the `turnIce` callable, which checks room membership and signs `timestamp:uid` with HMAC-SHA1. The shared secret belongs only in Secret Manager and the private coturn configuration. The client refreshes credentials five minutes before expiry and restarts ICE; failures retain STUN and Firebase fallback.

1. Provision a Linux host with a public IP, DNS such as `turn.example.com`, Docker and a TLS certificate. Copy `deploy/coturn/turnserver.conf.example` to `turnserver.conf`, set `TURN_HOST` and a long random `TURN_SHARED_SECRET`, and place the certificate and private key in `deploy/coturn/certs/` with restricted permissions. Behind NAT, configure `external-ip=PUBLIC_IP/PRIVATE_IP` and forward the same ports.
2. Open 3478 UDP/TCP, 5349 TCP and 49152–50175 UDP. Start `docker compose -f deploy/coturn/compose.yaml up -d`. Monitor and update the server.
3. In your own Firebase project, configure `TURN_HOST` in `functions/.env` and set the same shared secret with `pnpm exec firebase functions:secrets:set TURN_SHARED_SECRET`. Build with `pnpm --dir functions build` and deploy the callable explicitly to your own project. Cloud Functions requires Blaze; coturn hosting and traffic also have costs.
4. Test separate networks and use `RTCPeerConnection.getStats()` to confirm the selected relay candidate. Test `turns:` where UDP is blocked and leave a room open beyond one hour to verify renewal. Local tests do not validate a real TURN server.

The sample sets per-user and total quotas of 32 and 256, a per-session limit of 1 MiB/s per direction, and 64 MiB/s aggregate capacity. The 1,024-port UDP range also constrains allocations. Actual capacity depends on CPU, network, ICE candidates, spectators and outbound traffic; monitor real usage and adjust limits. A full room can have 11 peer links to the host.

References: [coturn configuration](https://github.com/coturn/coturn/blob/master/README.turnserver), [Docker image](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md), [Firebase secrets](https://firebase.google.com/docs/functions/config-env), [Functions quotas and pricing](https://firebase.google.com/docs/functions/quotas).

## Privacy and operation

Hands, library order and face-down identities stay in local IndexedDB. Clients hold the public projection in memory. A participant returning without private data loses the seat and enters the next-game queue. Actions pause when a seated player goes offline; that player has up to 120 seconds to return with their identity and local checkpoint. Existing queued players have priority in the next game.

Direct P2P actions do not write game state to RTDB. Firebase fallback transfers only public game messages in ordered temporary mailboxes, which are removed after processing. Visual presence is replaceable and limited to two updates per second. Check Firebase usage and billing before operating a public service.

For the portable Windows app and its profile migration, see the [README](../README.md). The development HTTP origin and packaged app origin have separate local data.
