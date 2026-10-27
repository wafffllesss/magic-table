import { describe, expect, it } from 'vitest';
import { RoomPacketAssembler, decodeRoomEnvelope, roomEnvelope, splitRoomPacket } from './roomProtocol';

describe('room protocol packets', () => {
  it('encodes and decodes envelopes bound to the room generation', () => {
    const message = roomEnvelope({ roomId: 'room-12345678', generation: 4, revision: 9, id: 'command-1', senderUid: 'user-1', type: 'ACK', payload: { ok: true } });
    expect(decodeRoomEnvelope(JSON.stringify(message), { roomId: message.roomId, generation: 4 })).toEqual(message);
    expect(() => decodeRoomEnvelope(JSON.stringify(message), { roomId: message.roomId, generation: 5 })).toThrow();
  });

  it('reassembles snapshots split into 16 KiB data-channel blocks', () => {
    const payload = { value: 'x'.repeat(90_000) };
    const message = roomEnvelope({ roomId: 'room-12345678', generation: 1, revision: 3, id: 'snapshot-1', senderUid: 'host', type: 'SNAPSHOT', payload });
    const chunks = splitRoomPacket(message);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => new TextEncoder().encode(chunk).byteLength <= 16 * 1024)).toBe(true);
    const assembler = new RoomPacketAssembler();
    let result: string | undefined;
    for (const chunk of chunks) result = assembler.accept(chunk) ?? result;
    expect(JSON.parse(result!).payload).toEqual(payload);
  });

  it('rejects malformed chunks before decoding them', () => {
    expect(() => new RoomPacketAssembler().accept(JSON.stringify({ kind: 'chunk', transferId: 'x', index: 0, total: 2, body: 'invalid' }))).toThrow();
  });
});
