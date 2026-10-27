import type { MatchState } from '../domain/game';

export const ROOM_PROTOCOL_VERSION = 2;
export const ROOM_PACKET_BYTES = 16 * 1024;
export const ROOM_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

export type PublicMatchState = ReturnType<typeof import('../domain/game').publicProjection>;
export type SeatPrivateState = {
  matchId: string;
  seatId: string;
  hand: string[];
  library: string[];
  privateCards: MatchState['cards'];
  mulligans: number;
  keptHand: boolean;
};
export type RoomEnvelope<T = unknown> = {
  version: typeof ROOM_PROTOCOL_VERSION;
  roomId: string;
  generation: number;
  revision: number;
  id: string;
  senderUid: string;
  type: string;
  payload: T;
};

export function roomEnvelope<T>(input: Omit<RoomEnvelope<T>, 'version'>): RoomEnvelope<T> {
  return { ...input, version: ROOM_PROTOCOL_VERSION };
}

export function encodeRoomEnvelope(message: RoomEnvelope): string {
  const encoded = JSON.stringify(message);
  if (new TextEncoder().encode(encoded).byteLength > ROOM_MAX_SNAPSHOT_BYTES) throw new Error('A sincronização excedeu o limite de dados da mesa.');
  return encoded;
}

export function decodeRoomEnvelope(raw: string, expected: { roomId: string; generation: number }): RoomEnvelope {
  if (new TextEncoder().encode(raw).byteLength > ROOM_MAX_SNAPSHOT_BYTES) throw new Error('Mensagem da mesa excede o limite permitido.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Mensagem da mesa inválida.');
  const message = value as Partial<RoomEnvelope>;
  if (message.version !== ROOM_PROTOCOL_VERSION || message.roomId !== expected.roomId || message.generation !== expected.generation ||
      !Number.isSafeInteger(message.revision) || (message.revision ?? -1) < 0 || typeof message.id !== 'string' || message.id.length > 128 ||
      typeof message.senderUid !== 'string' || message.senderUid.length > 128 || typeof message.type !== 'string' || message.type.length > 40 || !('payload' in message)) {
    throw new Error('Versão, origem ou revisão da mensagem não correspondem à mesa.');
  }
  return message as RoomEnvelope;
}

export function splitRoomPacket(message: RoomEnvelope, maxBytes = ROOM_PACKET_BYTES): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error('Tamanho de bloco inválido.');
  const encoded = encodeRoomEnvelope(message);
  const bytes = new TextEncoder().encode(encoded);
  const directPacket = JSON.stringify({ kind: 'packet', body: encoded });
  if (new TextEncoder().encode(directPacket).byteLength <= maxBytes) return [directPacket];
  const payloadBytes = Math.floor((maxBytes - 256) * 0.75);
  const total = Math.ceil(bytes.length / payloadBytes);
  const transferId = message.id;
  return Array.from({ length: total }, (_, index) => {
    const part = bytes.subarray(index * payloadBytes, (index + 1) * payloadBytes);
    let binary = '';
    for (let offset = 0; offset < part.length; offset += 0x8000) binary += String.fromCharCode(...part.subarray(offset, offset + 0x8000));
    return JSON.stringify({ kind: 'chunk', transferId, index, total, body: btoa(binary) });
  });
}

export class RoomPacketAssembler {
  private readonly transfers = new Map<string, { total: number; parts: Uint8Array[]; bytes: number }>();

  accept(raw: string): string | undefined {
    if (new TextEncoder().encode(raw).byteLength > ROOM_PACKET_BYTES * 2) throw new Error('Bloco de sincronização grande demais.');
    const packet = JSON.parse(raw) as { kind?: string; body?: string; transferId?: string; index?: number; total?: number };
    if (packet.kind === 'packet' && typeof packet.body === 'string') return packet.body;
  if (packet.kind !== 'chunk' || typeof packet.transferId !== 'string' || !Number.isInteger(packet.index) || !Number.isInteger(packet.total) || typeof packet.body !== 'string') throw new Error('Bloco de sincronização inválido.');
    const body = (packet as unknown as { body: string }).body;
    if (packet.total! < 2 || packet.total! > 256 || packet.index! < 0 || packet.index! >= packet.total! || typeof body !== 'string' || body.length > ROOM_PACKET_BYTES * 2) throw new Error('Bloco de sincronização fora dos limites.');
    const transfer = this.transfers.get(packet.transferId) ?? { total: packet.total!, parts: new Array(packet.total!), bytes: 0 };
    if (packet.total! > 512) throw new Error('A sincronização contém blocos demais.');
    if (transfer.total !== packet.total) { this.transfers.delete(packet.transferId); throw new Error('A quantidade de blocos mudou durante a sincronização.'); }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body)) throw new Error('Bloco de sincronização inválido.');
    const binary = atob(body);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (!transfer.parts[packet.index!]) { transfer.parts[packet.index!] = bytes; transfer.bytes += bytes.length; }
    if (transfer.bytes > ROOM_MAX_SNAPSHOT_BYTES) { this.transfers.delete(packet.transferId); throw new Error('A sincronização excedeu o limite de dados da mesa.'); }
    this.transfers.set(packet.transferId, transfer);
    if (transfer.parts.filter(Boolean).length !== transfer.total) return undefined;
    this.transfers.delete(packet.transferId);
    const joined = new Uint8Array(transfer.bytes);
    let offset = 0;
    for (const part of transfer.parts) { joined.set(part!, offset); offset += part!.length; }
    return new TextDecoder().decode(joined);
  }
}

export function publicCardIdsAreOpaque(state: PublicMatchState): boolean {
  return Object.entries(state.cards).every(([instanceId, card]) => (card.card?.type_line?.includes('Token') || !instanceId.includes(card.cardId)) && !instanceId.includes(card.ownerId));
}
