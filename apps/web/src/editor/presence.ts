import { useEffect, useState } from 'react';
import type { Point } from '@cld/model';
import type { Session } from './session';
import type { Gesture } from './store';

export interface Presence {
  user: { id: string; name: string; color: string; guest?: boolean };
  diagramId: string | null;
  cursor: Point | null;
  selection: string[];
  /** Live manipulation (move/resize/curve/link draft) so others see objects move in real time. */
  gesture: Gesture | null;
  /** Visible world rectangle (for follow mode). */
  viewport: { x: number; y: number; w: number; h: number } | null;
  editing: string | null;
}

export interface Peer extends Presence {
  clientId: number;
}

const THROTTLE_MS = 50;

/** Throttled awareness publisher (leading + trailing). */
export function createPresencePublisher(session: Session) {
  let pending: Partial<Presence> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = 0;
  const flush = () => {
    timer = null;
    last = Date.now();
    const aw = session.provider.awareness;
    if (!aw) return;
    aw.setLocalState({ ...(aw.getLocalState() ?? {}), ...pending });
    pending = {};
  };
  return (patch: Partial<Presence>, immediate = false) => {
    pending = { ...pending, ...patch };
    if (immediate) {
      if (timer) clearTimeout(timer);
      flush();
      return;
    }
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - last));
    timer = setTimeout(flush, wait);
  };
}

/** Other connected users (one entry per browser tab), re-rendered at most once per frame. */
export function usePeers(session: Session): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([]);
  useEffect(() => {
    const aw = session.provider.awareness;
    if (!aw) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const list: Peer[] = [];
      aw.getStates().forEach((state, clientId) => {
        if (clientId === aw.clientID || !state.user) return;
        list.push({ ...(state as Presence), clientId });
      });
      setPeers(list);
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    aw.on('change', onChange);
    update();
    return () => {
      aw.off('change', onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [session]);
  return peers;
}

/** Unique users (a person with two tabs shows once). */
export function uniqueUsers(peers: Peer[]): Peer[] {
  const seen = new Map<string, Peer>();
  for (const p of peers) if (!seen.has(p.user.id)) seen.set(p.user.id, p);
  return [...seen.values()];
}
