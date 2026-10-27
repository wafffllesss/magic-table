import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerTransport, waitForChannel } from './peerTransport';
import * as protocol from './roomProtocol';

class Channel extends EventTarget {
  readyState = 'open';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  onopen?: () => void;
  send = vi.fn();
  constructor(readonly label = 'room-state') { super(); }
}
function transport(): any {
  return new PeerTransport('room', 'host', 'host', 1, { send: async () => {}, subscribe: () => () => {} });
}
afterEach(() => vi.useRealTimers());

describe('peer delivery', () => {
  it('requests a fresh offer when the host starts again', async () => {
    const host = transport();
    const send = vi.fn(async () => {});
    host.signalBus = { send, subscribe: () => () => {} };
    await host.start(['host', 'guest']);
    await host.start(['host', 'guest']);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ targetUid: 'guest', reconnect: true }));

    const guest = transport(); guest.selfUid = 'guest';
    const old = { pc: { close: vi.fn() } };
    guest.peers.set('host', old);
    guest.offered.add('host');
    const start = vi.spyOn(guest, 'start').mockResolvedValue(undefined);
    await guest.receiveSignal({ roomId: 'room', senderUid: 'host', targetUid: 'guest', generation: 1, linkId: 'new-host', reconnect: true });
    expect(old.pc.close).toHaveBeenCalledOnce();
    expect(guest.offered.has('host')).toBe(false);
    expect(start).toHaveBeenCalledWith(['host']);
    await host.close();
  });

  it('caches temporary TURN credentials and keeps STUN when issuance fails', async () => {
    const load = vi.fn().mockResolvedValueOnce({
      iceServers: [{ urls: 'turn:turn.example.org:3478', username: 'user', credential: 'token' }],
      expiresAt: Date.now() + 3_600_000,
    }).mockRejectedValueOnce(new Error('TURN indisponível'));
    const t: any = new PeerTransport('room', 'guest', 'host', 1,
      { send: async () => {}, subscribe: () => () => {} }, undefined, load);
    await t.prepareIceServers();
    await t.prepareIceServers();
    expect(load).toHaveBeenCalledTimes(1);
    expect(t.iceServers).toEqual([
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'turn:turn.example.org:3478', username: 'user', credential: 'token' },
    ]);
    t.iceExpiresAt = 0;
    const errors: string[] = [];
    t.addEventListener('error', (event: CustomEvent) => errors.push(event.detail.message));
    await t.prepareIceServers();
    expect(t.iceServers).toEqual([{ urls: 'stun:stun.cloudflare.com:3478' }]);
    expect(errors).toEqual(['TURN indisponível']);
    await t.close();
  });

  it('requests Firebase fallback after a failed direct link and cancels the timer on close', async () => {
    vi.useFakeTimers();
    const t = transport(); t.selfUid = 'guest';
    const send = vi.fn(async () => {});
    t.signalBus = { send, subscribe: () => () => {} };
    const link = { peerUid: 'host', linkId: 'link-a', reliable: { readyState: 'closed' }, pc: { close: vi.fn() } };
    t.peers.set('host', link);
    t.scheduleFallback(link, 500); t.scheduleFallback(link, 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ relay: 'request', linkId: 'link-a' }));
    t.scheduleFallback(link, 500);
    await t.close();
    await vi.advanceTimersByTimeAsync(500);
    expect(send).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('explains when a room member sends a legacy negotiation signal', async () => {
    const t: any = transport(); t.selfUid = 'guest';
    const error = vi.fn();
    t.addEventListener('error', (event: CustomEvent) => error(event.detail));
    await t.receiveSignal({ roomId: 'room', senderUid: 'host', targetUid: 'guest', generation: 1, description: { type: 'offer', sdp: 'redacted' } });
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0].message).toContain('versão incompatível');
  });

  it('serializes a broadcast once and targets a checkpoint to only one peer', async () => {
    const t = transport(), channels = ['a', 'b', 'c'].map(() => new Channel());
    channels.forEach((channel, i) => t.peers.set(['a','b','c'][i], { peerUid: ['a','b','c'][i], reliable: channel, sequence: 0, sendQueue: Promise.resolve(), queuedBytes: 0 }));
    const split = vi.spyOn(protocol, 'splitRoomPacket');
    await t.sendHost('COMMIT', { data: 'x'.repeat(80_000) }, 1, 'commit');
    expect(split).toHaveBeenCalledTimes(1);
    expect(channels[0].send.mock.calls).toEqual(channels[1].send.mock.calls);
    channels.forEach(channel => channel.send.mockClear());
    await t.sendToPeer('b', 'SNAPSHOT', {}, 1);
    expect(channels[0].send).not.toHaveBeenCalled();
    expect(channels[1].send).toHaveBeenCalledOnce();
    expect(channels[2].send).not.toHaveBeenCalled();
  });

  it('sends the same chat bubble to direct and Firebase relay participants', async () => {
    const t = transport(), channel = new Channel();
    const relay = vi.fn(async (..._args: unknown[]) => {});
    t.dataBus = { send: relay };
    t.peers.set('direct', { peerUid: 'direct', reliable: channel, sequence: 0, sendQueue: Promise.resolve(), queuedBytes: 0 });
    t.peers.set('viewer', { peerUid: 'viewer', linkId: 'relay-link', relay: true, sequence: 0, sendQueue: Promise.resolve(), queuedBytes: 0 });
    const chat = { id: crypto.randomUUID(), uid: 'host', seatId: 'southWest', text: 'Oi 🃏', at: Date.now() };
    await t.sendHost('CHAT_BROADCAST', chat, 0, chat.id);
    expect(channel.send).toHaveBeenCalledOnce();
    expect(relay).toHaveBeenCalledOnce();
    const directPacket = JSON.parse(channel.send.mock.calls[0][0]);
    const relayPacket = JSON.parse(relay.mock.calls[0][4] as string);
    expect(JSON.parse(directPacket.body)).toMatchObject({ type: 'CHAT_BROADCAST', payload: chat });
    expect(relayPacket).toEqual(directPacket);
  });

  it('sends reliable relay packets in order and rejects an unbounded queue', async () => {
    const t = transport();
    const sent: number[] = [];
    t.dataBus = {
      send: async (_peer: string, _generation: number, _link: string, sequence: number) => { sent.push(sequence); },
      subscribe: () => () => {}, sendPresence: async () => {}, subscribePresence: () => () => {},
    };
    const link = { peerUid: 'peer', linkId: 'link-a', relay: true, sequence: 0, sendQueue: Promise.resolve(), queuedBytes: 0, reliable: undefined };
    t.peers.set('peer', link);
    await Promise.all([
      t.sendToPeer('peer', 'COMMIT', { action: 1 }, 1, 'one'),
      t.sendToPeer('peer', 'COMMIT', { action: 2 }, 2, 'two'),
    ]);
    expect(sent).toEqual([0, 1]);
  });

  it('keeps relay messages in the inbox until the room handler finishes', async () => {
    let receivePacket!: (sequence: number, packet: string) => Promise<void>;
    const dataBus = {
      send: async () => {},
      subscribe: (_peer: string, _generation: number, _link: string, receive: typeof receivePacket) => { receivePacket = receive; return () => {}; },
      sendPresence: async () => {}, subscribePresence: () => () => {},
    };
    const t: any = new PeerTransport('room', 'guest', 'host', 1, { send: async () => {}, subscribe: () => () => {} }, dataBus);
    const link: any = { peerUid: 'host', linkId: 'link-a', pc: { close: vi.fn() }, assembler: new protocol.RoomPacketAssembler(), sequence: 0,
      incomingSequence: 0, seenIds: new Set<string>(), relay: false, signalQueue: Promise.resolve(), sendQueue: Promise.resolve(), queuedBytes: 0 };
    t.peers.set('host', link);
    const releases: Array<() => void> = [];
    t.addEventListener('message', (event: CustomEvent) => {
      (event as CustomEvent).detail.waitUntil(new Promise<void>(resolve => { releases.push(resolve); }));
    });
    await t.activateRelay(link);
    const message = protocol.roomEnvelope({ roomId: 'room', generation: 1, revision: 1, id: 'one', senderUid: 'host', type: 'COMMIT', payload: {} });
    const delivery = receivePacket(0, protocol.splitRoomPacket(message)[0]).then(() => 'ack');
    await Promise.resolve();
    const second = protocol.roomEnvelope({ roomId: 'room', generation: 1, revision: 2, id: 'two', senderUid: 'host', type: 'COMMIT', payload: {} });
    const followingDelivery = receivePacket(1, protocol.splitRoomPacket(second)[0]).then(() => 'ack');
    await Promise.resolve();
    expect(releases).toHaveLength(2);
    releases.forEach(release => release());
    await expect(delivery).resolves.toBe('ack');
    await expect(followingDelivery).resolves.toBe('ack');
    await t.close();
  });

  it('announces only the reliable channel opening with its peer identity', () => {
    const t = transport(), opened = vi.fn();
    t.addEventListener('peer-open', opened);
    const link = { peerUid: 'peer', pc: { connectionState: 'connected' } };
    const ephemeral = new Channel('table-presence'), reliable = new Channel();
    t.peers.set('peer', link);
    t.bindChannel(link, ephemeral); t.bindChannel(link, reliable);
    ephemeral.onopen!();
    expect(opened).not.toHaveBeenCalled();
    reliable.onopen!();
    expect(opened.mock.calls[0][0].detail).toEqual({ peerUid: 'peer' });
  });
});

