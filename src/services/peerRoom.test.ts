import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerRoom } from './peerRoom';
import { roomBackend } from './roomBackend';
import { localRepository } from './storage';
import { startDemoMatch } from './demo';
import { applyAction, composeMatchState, privateProjection, publicProjection, type MatchState } from '../domain/game';
import { fixtureDecks } from '../../tests/fixtures/scryfall';
import { publicGameUpdate } from './firebaseState';
import { preconFixtureDecks } from '../../tests/fixtures/precons';

vi.mock('./roomBackend', () => ({ roomBackend: { uid: 'guest', id: 'session' } }));

function session(): any {
  const local = startDemoMatch('Lia', fixtureDecks());
  for (const seat of local.seats) seat.participantUid = seat.id === 'southWest' ? 'guest' : `uid-${seat.id}`;
  const room: any = new PeerRoom();
  room.room = { roomId: crypto.randomUUID() };
  room.member = { uid: 'guest', role: 'player', seatId: 'southWest' };
  room.snapshot = { hostUid: 'host' };
  room.publicState = publicProjection(local);
  room.localState = composeMatchState(room.publicState, 'southWest', privateProjection(local, 'southWest'));
  room.confirmedPublicState = room.publicState;
  room.confirmedPrivateState = privateProjection(local, 'southWest');
  room.transport = { sendToHost: vi.fn(async () => {}), sendHost: vi.fn(async () => {}), sendToPeer: vi.fn(async () => {}), connectedPeerUids: ['a','b','c'] };
  return room;
}
afterEach(async () => { await localRepository.close(); });

describe('room chat', () => {
  it('lets the host validate and relay a player message to spectators, ignoring duplicates and spectator sends', async () => {
    const host = session();
    host.snapshot.hostUid = 'guest';
    host.members = [
      { uid: 'guest', role: 'player', seatId: 'southWest' },
      { uid: 'player', role: 'player', seatId: 'northEast' },
      { uid: 'viewer', role: 'spectator', seatId: null },
    ];
    const viewer: any = new PeerRoom({ uid: 'viewer' } as any, localRepository);
    viewer.snapshot = { hostUid: 'guest' };
    viewer.members = host.members;
    const seen: string[] = [];
    viewer.addEventListener('chat-message', (event: Event) => seen.push((event as CustomEvent).detail.text));
    host.transport.sendHost = vi.fn(async (_type: string, payload: unknown) => {
      await viewer.onPeerMessage({ peerUid: 'guest', channel: 'room-state', message: { type: 'CHAT_BROADCAST', payload } });
    });
    const payload = { id: crypto.randomUUID(), text: 'Boa jogada 🃏' };
    await host.onPeerMessage({ peerUid: 'player', channel: 'room-state', message: { type: 'CHAT_SEND', payload } });
    await host.onPeerMessage({ peerUid: 'player', channel: 'room-state', message: { type: 'CHAT_SEND', payload } });
    await host.onPeerMessage({ peerUid: 'viewer', channel: 'room-state', message: { type: 'CHAT_SEND', payload: { id: crypto.randomUUID(), text: 'oi' } } });
    expect(seen).toEqual(['Boa jogada 🃏']);
    expect(host.transport.sendHost).toHaveBeenCalledTimes(1);
    expect(host.transport.sendHost).toHaveBeenCalledWith('CHAT_BROADCAST', expect.objectContaining({ uid: 'player', seatId: 'northEast' }), expect.any(Number), payload.id);
  });
});

