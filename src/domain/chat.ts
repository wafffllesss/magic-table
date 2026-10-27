import { isTableSeat } from './tablePresence';

export const CHAT_LIMIT = 100;
export const CHAT_EMOJIS = ['😀', '😂', '😍', '😮', '😢', '😎', '🤔', '👍', '👏', '🙏', '🔥', '✨', '❤️', '💚', '🎉', '👀', '💀', '⚔️', '🛡️', '🃏', '🎲', '✅', '❌', '👋'];

export type ChatMessage = { id: string; uid: string; seatId: string; text: string; at: number };

export function chatCharacters(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(part => part.segment);
  return Array.from(value);
}

export function chatText(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (!text || chatCharacters(text).length > CHAT_LIMIT || /[\u0000-\u001f\u007f]/u.test(text)) return;
  return text;
}

export function chatDuration(text: string): number { return Math.min(12_000, 4_000 + chatCharacters(text).length * 80); }

export function validChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === 'string' && /^[0-9a-f-]{36}$/i.test(message.id)
    && typeof message.uid === 'string' && message.uid.length > 0
    && isTableSeat(message.seatId) && typeof message.text === 'string' && chatText(message.text) === message.text
    && typeof message.at === 'number' && Number.isFinite(message.at);
}

export function visibleChat(messages: ChatMessage[], now: number): ChatMessage[] {
  const active = messages.filter(message => now < message.at + chatDuration(message.text));
  const counts = new Map<string, number>();
  return active.reverse().filter(message => {
    const count = counts.get(message.seatId) ?? 0;
    counts.set(message.seatId, count + 1);
    return count < 3;
  }).reverse();
}