describe('data channel backpressure cleanup', () => {
  for (const outcome of ['drain', 'close', 'timeout'] as const) {
    it('removes both listeners and the timer after ' + outcome, async () => {
      vi.useFakeTimers();
      const channel = new Channel(); channel.bufferedAmount = 200_000;
      const result = waitForChannel(channel as unknown as RTCDataChannel).then(() => 'ok', () => 'error');
      if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
      else channel.dispatchEvent(new Event(outcome === 'drain' ? 'bufferedamountlow' : 'close'));
      expect(await result).toBe(outcome === 'drain' ? 'ok' : 'error');
      expect(getEventListeners(channel, 'close')).toHaveLength(0);
      expect(getEventListeners(channel, 'bufferedamountlow')).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});

describe('target transport', () => {
  it('delivers target broadcasts via direct and relay connections', async () => {
    const t = transport(), channel = new Channel();
    const relay = vi.fn(async (..._args: unknown[]) => {}); t.dataBus = { send: relay };
    t.peers.set('direct', { peerUid: 'direct', reliable: channel, sequence: 0, sendQueue: Promise.resolve(), queuedBytes: 0 });
    t.peers.set('viewer', { peerUid: 'viewer', linkId: 'relay-link', relay: true, sequence: 0, sendQueue: Promise.resolve(), queuedBytes: 0 });
    const mark = { id: crypto.randomUUID(), kind: 'highlight', matchId: 'match', target: { kind: 'player', seatId: 'southWest' } };
    await t.sendHost('TARGET_BROADCAST', mark, 1, mark.id);
    const directPacket = JSON.parse(channel.send.mock.calls[0][0]);
    const relayPacket = JSON.parse(relay.mock.calls[0][4] as string);
    expect(JSON.parse(directPacket.body)).toMatchObject({ type: 'TARGET_BROADCAST', payload: mark });
    expect(relayPacket).toEqual(directPacket);
  });
  it('does not reject a target just because a newer game revision arrived', async () => {
    const t = transport(), channel = new Channel(), received: string[] = [];
    const link = { peerUid: 'peer', pc: { connectionState: 'connected' }, assembler: new protocol.RoomPacketAssembler(), seenIds: new Set<string>() };
    t.peers.set('peer', link); t.bindChannel(link, channel);
    t.addEventListener('message', (event: CustomEvent) => received.push(event.detail.message.type));
    const packet = (type: string, revision: number, id: string) => protocol.splitRoomPacket(protocol.roomEnvelope({ roomId: 'room', generation: 1, revision, id, senderUid: 'peer', type, payload: {} }))[0];
    (channel as any).onmessage({ data: packet('COMMIT', 5, 'new') });
    (channel as any).onmessage({ data: packet('TARGET_SEND', 4, 'target') });
    (channel as any).onmessage({ data: packet('COMMIT', 4, 'old') });
    await Promise.resolve();
    expect(received).toEqual(['COMMIT', 'TARGET_SEND']);
  });
});