describe('peer room checkpoints', () => {
  it('accepts the last player passing priority on another player’s instant', async () => {
    const room = session();
    room.snapshot = { ...room.snapshot, hostUid: 'guest', connectionState: 'connected' };
    room.members = [{ uid: 'guest', role: 'player', seatId: 'southWest' }];
    const game = startDemoMatch('Lia', fixtureDecks());
    game.seats = game.seats.filter(seat => seat.id === 'northWest' || seat.id === 'southWest');
    game.stack = [];
    game.passes = [];
    for (const seat of game.seats) seat.participantUid = seat.id === 'southWest' ? 'guest' : 'uid-northWest';
    const caster = game.seats.find(seat => seat.id === 'northWest')!;
    const spellId = caster.hand[0];
    game.cards[spellId].card!.type_line = 'Instant';
    let state = applyAction(game, caster.id, { type: 'CAST', cardId: spellId });
    state = applyAction(state, caster.id, { type: 'PASS_PRIORITY' });
    room.publicState = publicProjection(state);
    room.localState = composeMatchState(room.publicState, 'southWest', privateProjection(state, 'southWest'));
    room.confirmedPublicState = room.publicState;
    room.confirmedPrivateState = privateProjection(state, 'southWest');

    const resolved = await room.act({ type: 'PASS_PRIORITY' }, 'resolve-opponent-spell');
    expect(resolved.stack).toHaveLength(0);
    expect(room.publicState.cards[spellId].zone).toBe('graveyard');
    expect(room.publicState.hiddenZones.northWest.graveyard).toBe(1);
  });

  it('publishes creature token data and synchronizes its automatic removal', async () => {
    const room = session();
    room.snapshot = { ...room.snapshot, hostUid: 'guest', connectionState: 'connected' };
    room.members = [{ uid: 'guest', role: 'player', seatId: 'southWest' }];
    const card = { id: 'scryfall-spirit-token', oracle_id: 'oracle-spirit-token', name: 'Spirit', layout: 'token', color_identity: ['W'], keywords: [], mana_cost: '', type_line: 'Token Creature — Spirit', oracle_text: '', power: '1', toughness: '1', legalities: {} };

    const created = await room.act({ type: 'CREATE_TOKEN', card }, 'create-spirit');
    const token = Object.values(created.cards).find((item: any) => item.isToken) as any;
    expect(room.publicState.cards[token.id]).toMatchObject({ isToken: true, zone: 'battlefield', card: { name: 'Spirit' } });

    const removed = await room.act({ type: 'MOVE_CARD', cardId: token.id, zone: 'exile' }, 'remove-spirit');
    expect(removed.cards[token.id]).toBeUndefined();
    expect(room.publicState.cards[token.id]).toBeUndefined();
  });

  it('lets only the host suspend a disconnected participant after the mulligan', async () => {
    const room = session();
    const opponentUid = 'uid-northWest';
    room.snapshot.hostUid = 'guest';
    room.publicState.disconnectedSeatIds = ['northWest'];
    room.publicState.paused = true;
    room.localState.disconnectedSeatIds = ['northWest'];
    room.localState.paused = true;
    room.members = [
      { uid: 'guest', role: 'player', seatId: 'southWest' },
      { uid: opponentUid, role: 'player', seatId: 'northWest' },
    ];

    await room.continueWithout('northWest');

    expect(room.publicState.suspendedSeatIds).toContain('northWest');
    expect(room.publicState.paused).toBe(false);
    expect(room.transport.sendHost).toHaveBeenCalledWith('CONTROL', expect.anything(), room.publicState.revision, expect.any(String));

    const activeSeat = room.publicState.activeSeatId;
    room.transport.connectedPeerUids = [opponentUid];
    await room.onPeerMessage({ peerUid: opponentUid, channel: 'room-state', message: { type: 'RESTORED', payload: {
      matchId: room.publicState.id, seatId: 'northWest', revision: room.publicState.revision,
    } } });
    expect(room.publicState.suspendedSeatIds).not.toContain('northWest');
    expect(room.publicState.activeSeatId).toBe(activeSeat);

    const previous = room.publicState;
    const forged = publicGameUpdate(applyAction(room.localState, 'southWest', { type: 'SET_LIFE', amount: 1 }), 'southWest') as MatchState;
    forged.paused = true;
    forged.lastActionId = 'forged-control';
    await expect(room.acceptProposal('guest', 'southWest', 'forged-control', 'SET_LIFE', forged, previous.revision)).rejects.toThrow('Somente o anfitrião');
  });

  it('starts a match with two connected ready players and delivers it to both players', async () => {
    const deck = preconFixtureDecks()[0];
    const deckSummary = deck.entries.filter(entry => entry.role === 'commander').map(entry => ({ cardId: entry.cardId, name: entry.name, role: 'commander' as const }));
    const setPhase = vi.fn(async () => {});
    const host = new PeerRoom({ uid: 'host', setPhase } as any, localRepository) as any;
    const peer = new PeerRoom({ uid: 'peer' } as any, localRepository) as any;
    const hostMember = { uid: 'host', role: 'player', seatId: 'southWest', ready: true, deckName: deck.name, deckSummary };
    const peerMember = { uid: 'peer', role: 'player', seatId: 'northEast', ready: true, deckName: deck.name, deckSummary };
    host.room = peer.room = { roomId: 'two-player-start' };
    host.member = hostMember; peer.member = peerMember;
    host.members = peer.members = [hostMember, peerMember];
    host.snapshot = { hostUid: 'host', seats: {}, queue: [] };
    peer.snapshot = { hostUid: 'host', seats: {}, queue: [] };
    host.localDeck = peer.localDeck = deck;
    host.transport = { connectedPeerUids: ['peer'], sendHost: vi.fn(async (type: string, state: unknown) => {
      await peer.onPeerMessage({ peerUid: 'host', channel: 'room-state', message: { type, payload: state } });
    }) };
    peer.transport = { connectedPeerUids: ['host'], sendHost: vi.fn(async () => {}) };

    await host.maybeStartMatch();

    expect(setPhase).toHaveBeenCalledOnce();
    expect(setPhase).toHaveBeenCalledWith('playing');
    expect(host.snapshot.state.phase).toBe('mulligan');
    expect(peer.snapshot.state.phase).toBe('mulligan');
    expect(host.publicState.seats).toHaveLength(2);
    expect(host.publicState.seats.map((seat: any) => seat.participantUid)).toEqual(['peer', 'host']);
    expect(host.transport.sendHost).toHaveBeenCalledWith('START', host.publicState, host.publicState.revision);
  });

  it('does not start until every seated player is ready', async () => {
    const deck = preconFixtureDecks()[0];
    const deckSummary = deck.entries.filter(entry => entry.role === 'commander').map(entry => ({ cardId: entry.cardId, name: entry.name, role: 'commander' as const }));
    const setPhase = vi.fn(async () => {});
    const room = new PeerRoom({ uid: 'host', setPhase } as any, localRepository) as any;
    room.room = { roomId: 'waiting-for-player' };
    room.member = { uid: 'host', role: 'player', seatId: 'southWest' };
    room.members = [
      { uid: 'host', role: 'player', seatId: 'southWest', ready: true, deckName: deck.name, deckSummary },
      { uid: 'peer', role: 'player', seatId: 'northEast', ready: false, deckName: deck.name, deckSummary },
    ];
    room.snapshot = { hostUid: 'host', seats: {}, queue: [] };
    room.localDeck = deck;
    room.transport = { connectedPeerUids: ['peer'], sendHost: vi.fn(async () => {}) };

    await room.maybeStartMatch();

    expect(room.publicState).toBeUndefined();
    expect(setPhase).not.toHaveBeenCalled();
    expect(room.transport.sendHost).not.toHaveBeenCalled();
  });

  it('can retry match start when the phase update fails', async () => {
    const deck = preconFixtureDecks()[0];
    const deckSummary = deck.entries.filter(entry => entry.role === 'commander').map(entry => ({ cardId: entry.cardId, name: entry.name, role: 'commander' as const }));
    const setPhase = vi.fn().mockRejectedValueOnce(new Error('phase update failed')).mockResolvedValue(undefined);
    const room = new PeerRoom({ uid: 'host', setPhase } as any, localRepository) as any;
    room.room = { roomId: 'retry-start' };
    room.member = { uid: 'host', role: 'player', seatId: 'southWest' };
    room.members = [{ uid: 'host', role: 'player', seatId: 'southWest', ready: true, deckName: deck.name, deckSummary }];
    room.snapshot = { hostUid: 'host', seats: {}, queue: [] };
    room.localDeck = deck;
    room.transport = { connectedPeerUids: [], sendHost: vi.fn(async () => {}) };

    await room.maybeStartMatch();
    expect(room.publicState).toBeUndefined();
    expect(room.snapshot.lastError).toContain('phase update failed');

    await room.maybeStartMatch();
    expect(room.publicState).toBeDefined();
    expect(room.snapshot.state.phase).toBe('mulligan');
    expect(room.snapshot.lastError).toBeUndefined();
  });

  it('waits for a new revision and returns the current snapshot', async () => {
    const room = session();
    room.snapshot = { state: { revision: 4 }, connectionState: 'connected' };
    const waiting = room.waitForUpdate(4, 'connected', 1000);
    setTimeout(() => room.patchSnapshot({ state: { revision: 5 } }), 10);
    const result = await waiting;
    expect(result.timedOut).toBe(false);
    expect(result.snapshot?.state?.revision).toBe(5);
  });

  it('returns after its bounded wait even when the table does not change', async () => {
    const room = session();
    room.snapshot = { state: { revision: 4 }, connectionState: 'connected' };
    const result = await room.waitForUpdate(4, 'connected', 1);
    expect(result.timedOut).toBe(true);
    expect(result.snapshot?.state?.revision).toBe(4);
  });

  it('keeps initialized private data when the host reconnects and sends a checkpoint', async () => {
    const room = session();
    const own = privateProjection(room.localState, 'southWest');
    await room.saveLocalState(room.publicState, own);
    await room.onPeerMessage({ peerUid: 'host', channel: 'room-state', message: {
      type: 'SNAPSHOT', payload: { state: room.publicState },
    } });
    expect(room.member.role).toBe('player');
    expect(privateProjection(room.localState, 'southWest')).toEqual(own);
    room.member = { ...room.member, seatId: null, role: 'spectator' };
    const spectator = room.compose(room.publicState);
    expect(spectator.seats.every((seat: any) => Array.isArray(seat.hand) && Array.isArray(seat.library))).toBe(true);
    expect(Object.values(spectator.cards).some((card: any) => ['hand', 'library'].includes(card.zone))).toBe(false);
  });

  for (const accepted of [false, true]) {
    it('recovers an interrupted private draw when the host ' + (accepted ? 'accepted it' : 'kept the prior revision'), async () => {
      const room = session();
      const prior = room.localState;
      const drawn = applyAction(prior, 'southWest', { type: 'DRAW' });
      const next = publicGameUpdate(drawn, 'southWest');
      next.lastActionId = 'interrupted-draw';
      await room.saveLocalState(room.publicState, room.confirmedPrivateState, {
        actionId: next.lastActionId, revision: next.revision, publicState: next, privateState: privateProjection(drawn, 'southWest'),
      });
      const saved = (await localRepository.getRoomSession(room.room.roomId, 'guest'))!;
      const recovered = session();
      recovered.room = room.room;
      recovered.publicState = saved.publicState;
      recovered.confirmedPublicState = saved.publicState;
      recovered.confirmedPrivateState = saved.privateState;
      recovered.localPending = saved.pending;
      recovered.restoredLocalMatchId = saved.matchId;
      recovered.localState = composeMatchState(saved.publicState, 'southWest', saved.privateState as ReturnType<typeof privateProjection>);
      await recovered.onPeerMessage({ peerUid: 'host', channel: 'room-state', message: {
        type: 'SNAPSHOT', payload: { state: accepted ? next : saved.publicState },
      } });
      const expected = privateProjection(accepted ? drawn : prior, 'southWest');
      expect(privateProjection(recovered.localState, 'southWest')).toEqual(expected);
      const checkpoint = (await localRepository.getRoomSession(room.room.roomId, 'guest'))!;
      expect(checkpoint.pending).toBeUndefined();
      expect(checkpoint.revision).toBe(accepted ? next.revision : saved.revision);
    });
  }

  it('completes fast host actions and undo without losing the commit promise or remote counts', async () => {
    const room = session();
    const writes = vi.spyOn(localRepository, 'saveRoomSession');
    room.snapshot = { hostUid: 'guest', connectionState: 'connected' };
    const initial = structuredClone(room.localState);
    const remoteCounts = structuredClone(room.publicState.hiddenZones.northWest);
    const changed = await room.act({ type: 'SET_LIFE', amount: 1 });
    expect(writes).toHaveBeenCalledTimes(2); // Pending checkpoint, then durable confirmation.
    expect(changed.seats.find((seat: any) => seat.id === 'southWest').life).toBe(41);
    expect(room.pending.size).toBe(0);
    expect(room.publicState.hiddenZones.northWest).toEqual(remoteCounts);
    expect(room.publicState.seats.every((seat: any) => !('hand' in seat) && !('library' in seat))).toBe(true);
    const restored = await room.restoreHistoryState(initial, changed.revision, 'UNDO');
    expect(writes).toHaveBeenCalledTimes(4);
    expect(restored.seats.find((seat: any) => seat.id === 'southWest').life).toBe(40);
    expect(restored.revision).toBe(changed.revision + 1);
    expect(room.pending.size).toBe(0);
    const saved = (await localRepository.getRoomSession(room.room.roomId, 'guest'))!;
    expect(saved.pending).toBeUndefined();
    expect(saved.revision).toBe(restored.revision);
  });

  it('sends a checkpoint only to the new peer and defers it during START', async () => {
    const room = session();
    room.isHost = () => true;
    room.members = ['a','b','c'].map(uid => ({ uid }));
    room.startLock = true; room.checkpointPeers.add('b');
    await room.flushCheckpoints();
    expect(room.transport.sendToPeer).not.toHaveBeenCalled();
    room.startLock = false;
    await room.flushCheckpoints();
    expect(room.transport.sendToPeer).toHaveBeenCalledExactlyOnceWith('b', 'SNAPSHOT', { state: room.publicState }, room.publicState.revision);
    expect(room.transport.sendHost).not.toHaveBeenCalled();
    await room.flushCheckpoints();
    expect(room.transport.sendToPeer).toHaveBeenCalledOnce();
  });

  it('persists pending state before ACK and writes confirmed state once before resolving', async () => {
    const room = session();
    await room.saveLocalState(room.publicState, room.confirmedPrivateState);
    const next = publicGameUpdate(applyAction(room.localState, 'southWest', { type: 'SET_LIFE', amount: 1 }), 'southWest');
    expect(next.hiddenZones.northWest.hand).toBe(room.publicState.hiddenZones.northWest.hand);
    const privateHand = [...room.localState.seats.find((seat: any) => seat.id === 'southWest').hand];
    next.lastActionId = 'action';
    const pending = room.makePending('action', next.revision, new Set());
    const resolved = vi.fn(); pending.resolve = resolved;
    room.transport.sendToHost.mockImplementation(async () => {
      const saved = (await localRepository.getRoomSession(room.room.roomId, 'guest'))!;
      expect(saved.revision).toBe(next.revision - 1);
      expect(saved.pending!.publicState.revision).toBe(next.revision);
      expect(resolved).not.toHaveBeenCalled();
    });
    await room.onPeerMessage({ peerUid: 'host', channel: 'room-state',
      message: { type: 'COMMIT', payload: { state: next, actorUid: 'guest', actorSeatId: 'southWest', actionId: 'action', actionType: 'SET_LIFE' } } });
    expect(room.transport.sendToHost).toHaveBeenCalled();
    const write = vi.spyOn(localRepository, 'saveRoomSession');
    const confirm = { peerUid: 'host', channel: 'room-state', message: { type: 'CONFIRMED', payload: { actionId: 'action', revision: next.revision } } };
    await Promise.all([room.onPeerMessage(confirm), room.onPeerMessage(confirm)]);
    const saved = (await localRepository.getRoomSession(room.room.roomId, 'guest'))!;
    expect(write).toHaveBeenCalledOnce();
    expect(saved.revision).toBe(next.revision);
    expect(saved.pending).toBeUndefined();
    expect(resolved).toHaveBeenCalledOnce();
    expect(composeMatchState(saved.publicState, 'southWest', saved.privateState as ReturnType<typeof privateProjection>).seats.find(seat => seat.id === 'southWest')!.hand).toEqual(privateHand);
  });

  it('isolates persisted data from subsequent changes to the input state', async () => {
    const room = session();
    const originalLife = room.publicState.seats[0].life;
    await room.saveLocalState(room.publicState, room.confirmedPrivateState);
    room.publicState.seats[0].life = -100;
    expect(room.confirmedPublicState.seats[0].life).toBe(originalLife);
    const saved = (await localRepository.getRoomSession(room.room.roomId, 'guest'))!;
    expect(saved.publicState.seats[0].life).toBe(originalLife);
    expect(roomBackend.uid).toBe('guest');
  });
});

