import { EventEmitter } from 'events';

/** Fired when recent reviews or API-key presence may have changed. */
export const sidebarBus = new EventEmitter();

export function notifySidebarChanged(): void {
  sidebarBus.emit('changed');
}
