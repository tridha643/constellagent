import { EventEmitter } from "node:events";
import type { EventBusController } from "@mariozechner/pi-coding-agent";

/**
 * Pi's resource loader fans out extension events (subagent/slash/prompt-template channels)
 * to many handlers on one bus. Node's default max (10) triggers MaxListenersExceededWarning
 * once a workspace loads enough extensions; raise the limit on this emitter only.
 */
export function createPiGuiEventBus(): EventBusController {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);

  return {
    emit: (channel, data) => {
      emitter.emit(channel, data);
    },
    on: (channel, handler) => {
      const safeHandler = async (data: unknown) => {
        try {
          await handler(data);
        } catch (err) {
          console.error(`Event handler error (${channel}):`, err);
        }
      };
      emitter.on(channel, safeHandler);
      return () => emitter.off(channel, safeHandler);
    },
    clear: () => {
      emitter.removeAllListeners();
    },
  };
}
