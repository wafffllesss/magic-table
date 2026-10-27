import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { MatchState } from '../domain/game';
import { sanitizeAgentState } from './mcpAgents';

const require = createRequire(import.meta.url);
const serverModule = require('../../electron/mcp-server.cjs') as { start(options: { window: object; dispatch: (tool: string, args: Record<string, unknown>) => Promise<unknown> }): Promise<string>; stop(): Promise<void> };

describe('local MCP server', () => {
  afterEach(async () => { await serverModule.stop(); });

  it('serves tools, blocks hostile origins and reports a busy fixed port', async () => {
    const dispatch = vi.fn(async (tool: string, args: Record<string, unknown>) => ({ tool, received: args }));
    const endpoint = await serverModule.start({ window: {}, dispatch });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint));
    const client = new Client({ name: 'mcp-server-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map(tool => tool.name)).toContain('perform_action');
      expect(tools.map(tool => tool.name)).toContain('wait_for_update');
      const result = await client.callTool({ name: 'join_room', arguments: { code: 'ABC123', name: 'Test Bot', requestId: 'join-test-0001' } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0].type === 'text' ? result.content[0].text : '{}')).toEqual({
        tool: 'join_room', received: { code: 'ABC123', name: 'Test Bot', requestId: 'join-test-0001' },
      });
      const waited = await client.callTool({ name: 'wait_for_update', arguments: {
        agentToken: 'agent-token', afterRevision: null, afterConnectionState: 'connected', timeoutMs: 1000,
      } });
      expect(waited.isError).not.toBe(true);
      expect(dispatch).toHaveBeenCalledWith('wait_for_update', {
        agentToken: 'agent-token', afterRevision: null, afterConnectionState: 'connected', timeoutMs: 1000,
      });
      expect(dispatch).toHaveBeenCalledTimes(2);
    } finally { await client.close(); }
    const response = await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(403);
    await serverModule.stop();
    const blocker = createServer();
    await new Promise<void>((resolve, reject) => { blocker.once('error', reject); blocker.listen(43177, '127.0.0.1', resolve); });
    try {
      await expect(serverModule.start({ window: {}, dispatch: vi.fn(async () => ({})) })).rejects.toThrow('43177 já está em uso');
    } finally { await new Promise<void>(resolve => blocker.close(() => resolve())); }
  });
});

describe('MCP agent privacy projection', () => {
  it('keeps only this agent’s hand and library cards in its readable state', () => {
    const state = {
      id: 'm', revision: 1, phase: 'playing', paused: false, activeSeatId: 'northWest', turn: 1, step: 'Compra',
      seats: ['northWest', 'northEast', 'southEast', 'southWest'].map(id => ({ id, name: id, status: 'playing', commanderIds: [], library: ['hidden'], hand: ['hidden'], mulligans: 0, keptHand: true, life: 40, poison: 0, commanderCasts: {}, commanderDamage: {}, landPlays: 0 })),
      cards: {
        own: { id: 'own', ownerId: 'northWest', controllerId: 'northWest', cardId: 'card-a', zone: 'hand', tapped: false, faceDown: false, x: 0, y: 0, counters: {}, card: { name: 'Own card' } },
        opponent: { id: 'opponent', ownerId: 'northEast', controllerId: 'northEast', cardId: 'card-secret', zone: 'hand', tapped: false, faceDown: false, x: 0, y: 0, counters: {}, card: { name: 'Secret card' } },
        revealed: { id: 'revealed', ownerId: 'northEast', controllerId: 'northEast', cardId: 'card-known', zone: 'hand', tapped: false, faceDown: false, revealed: true, x: 0, y: 0, counters: {}, card: { name: 'Known card' } },
      }, stack: [], passes: [], log: [], updatedAt: 0,
    } as unknown as MatchState;
    const projected = sanitizeAgentState(state, 'northWest');
    expect(projected.seats[0]?.hand).toEqual(['hidden']);
    expect(projected.seats[1]?.hand).toEqual([]);
    expect(Object.keys(projected.cards)).toEqual(['own', 'revealed']);
    expect(state.cards).toHaveProperty('opponent');
  });
});
