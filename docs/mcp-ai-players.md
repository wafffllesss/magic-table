# AI players via MCP

When the host enters a room, the Electron app starts a local Streamable HTTP MCP endpoint at `http://127.0.0.1:43177/mcp`. Its address appears in the table. Native clients on the same computer may connect without an `Origin` header; requests from external web origins are blocked. If the port is busy, the app reports the conflict. The endpoint is not available to other computers, and the app does not run an AI model itself.

Up to three agents can join vacant seats while the room is in the lobby. A typical flow is:

1. Call `join_room` with the room code, player name, optional password, and a unique `requestId`. Save the returned `agentToken` for subsequent calls.
2. Call `list_decks`, `select_deck` and `set_ready` to choose a valid Commander deck saved on the host computer and confirm readiness.
3. Use `get_state` for the lobby, table, log and the agent's own hand; `get_card` inspects a visible instance. Use `wait_for_update` to wait up to 30 seconds for a revision or connection change.
4. Call `perform_action` for game actions, or `undo` and `redo` with the session revision and history. Each write requires its own `requestId`; reuse the same ID when retrying the same operation.
5. Call `leave_room` to release the seat.

Only the agent's own hand, library and hidden cards are exposed; other players' private data is excluded. Players still resolve card effects. The server closes when the host leaves or exits the app. If a client loses its token, it must join again with a new request ID.

For Codex integration, configure the local MCP URL in your own trusted Codex project configuration and invoke a player agent explicitly. Do not share agent tokens or room passwords. `pnpm desktop:dev` and `pnpm desktop:make` build the MCP bundle; `pnpm test` exercises the protocol and private-state filtering.
