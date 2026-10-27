import type { CardDefinition, CardInstance, MatchState } from './game';

export type HistoryOperation = 'UNDO' | 'REDO';

type Definition = { value: CardDefinition };
type Snapshot = {
  state: Omit<MatchState, 'cards'> & { cards: Record<string, Omit<CardInstance, 'card'>> };
  definitions: Map<string, Definition>;
};
type Entry = { before: Snapshot; after: Snapshot };

/** Only mutable match data is duplicated. Definitions belong to this history, never to live state. */
export class MatchHistory {
  private undo: Entry[] = [];
  private redo: Entry[] = [];
  private definitions = new Map<string, Definition>();
  private revision?: number;
  private matchId?: string;

  get size(): number { return this.undo.length + this.redo.length; }
  get definitionCount(): number { return this.definitions.size; }

  clear(): void {
    this.undo = []; this.redo = []; this.definitions.clear(); this.revision = undefined; this.matchId = undefined;
  }

  record(before: MatchState, after: MatchState): void {
    if (this.matchId !== undefined && this.matchId !== before.id || this.revision !== undefined && this.revision !== before.revision) this.clear();
    this.undo.push({ before: this.capture(before), after: this.capture(after) });
    this.redo = [];
    if (this.undo.length > 10) this.undo.shift();
    this.revision = after.revision;
    this.matchId = after.id;
    this.pruneDefinitions();
  }

  target(redo: boolean, revision: number): MatchState | undefined {
    if (revision !== this.revision) { this.clear(); return; }
    const entry = (redo ? this.redo : this.undo).at(-1);
    if (!entry) return;
    const snapshot = redo ? entry.after : entry.before;
    const state = structuredClone(snapshot.state) as MatchState;
    // Clone the catalog in one operation, retaining sharing within this restored state only.
    const restored = structuredClone(snapshot.definitions);
    for (const [id, definition] of restored) state.cards[id].card = definition.value;
    return state;
  }

  restored(redo: boolean, revision: number): void {
    const entry = (redo ? this.redo : this.undo).pop();
    if (!entry) return;
    (redo ? this.undo : this.redo).push(entry);
    this.revision = revision;
  }

  private capture(state: MatchState): Snapshot {
    const { cards, ...rest } = state;
    const mutable: Snapshot['state']['cards'] = {};
    const definitions = new Map<string, Definition>();
    for (const [id, instance] of Object.entries(cards)) {
      const { card, ...data } = instance;
      mutable[id] = data;
      if (card) {
        const key = JSON.stringify(card);
        let definition = this.definitions.get(key);
        if (!definition) {
          definition = { value: freezeDefinition(structuredClone(card)) };
          this.definitions.set(key, definition);
        }
        definitions.set(id, definition);
      }
    }
    return { state: structuredClone({ ...rest, cards: mutable }), definitions };
  }

  private pruneDefinitions(): void {
    const referenced = new Set(this.undo.concat(this.redo).flatMap(entry =>
      [...entry.before.definitions.values(), ...entry.after.definitions.values()]));
    for (const [key, value] of this.definitions) if (!referenced.has(value)) this.definitions.delete(key);
  }
}

function freezeDefinition<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDefinition);
    Object.freeze(value);
  }
  return value;
}

export function canRestoreHistory(current: MatchState, expectedRevision: number, actorId: string): boolean {
  return current.revision === expectedRevision && current.log.at(-1)?.actorId === actorId;
}

export function restoreHistorySnapshot(snapshot: MatchState, current: MatchState, actorId: string, operation: HistoryOperation, actionId: string, now = Date.now()): MatchState {
  const restored = structuredClone(snapshot);
  const revision = current.revision + 1;
  const sourceMessage = (operation === 'REDO' ? snapshot.log.at(-1) : current.log.at(-1))?.message;
  const sourceEvent = (operation === 'REDO' ? snapshot.log.at(-1) : current.log.at(-1))?.event;
  const verb = operation === 'REDO' ? 'Refez' : 'Desfez';
  restored.revision = revision;
  restored.updatedAt = now;
  restored.lastActionId = actionId;
  restored.log = [...restored.log, {
    id: `${restored.id}-${revision}`,
    actorId,
    message: sourceMessage ? `${verb}: ${sourceMessage}.` : `${verb} a última ação.`,
    event: { key: operation === 'REDO' ? 'gameLog.redo' : 'gameLog.undo', ...(sourceEvent ? { source: sourceEvent } : { params: { source: sourceMessage ?? 'a última ação' } }) },
    at: now,
    public: true,
  }].slice(-160);
  return restored;
}
