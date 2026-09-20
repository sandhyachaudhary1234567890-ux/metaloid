// Privacy-conscious internal event trail.
// Records decision types, not raw user content, speech, or secrets.

export type TrailCategory =
  | 'initiative'
  | 'tool'
  | 'verification'
  | 'retry'
  | 'failure'
  | 'rollback'
  | 'device'
  | 'voice'
  | 'memory'
  | 'interrupt';

export interface TrailEvent {
  id: string;
  at: number;
  category: TrailCategory;
  name: string;
  details: Record<string, string | number | boolean | null>;
}

const MAX_EVENTS = 400;
const REDACT = /email|token|password|secret|transcript|utterance|prompt|cookie/i;

export class EventTrail {
  private static events: TrailEvent[] = [];

  static record(category: TrailCategory, name: string, details: TrailEvent['details'] = {}): TrailEvent {
    const sanitized: TrailEvent['details'] = {};
    for (const [k, v] of Object.entries(details)) {
      if (REDACT.test(k)) {
        sanitized[k] = '[redacted]';
      } else {
        sanitized[k] = v;
      }
    }
    const event: TrailEvent = {
      id: `trail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      category,
      name,
      details: sanitized,
    };
    this.events.unshift(event);
    if (this.events.length > MAX_EVENTS) this.events.pop();
    return event;
  }

  static recent(limit = 50): TrailEvent[] {
    return this.events.slice(0, limit);
  }

  static resetForTests(): void {
    this.events = [];
  }
}
