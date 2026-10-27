import type { RoomSnapshot } from './firebaseRoom';
import { indicatedSeat } from '../domain/tableInteraction';

export type SystemEvent = { type: 'joined' | 'disconnected' | 'reconnected'; name: string } | { type: 'started' | 'turn' | 'priority' };
type Person = { uid: string; name: string; online: boolean };

/** Tracks every snapshot, including while focused, so old events are never replayed. */
export class RoomNotificationTracker {
  private roomId?: string;
  private people?: Map<string, Person>;
  private match?: { id: string; phase: string; turn: number; active: string; priority?: string };
  private matchBaseline = false;
  private connected = false;
  private presenceOnline = false;

  reset(): void { this.roomId = undefined; this.people = undefined; this.match = undefined; this.matchBaseline = false; this.connected = false; this.presenceOnline = false; }

  update(snapshot: RoomSnapshot): SystemEvent[] {
    if (!snapshot.roomId) { this.reset(); return []; }
    if (this.roomId !== snapshot.roomId) { this.reset(); this.roomId = snapshot.roomId; }
    const events: SystemEvent[] = [];
    const stable = snapshot.connectionState === 'connected';
    if (snapshot.membersReady) {
      const people = new Map<string, Person>();
      for (const person of [...Object.values(snapshot.seats), ...snapshot.queue]) {
        if (person && person.uid !== snapshot.selfUid) people.set(person.uid, { uid: person.uid, name: person.name, online: person.online });
      }
      if (this.people && snapshot.online && this.presenceOnline) {
        for (const person of people.values()) {
          const previous = this.people.get(person.uid);
          if (!previous) events.push({ type: 'joined', name: person.name });
          else if (previous.online !== person.online) events.push({ type: person.online ? 'reconnected' : 'disconnected', name: person.name });
        }
      }
      this.people = people;
    }
    this.presenceOnline = snapshot.online;
    const state = snapshot.state;
    const self = snapshot.selfSeatId;
    const current = state ? { id: state.id, phase: state.phase, turn: state.turn, active: state.activeSeatId,
      priority: state.phase === 'playing' && !state.paused && state.stack.length && self && indicatedSeat(state) === self ? self : undefined } : undefined;
    if (this.matchBaseline && stable && this.connected && current) {
      const previous = this.match;
      const newMatch = !previous || previous.id !== current.id;
      if (newMatch && current.phase === 'mulligan') events.push({ type: 'started' });
      if (self && current.phase === 'playing' && current.active === self && (!previous || previous.id !== current.id || previous.phase !== 'playing' || previous.active !== self || previous.turn !== current.turn)) events.push({ type: 'turn' });
      if (current.priority && (!previous || previous.id !== current.id || previous.priority !== current.priority)) events.push({ type: 'priority' });
    }
    if (stable) this.matchBaseline = true;
    this.match = current;
    this.connected = stable;
    return events;
  }
}

export function showSystemNotification(title: string, body: string): void {
  if (window.meuMagicDesktop) {
    void window.meuMagicDesktop.showNotification(title, body).catch(() => {});
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted' || (document.visibilityState === 'visible' && document.hasFocus())) return;
  try {
    const notification = new Notification(title, { body });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch { /* Notifications may be disabled by the browser or operating system. */ }
}