describe('shared targets', () => {
  it('validates and broadcasts to the author and spectators once, without changing the match', async () => {
    const host = session(); host.snapshot = { hostUid: 'guest', online: true };
    host.members = [{ uid: 'guest', role: 'player', seatId: 'southWest' }, { uid: 'player', role: 'player', seatId: 'northEast' }, { uid: 'viewer', role: 'spectator', seatId: null }];
    const viewer: any = new PeerRoom({ uid: 'viewer' } as any, localRepository);
    viewer.snapshot = { hostUid: 'guest' }; viewer.members = host.members; viewer.publicState = host.publicState;
    const author: any = new PeerRoom({ uid: 'player' } as any, localRepository);
    author.snapshot = { hostUid: 'guest' }; author.members = host.members; author.publicState = host.publicState;
    const hostSeen: any[] = [], viewerSeen: any[] = [], authorSeen: any[] = [];
    host.addEventListener('target-mark', (event: CustomEvent) => hostSeen.push(event.detail));
    viewer.addEventListener('target-mark', (event: CustomEvent) => viewerSeen.push(event.detail));
    author.addEventListener('target-mark', (event: CustomEvent) => authorSeen.push(event.detail));
    host.transport.sendHost = vi.fn(async (_type: string, payload: unknown) => {
      for (const room of [viewer, author]) await room.onPeerMessage({ peerUid: 'guest', channel: 'room-state', message: { type: 'TARGET_BROADCAST', payload } });
    });
    const card = Object.values(host.publicState.cards).find((item: any) => item.zone === 'command') as any;
    const payload = { id: crypto.randomUUID(), matchId: host.publicState.id, kind: 'arrow', origin: { kind: 'card', cardId: card.id }, target: { kind: 'player', seatId: 'southWest' } };
    const revision = host.publicState.revision;
    await host.onPeerMessage({ peerUid: 'player', channel: 'room-state', message: { type: 'TARGET_SEND', payload } });
    await host.onPeerMessage({ peerUid: 'player', channel: 'room-state', message: { type: 'TARGET_SEND', payload } });
    await host.onPeerMessage({ peerUid: 'viewer', channel: 'room-state', message: { type: 'TARGET_SEND', payload: { ...payload, id: crypto.randomUUID() } } });
    await host.onPeerMessage({ peerUid: 'player', channel: 'room-state', message: { type: 'TARGET_SEND', payload: { ...payload, id: crypto.randomUUID(), matchId: 'old' } } });
    expect(hostSeen).toHaveLength(1); expect(viewerSeen).toHaveLength(1); expect(authorSeen).toHaveLength(1);
    expect(viewerSeen[0]).toMatchObject({ uid: 'player', seatId: 'northEast', origin: payload.origin, target: payload.target });
    expect(host.publicState.revision).toBe(revision);
    expect(host.transport.sendHost).toHaveBeenCalledOnce();
  });
});
