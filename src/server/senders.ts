import type { Lane, QueueItem } from './types';

/* Every sender with mail today: its configured lane, or one drawn as an email sender. */
export const senders = (lanes: Lane[], emails: QueueItem[]): Lane[] => [...new Set(emails.map((e) => e.lane))]
  .map((id) => { const l = lanes.find((x) => x.id === id); return l ? { ...l, platform: 'email' as const } : { id, name: id, platform: 'email' as const, formats: [] }; });
