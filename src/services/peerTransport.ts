import { ROOM_PACKET_BYTES, RoomPacketAssembler, decodeRoomEnvelope, roomEnvelope, splitRoomPacket } from './roomProtocol';

export type PeerSignal = { roomId: string; senderUid: string; targetUid: string; generation: number; linkId?: string; incompatible?: boolean; reconnect?: boolean; relay?: 'request' | 'ready'; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
export interface RoomSignalBus {
  send(signal: PeerSignal): Promise<void>;
  subscribe(receive: (signal: PeerSignal) => void): () => void;
}
export interface RoomDataBus {
  send(peerUid: string, generation: number, linkId: string, sequence: number, packet: string): Promise<void>;
  subscribe(peerUid: string, generation: number, linkId: string, receive: (sequence: number, packet: string) => Promise<void>): () => void;
  sendPresence(peerUid: string, generation: number, linkId: string, payload: unknown): Promise<void>;
  subscribePresence(peerUid: string, generation: number, linkId: string, receive: (payload: unknown) => void): () => void;
}
export type PeerConnectionRoute = 'direct' | 'turn' | 'firebase' | 'unknown';
type PeerLink = { peerUid: string; linkId: string; pc: RTCPeerConnection; reliable?: RTCDataChannel; ephemeral?: RTCDataChannel; assembler: RoomPacketAssembler; pendingCandidates: RTCIceCandidateInit[]; remoteReady: boolean; sequence: number; incomingSequence: number; relay?: boolean; route?: PeerConnectionRoute; routeCheck?: number; routeAttempts?: number; routeTimer?: ReturnType<typeof setTimeout>; relayUnsubscribe?: () => void; relayPresenceUnsubscribe?: () => void; signalQueue: Promise<void>; sendQueue: Promise<void>; queuedBytes: number; seenIds: Set<string> };
const NO_DATA_BUS: RoomDataBus = {
  send: async () => { throw new Error('A reserva pelo Firebase não está disponível.'); },
  subscribe: () => () => {},
  sendPresence: async () => { throw new Error('A reserva de presença não está disponível.'); },
  subscribePresence: () => () => {},
};

const ICE_SERVERS_DIRECT: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

export class PeerTransport extends EventTarget {
  private readonly peers = new Map<string, PeerLink>();
  private readonly orphanCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly signalQueues = new Map<string, Promise<void>>();
  private unsubscribeSignals?: () => void;
  private iceServers: RTCIceServer[] = ICE_SERVERS_DIRECT;
  private iceExpiresAt = 0;
  private iceLoad?: Promise<void>;
  private iceRefreshTimer?: ReturnType<typeof setTimeout>;
  private iceRetryAt = 0;
  private iceRetryDelay = 30000;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private closing = false;
  private offered = new Set<string>();
  private announced = new Set<string>();
  private fallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastPresenceAt = new Map<string, number>();
  private presenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingPresence = new Map<string, { link: PeerLink; payload: unknown }>();

  constructor(
    private readonly roomId: string,
    private readonly selfUid: string,
    private hostUid: string,
    private generation: number,
    private readonly signalBus: RoomSignalBus,
    private readonly dataBus: RoomDataBus = NO_DATA_BUS,
    private readonly loadIceServers?: () => Promise<{ iceServers: RTCIceServer[]; expiresAt: number }>,
  ) { super(); }

  async start(roster: string[]): Promise<void> {
    this.closing = false;
    this.unsubscribeSignals ??= this.signalBus.subscribe(signal => {
      const queued = this.signalQueues.get(signal.senderUid) ?? Promise.resolve();
      const next = queued.then(() => this.receiveSignal(signal)).catch(error => this.reportError(error));
      this.signalQueues.set(signal.senderUid, next);
    });
    for (const uid of roster) {
      if (this.selfUid === this.hostUid && uid !== this.selfUid && !this.announced.has(uid)) {
        this.announced.add(uid);
        try { await this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: uid, generation: this.generation, linkId: crypto.randomUUID(), reconnect: true }); }
        catch (error) { this.announced.delete(uid); this.reportError(error); }
      }
      if (uid === this.selfUid || this.selfUid === this.hostUid || uid !== this.hostUid || this.offered.has(uid)) continue;
      await this.prepareIceServers();
      this.offered.add(uid);
      await this.offer(uid);
    }
    this.emitState();
  }

  setAuthority(hostUid: string, generation: number): void {
    if (generation < this.generation) return;
    const changed = this.generation !== generation || this.hostUid !== hostUid;
    this.hostUid = hostUid;
    this.generation = generation;
    if (!changed) return;
    for (const [uid, link] of this.peers) { this.disposeLink(link); this.peers.delete(uid); }
    for (const timer of this.fallbackTimers.values()) clearTimeout(timer);
    this.fallbackTimers.clear();
    this.offered.clear();
    this.announced.clear();
    this.signalQueues.clear();
    this.orphanCandidates.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.unsubscribeSignals?.();
    this.unsubscribeSignals = undefined;
    this.dispatchEvent(new CustomEvent('authority-changed', { detail: { hostUid, generation } }));
    void this.start([hostUid]);
  }

  async sendHost<T>(type: string, payload: T, revision: number, id: string = crypto.randomUUID()): Promise<void> {
    if (this.selfUid !== this.hostUid) throw new Error('Somente o anfitrião pode enviar estado da mesa.');
    const message = roomEnvelope({ roomId: this.roomId, generation: this.generation, revision, id, senderUid: this.selfUid, type, payload });
    const packets = splitRoomPacket(message);
    await Promise.all([...this.peers.values()].filter(link => this.isConnected(link)).map(link => this.sendReliable(link, packets)));
  }

  async sendToPeer<T>(peerUid: string, type: string, payload: T, revision: number, id: string = crypto.randomUUID()): Promise<void> {
    if (this.selfUid !== this.hostUid) throw new Error('Somente o anfitrião pode enviar estado da mesa.');
    const link = this.peers.get(peerUid);
    if (!link || !this.isConnected(link)) throw new Error('A conexão com um participante não está pronta.');
    const message = roomEnvelope({ roomId: this.roomId, generation: this.generation, revision, id, senderUid: this.selfUid, type, payload });
    await this.sendReliable(link, splitRoomPacket(message));
  }

  async sendToHost<T>(type: string, payload: T, revision: number, id: string = crypto.randomUUID()): Promise<void> {
    if (this.selfUid === this.hostUid) throw new Error('O anfitrião não precisa enviar uma mensagem a si mesmo.');
    const link = this.peers.get(this.hostUid);
    if (!link || !this.isConnected(link)) throw new Error('Conectando ao anfitrião. Tente novamente em instantes.');
    const message = roomEnvelope({ roomId: this.roomId, generation: this.generation, revision, id, senderUid: this.selfUid, type, payload });
    await this.sendReliable(link, splitRoomPacket(message));
  }

  sendPresence<T>(payload: T, revision: number): void {
    const message = roomEnvelope({ roomId: this.roomId, generation: this.generation, revision, id: crypto.randomUUID(), senderUid: this.selfUid, type: 'presence', payload });
    const raw = JSON.stringify(message);
    const now = Date.now();
    const links = this.selfUid === this.hostUid ? [...this.peers.values()] : [this.peers.get(this.hostUid)].filter((link): link is PeerLink => Boolean(link));
    for (const link of links) {
      if (link.relay) {
        this.schedulePresence(link, message.payload, now);
      } else if (link.ephemeral?.readyState === 'open' && link.ephemeral.bufferedAmount < ROOM_PACKET_BYTES * 4) link.ephemeral.send(raw);
    }
  }

  relayPresence<T>(uid: string, payload: T, revision: number): void {
    if (this.selfUid !== this.hostUid || !this.peers.has(uid)) return;
    const message = roomEnvelope({ roomId: this.roomId, generation: this.generation, revision, id: crypto.randomUUID(), senderUid: this.selfUid, type: 'presence', payload: { ownerUid: uid, data: payload } });
    const raw = JSON.stringify(message);
    for (const [peerUid, link] of this.peers) if (peerUid !== uid) {
      if (link.relay) this.schedulePresence(link, { ownerUid: uid, data: payload }, Date.now());
      else if (link.ephemeral?.readyState === 'open' && link.ephemeral.bufferedAmount < ROOM_PACKET_BYTES * 4) link.ephemeral.send(raw);
    }
  }

  get connectedPeerUids(): string[] { return [...this.peers.entries()].filter(([, link]) => this.isConnected(link)).map(([uid]) => uid); }
  get relayPeerUids(): string[] { return [...this.peers.entries()].filter(([, link]) => link.relay).map(([uid]) => uid); }
  connectionRoute(uid: string): PeerConnectionRoute | undefined {
    const link = this.peers.get(uid);
    return link && this.isConnected(link) ? link.relay ? 'firebase' : link.route ?? 'unknown' : undefined;
  }

  private async updateConnectionRoute(link: PeerLink): Promise<void> {
    const check = link.routeCheck = (link.routeCheck ?? 0) + 1;
    try {
      const stats = await link.pc.getStats();
      let pair: any;
      stats.forEach(report => { if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId); });
      if (!pair) stats.forEach(report => { if (report.type === 'candidate-pair' && report.selected === true) pair = report; });
      const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
      const known = ['host', 'srflx', 'prflx', 'relay'];
      const route: PeerConnectionRoute = known.includes(local?.candidateType) && known.includes(remote?.candidateType)
        ? local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'turn' : 'direct' : 'unknown';
      if (this.peers.get(link.peerUid) !== link || link.relay || check !== link.routeCheck || !this.isConnected(link)) return;
      if (link.route !== route) { link.route = route; this.emitState(); }
      if (route === 'unknown') this.retryConnectionRoute(link);
    } catch {
      if (this.peers.get(link.peerUid) === link && !link.relay && check === link.routeCheck && this.isConnected(link) && link.route !== 'unknown') { link.route = 'unknown'; this.emitState(); }
      if (this.peers.get(link.peerUid) === link && !link.relay && check === link.routeCheck && this.isConnected(link)) this.retryConnectionRoute(link);
    }
  }
  private retryConnectionRoute(link: PeerLink): void {
    if (link.routeTimer || (link.routeAttempts ?? 0) >= 5) return;
    link.routeAttempts = (link.routeAttempts ?? 0) + 1;
    link.routeTimer = setTimeout(() => { link.routeTimer = undefined; if (this.peers.get(link.peerUid) === link && !link.relay && this.isConnected(link)) void this.updateConnectionRoute(link); }, 2000);
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.iceRefreshTimer) clearTimeout(this.iceRefreshTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.unsubscribeSignals?.();
    this.unsubscribeSignals = undefined;
    this.offered.clear();
    this.announced.clear();
    for (const timer of this.fallbackTimers.values()) clearTimeout(timer);
    this.fallbackTimers.clear();
    for (const link of this.peers.values()) this.disposeLink(link);
    this.peers.clear();
    this.orphanCandidates.clear();
    this.emitState();
  }

  private async offer(uid: string): Promise<void> {
    const link = this.createLink(uid);
    link.reliable = link.pc.createDataChannel('room-state', { ordered: true });
    link.ephemeral = link.pc.createDataChannel('table-presence', { ordered: false, maxRetransmits: 0 });
    this.bindChannel(link, link.reliable);
    this.bindChannel(link, link.ephemeral);
    const description = await link.pc.createOffer();
    if (this.peers.get(uid) !== link) return;
    await link.pc.setLocalDescription(description);
    if (this.peers.get(uid) !== link) return;
    await this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: uid, generation: this.generation, linkId: link.linkId, description });
    this.scheduleFallback(link, this.iceServers.length > 1 ? 15_000 : 8_000);
  }

  private async receiveSignal(signal: PeerSignal): Promise<void> {
    if (this.closing || signal.roomId !== this.roomId || signal.targetUid !== this.selfUid || signal.generation !== this.generation || signal.senderUid === this.selfUid) return;
    if (!signal.linkId || signal.incompatible) {
      this.reportError(new Error('Um participante está usando uma versão incompatível do Meu Magic. Atualizem o aplicativo para a mesma versão e entrem novamente.'));
      return;
    }
    if (signal.reconnect && this.selfUid !== this.hostUid && signal.senderUid === this.hostUid) {
      const old = this.peers.get(signal.senderUid);
      if (old) { this.peers.delete(signal.senderUid); this.disposeLink(old); }
      this.offered.delete(signal.senderUid);
      await this.start([signal.senderUid]);
      return;
    }
    let link = this.peers.get(signal.senderUid);
    if (link && signal.description?.type === 'offer' && this.selfUid === this.hostUid
      && (link.reliable?.readyState === 'closed' || ['closed', 'failed'].includes(link.pc.connectionState))) {
      this.peers.delete(signal.senderUid);
      this.disposeLink(link);
      link = undefined;
    }
    if (!link && signal.candidate && this.selfUid === this.hostUid) {
      const orphanKey = `${signal.senderUid}:${signal.linkId}`;
      if (!this.orphanCandidates.has(orphanKey) && this.orphanCandidates.size >= 12) return;
      const candidates = this.orphanCandidates.get(orphanKey) ?? [];
      if (candidates.length < 64) candidates.push(signal.candidate);
      this.orphanCandidates.set(orphanKey, candidates);
      return;
    }
    if (!link && signal.description?.type === 'offer' && this.selfUid === this.hostUid) {
      await this.prepareIceServers();
      link = this.createLink(signal.senderUid, signal.linkId);
      const orphanKey = `${signal.senderUid}:${signal.linkId}`;
      link.pendingCandidates.push(...(this.orphanCandidates.get(orphanKey) ?? []));
      this.orphanCandidates.delete(orphanKey);
      link.pc.ondatachannel = event => {
        if (event.channel.label === 'room-state') { link!.reliable = event.channel; this.bindChannel(link!, event.channel); }
        if (event.channel.label === 'table-presence') { link!.ephemeral = event.channel; this.bindChannel(link!, event.channel); }
      };
    }
    if (!link) return;
    if (signal.linkId !== link.linkId) return;
    try {
      if (signal.relay === 'request' && this.selfUid === this.hostUid) {
        if (link.reliable?.readyState === 'open') return;
        await this.activateRelay(link);
        await this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: signal.senderUid, generation: this.generation, linkId: link.linkId, relay: 'ready' });
        return;
      }
      if (signal.relay === 'ready' && this.selfUid !== this.hostUid) {
        if (link.reliable?.readyState !== 'open') await this.activateRelay(link);
        return;
      }
      if (signal.description) {
        await link.pc.setRemoteDescription(signal.description);
        if (this.peers.get(link.peerUid) !== link) return;
        link.remoteReady = true;
        for (const candidate of link.pendingCandidates.splice(0)) await link.pc.addIceCandidate(candidate);
        if (signal.description.type === 'offer') {
          const answer = await link.pc.createAnswer();
          await link.pc.setLocalDescription(answer);
          await this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: signal.senderUid, generation: this.generation, linkId: link.linkId, description: answer });
          this.scheduleFallback(link, this.iceServers.length > 1 ? 15_000 : 8_000);
        }
      }
      if (signal.candidate) {
        if (link.remoteReady) await link.pc.addIceCandidate(signal.candidate);
        else link.pendingCandidates.push(signal.candidate);
      }
    } catch (error) { this.dispatchEvent(new CustomEvent('error', { detail: error })); }
  }

  private createLink(uid: string, linkId: string = crypto.randomUUID()): PeerLink {
    return this.createPeerLink(uid, linkId);
  }

  private async prepareIceServers(): Promise<void> {
    if (!this.loadIceServers || Date.now() < this.iceRetryAt || Date.now() + 300_000 < this.iceExpiresAt) return;
    this.iceLoad ??= this.loadIceServers().then(({ iceServers, expiresAt }) => {
      if (this.closing) return;
      if (!Array.isArray(iceServers) || expiresAt <= Date.now()) throw new Error('Credenciais TURN inválidas.');
      this.iceServers = [...ICE_SERVERS_DIRECT, ...iceServers];
      this.iceExpiresAt = expiresAt;
      this.iceRetryAt = 0;
      this.iceRetryDelay = 30000;
      for (const link of this.peers.values()) {
        if (link.relay || link.pc.signalingState === 'closed') continue;
        link.pc.setConfiguration({ ...link.pc.getConfiguration(), iceServers: this.iceServers });
        if (this.selfUid !== this.hostUid && link.remoteReady) link.pc.restartIce();
      }
      if (this.iceRefreshTimer) clearTimeout(this.iceRefreshTimer);
      this.iceRefreshTimer = setTimeout(() => { void this.prepareIceServers(); }, Math.max(30_000, expiresAt - Date.now() - 300_000));
    }).catch(error => {
      if (this.closing) return;
      if (this.iceExpiresAt <= Date.now()) this.iceServers = ICE_SERVERS_DIRECT;
      const delay = Math.min(300000, Math.round(this.iceRetryDelay * (0.9 + Math.random() * 0.2)));
      this.iceRetryAt = Date.now() + delay;
      this.iceRetryDelay = Math.min(300000, this.iceRetryDelay * 2);
      this.reportError(error);
      if (this.iceRefreshTimer) clearTimeout(this.iceRefreshTimer);
      this.iceRefreshTimer = setTimeout(() => { void this.prepareIceServers(); }, delay);
    }).finally(() => { this.iceLoad = undefined; });
    await this.iceLoad;
  }

  private createPeerLink(uid: string, linkId: string): PeerLink {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 2,
      iceTransportPolicy: import.meta.env.DEV && import.meta.env.VITE_FORCE_TURN === 'true' ? 'relay' : 'all' });
    const link: PeerLink = { peerUid: uid, linkId, pc, assembler: new RoomPacketAssembler(), pendingCandidates: [], remoteReady: false, sequence: 0, incomingSequence: 0, signalQueue: Promise.resolve(), sendQueue: Promise.resolve(), queuedBytes: 0, seenIds: new Set() };
    this.peers.set(uid, link);
    pc.onicecandidate = event => {
      if (event.candidate && this.peers.get(uid) === link) void this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: uid, generation: this.generation, linkId, candidate: event.candidate.toJSON() }).catch(error => this.reportError(error));
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(uid) !== link) return;
      this.emitState();
      if (pc.connectionState === 'connected') void this.updateConnectionRoute(link);
      if (pc.connectionState === 'failed') this.scheduleFallback(link, 0);
    };
    pc.oniceconnectionstatechange = () => {
      if (this.peers.get(uid) !== link || link.relay) return;
      if (pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'disconnected') { link.routeCheck = (link.routeCheck ?? 0) + 1; link.routeAttempts = 0; if (link.routeTimer) clearTimeout(link.routeTimer); link.routeTimer = undefined; link.route = 'unknown'; this.emitState(); }
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') void this.updateConnectionRoute(link);
    };
    pc.ondatachannel = event => this.bindChannel(link, event.channel);
    pc.onnegotiationneeded = () => {
      if (this.peers.get(uid) === link && this.selfUid !== this.hostUid && link.remoteReady && pc.signalingState === 'stable') void this.restartOffer(uid, link);
    };
    this.emitState();
    return link;
  }

  private bindChannel(link: PeerLink, channel: RTCDataChannel): void {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      if (this.peers.get(link.peerUid) !== link) return;
      if (channel.label === 'room-state') this.clearFallback(link.peerUid);
      this.emitState();
      if (channel.label === 'room-state') void this.updateConnectionRoute(link);
      if (channel.label === 'room-state') this.dispatchEvent(new CustomEvent('peer-open', { detail: { peerUid: link.peerUid } }));
    };
    channel.onclose = () => { if (this.peers.get(link.peerUid) !== link) return; this.emitState(); if (channel.label === 'room-state') this.scheduleFallback(link, 3_000); };
    channel.onerror = () => { if (this.peers.get(link.peerUid) === link) this.dispatchEvent(new CustomEvent('error', { detail: new Error('A conexão direta foi interrompida.') })); };
    channel.onmessage = event => {
      if (this.peers.get(link.peerUid) !== link) return;
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const completed = channel.label === 'room-state' ? link.assembler.accept(raw) : raw;
        if (!completed) return;
        const message = decodeRoomEnvelope(completed, { roomId: this.roomId, generation: this.generation });
        if (message.type !== 'presence' && link.seenIds.has(message.id)) return;
        if (message.type !== 'presence') { link.seenIds.add(message.id); if (link.seenIds.size > 512) link.seenIds.delete(link.seenIds.values().next().value!); }
        if (message.type !== 'presence' && message.type !== 'TARGET_SEND' && message.type !== 'TARGET_BROADCAST') {
          const prior = (link as PeerLink & { stateRevision?: number }).stateRevision ?? -1;
          if (message.revision < prior) return;
          (link as PeerLink & { stateRevision?: number }).stateRevision = message.revision;
        }
        if (message.senderUid !== link.peerUid || this.peers.get(link.peerUid) !== link) return;
        void this.deliverMessage({ message, peerUid: link.peerUid, channel: channel.label, transport: link.relay ? 'firebase' : 'p2p' }).catch(error => this.reportError(error));
      } catch (error) { this.dispatchEvent(new CustomEvent('error', { detail: error })); }
    };
  }

  private sendReliable(link: PeerLink, packets: readonly string[]): Promise<void> {
    const bytes = packets.reduce((sum, packet) => sum + packet.length, 0);
    if (link.queuedBytes + bytes > ROOM_PACKET_BYTES * 256) return Promise.reject(new Error('A fila de sincronização excedeu o limite.'));
    link.queuedBytes += bytes;
    const next = link.sendQueue.then(() => this.sendReliableNow(link, packets));
    link.sendQueue = next.catch(() => {});
    return next.finally(() => { link.queuedBytes -= bytes; });
  }

  private async sendReliableNow(link: PeerLink, packets: readonly string[]): Promise<void> {
    if (link.relay) {
      for (const packet of packets) {
        if (this.peers.get(link.peerUid) !== link || !link.relay) throw new Error('O vínculo de sincronização foi substituído.');
        const sequence = link.sequence;
        await this.dataBus.send(link.peerUid, this.generation, link.linkId, sequence, packet);
        link.sequence = sequence + 1;
      }
      return;
    }
    const channel = link.reliable;
    if (link.relay) return this.sendReliableNow(link, packets);
    if (!channel || channel.readyState !== 'open') {
      await this.waitForRelay(link);
      return this.sendReliableNow(link, packets);
    }
    for (const packet of packets) {
      if (channel.bufferedAmount > ROOM_PACKET_BYTES * 8) {
        try { await waitForChannel(channel); }
        catch (error) {
          if (!link.relay) await this.waitForRelay(link);
          return this.sendReliableNow(link, packets);
        }
      }
      if (link.relay) return this.sendReliableNow(link, packets);
      if (channel.readyState !== 'open') {
        await this.waitForRelay(link);
        return this.sendReliableNow(link, packets);
      }
      channel.send(packet);
    }
    link.sequence++;
  }

  private scheduleFallback(link: PeerLink, delay: number): void {
    if (this.closing || this.peers.get(link.peerUid) !== link || link.relay || this.fallbackTimers.has(link.peerUid)) return;
    this.fallbackTimers.set(link.peerUid, setTimeout(() => {
      this.fallbackTimers.delete(link.peerUid);
      if (this.closing || this.peers.get(link.peerUid) !== link || link.relay) return;
      if (this.selfUid !== this.hostUid) {
        void this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: link.peerUid, generation: this.generation, linkId: link.linkId, relay: 'request' }).catch(error => this.reportError(error));
      } else if (link.reliable?.readyState !== 'open') {
        void this.activateRelay(link).then(() => this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: link.peerUid, generation: this.generation, linkId: link.linkId, relay: 'ready' })).catch(error => this.reportError(error));
      }
    }, delay));
  }

  private async activateRelay(link: PeerLink): Promise<void> {
    if (this.peers.get(link.peerUid) !== link || link.relay) return;
    if (link.routeTimer) clearTimeout(link.routeTimer);
    link.relay = true;
    link.sequence = 0;
    link.incomingSequence = 0;
    link.pc.close();
    link.reliable = undefined;
    link.ephemeral = undefined;
    link.relayUnsubscribe = this.dataBus.subscribe(link.peerUid, this.generation, link.linkId, async (sequence, packet) => {
      if (this.peers.get(link.peerUid) !== link || sequence < link.incomingSequence) return;
      if (sequence > link.incomingSequence) throw new Error('A sincronização pelo Firebase recebeu mensagens fora de ordem.');
      link.incomingSequence++;
      await this.receivePacket(link, packet, 'room-state');
    });
    link.relayPresenceUnsubscribe = this.dataBus.subscribePresence(link.peerUid, this.generation, link.linkId, payload => {
      if (this.peers.get(link.peerUid) === link) void this.receivePacket(link, JSON.stringify(roomEnvelope({ roomId: this.roomId, generation: this.generation, revision: Number((payload as any)?.sequence ?? 0), id: crypto.randomUUID(), senderUid: link.peerUid, type: 'presence', payload })), 'table-presence').catch(error => this.reportError(error));
    });
    this.clearFallback(link.peerUid);
    this.dispatchEvent(new CustomEvent('peer-open', { detail: { peerUid: link.peerUid, transport: 'firebase' } }));
    this.emitState();
  }

  private async receivePacket(link: PeerLink, raw: string, label: string): Promise<void> {
      const complete = label === 'room-state' ? link.assembler.accept(raw) : raw;
      if (!complete) return;
      const message = decodeRoomEnvelope(complete, { roomId: this.roomId, generation: this.generation });
      if (message.type !== 'presence' && link.seenIds.has(message.id)) return;
      if (message.type !== 'presence') { link.seenIds.add(message.id); if (link.seenIds.size > 512) link.seenIds.delete(link.seenIds.values().next().value!); }
      if (message.senderUid === link.peerUid && this.peers.get(link.peerUid) === link) {
        await this.deliverMessage({ message, peerUid: link.peerUid, channel: label, transport: link.relay ? 'firebase' : 'p2p' });
      }
  }

  private async deliverMessage(detail: Record<string, unknown>): Promise<void> {
    const completions: Promise<void>[] = [];
    this.dispatchEvent(new CustomEvent('message', { detail: { ...detail, waitUntil: (completion: Promise<void>) => completions.push(completion) } }));
    await Promise.all(completions);
  }

  private isConnected(link: PeerLink): boolean { return link.relay || link.reliable?.readyState === 'open'; }
  private waitForRelay(link: PeerLink): Promise<void> {
    if (link.relay) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.removeEventListener('peer-open', opened);
        if (error) reject(error); else resolve();
      };
      const opened = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.peerUid === link.peerUid && detail?.transport === 'firebase') finish();
      };
      const timer = setTimeout(() => finish(new Error('A conexão de reserva demorou para responder.')), 12_000);
      this.addEventListener('peer-open', opened);
      if (this.peers.get(link.peerUid) !== link) finish(new Error('O vínculo com o participante foi substituído.'));
    });
  }
  private clearFallback(uid: string): void {
    const timer = this.fallbackTimers.get(uid);
    if (timer) clearTimeout(timer);
    this.fallbackTimers.delete(uid);
  }
  private reportError(error: unknown): void {
    this.dispatchEvent(new CustomEvent('error', { detail: error instanceof Error ? error : new Error('Falha na conexão com a sala.') }));
  }
  private disposeLink(link: PeerLink): void {
    if (link.routeTimer) clearTimeout(link.routeTimer);
    this.clearFallback(link.peerUid);
    const presenceTimer = this.presenceTimers.get(link.peerUid);
    if (presenceTimer) clearTimeout(presenceTimer);
    this.presenceTimers.delete(link.peerUid);
    this.pendingPresence.delete(link.peerUid);
    this.lastPresenceAt.delete(link.peerUid);
    link.relayUnsubscribe?.();
    link.relayPresenceUnsubscribe?.();
    link.pc.close();
  }
  private schedulePresence(link: PeerLink, payload: unknown, now: number): void {
    this.pendingPresence.set(link.peerUid, { link, payload });
    if (this.presenceTimers.has(link.peerUid)) return;
    const delay = Math.max(0, 500 - (now - (this.lastPresenceAt.get(link.peerUid) ?? 0)));
    this.presenceTimers.set(link.peerUid, setTimeout(() => {
      this.presenceTimers.delete(link.peerUid);
      const pending = this.pendingPresence.get(link.peerUid);
      this.pendingPresence.delete(link.peerUid);
      if (!pending || this.closing || this.peers.get(link.peerUid) !== pending.link || !pending.link.relay) return;
      this.lastPresenceAt.set(link.peerUid, Date.now());
      void this.dataBus.sendPresence(link.peerUid, this.generation, link.linkId, pending.payload).catch(error => this.reportError(error));
    }, delay));
  }

  private async restartOffer(uid: string, link: PeerLink): Promise<void> {
    try {
      const description = await link.pc.createOffer({ iceRestart: true });
      if (this.peers.get(uid) !== link) return;
      await link.pc.setLocalDescription(description);
      if (this.peers.get(uid) !== link) return;
      await this.signalBus.send({ roomId: this.roomId, senderUid: this.selfUid, targetUid: uid, generation: this.generation, linkId: link.linkId, description });
    } catch (error) { this.dispatchEvent(new CustomEvent('error', { detail: error })); }
  }

  private emitState(): void {
    const open = [...this.peers.values()].filter(link => this.isConnected(link)).length;
    const pending = this.peers.size > 0 && open < this.peers.size;
    if (!pending && this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    if (pending && !this.retryTimer) this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if ([...this.peers.values()].some(link => !this.isConnected(link))) {
        this.dispatchEvent(new CustomEvent('error', { detail: new Error('Não foi possível conectar pela internet. Verifique a conexão com o Firebase e tente novamente.') }));
      }
    }, 20_000);
    const connecting = [...this.peers.values()].some(link => !this.isConnected(link) && (link.pc.connectionState === 'connecting' || link.pc.connectionState === 'new'));
    this.dispatchEvent(new CustomEvent('connection-state', { detail: { open, total: this.peers.size, connecting, relay: this.relayPeerUids, state: connecting ? 'connecting' : open ? 'connected' : 'disconnected' } }));
  }
}

/** Whichever condition wins releases both listeners and the deadline. */
export function waitForChannel(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener('bufferedamountlow', drained);
      channel.removeEventListener('close', closed);
      if (error) reject(error); else resolve();
    };
    const drained = () => finish();
    const closed = () => finish(new Error('A conexão caiu durante a sincronização.'));
    const timer = setTimeout(() => finish(new Error('A mesa está demorando para sincronizar.')), 15_000);
    channel.bufferedAmountLowThreshold = ROOM_PACKET_BYTES * 2;
    channel.addEventListener('bufferedamountlow', drained);
    channel.addEventListener('close', closed);
    if (channel.readyState !== 'open') closed();
    else if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) drained();
  });
}
