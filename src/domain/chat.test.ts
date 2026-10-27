import { describe, expect, it } from 'vitest';
import { chatCharacters, chatDuration, chatText, visibleChat, type ChatMessage } from './chat';

describe('temporary table chat', () => {
  it('counts a combined emoji as one character and rejects text over 100', () => {
    expect(chatCharacters('👨‍👩‍👧‍👦❤️')).toHaveLength(2);
    expect(chatText('  Oi 👨‍👩‍👧‍👦  ')).toBe('Oi 👨‍👩‍👧‍👦');
    expect(chatText('a'.repeat(101))).toBeUndefined();
    expect(chatText('   ')).toBeUndefined();
    expect(chatText('Oi\nmais')).toBeUndefined();
  });

  it('keeps short text for four seconds and caps long text at twelve', () => {
    expect(chatDuration('')).toBe(4000);
    expect(chatDuration('Oi')).toBe(4160);
    expect(chatDuration('a'.repeat(100))).toBe(12000);
  });

  it('expires messages and retains the latest three per seat in arrival order', () => {
    const messages: ChatMessage[] = [0, 1, 2, 3].map(index => ({ id: String(index), uid: 'player', seatId: 'northWest', text: 'Olá', at: 1000 + index * 100 }));
    messages.push({ id: 'other', uid: 'other', seatId: 'southWest', text: 'Oi', at: 1200 });
    expect(visibleChat(messages, 1400).map(message => message.id)).toEqual(['1', '2', '3', 'other']);
    expect(visibleChat(messages, 6000)).toEqual([]);
  });
});
