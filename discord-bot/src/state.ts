// In-memory bot state (v1). Deliberately non-persistent — on restart the poll
// cursor resets to a short lookback and dedupe sets re-fill; a brief overlap is
// harmless because posts are keyed by id/ref. See docs/discord-integration.md §6.3.

// threadId → Sentinel ticket ref, so replies in a ticket thread map to the ticket.
const threadToRef = new Map<string, string>();
// Proposal ids already posted to the approvals channel (avoid double-posting).
const postedProposals = new Set<string>();
// Ticket refs already posted to the outbound events channels.
const postedEvents = new Set<string>();
// Outbound events poll cursor (ISO). Undefined until the first poll completes.
let eventCursor: string | undefined;

export function mapThread(threadId: string, ref: string): void {
  threadToRef.set(threadId, ref);
}
export function refForThread(threadId: string): string | undefined {
  return threadToRef.get(threadId);
}

export function markProposalPosted(id: string): boolean {
  if (postedProposals.has(id)) return false;
  postedProposals.add(id);
  return true;
}

export function markEventPosted(ref: string): boolean {
  if (postedEvents.has(ref)) return false;
  postedEvents.add(ref);
  return true;
}

export function getEventCursor(): string | undefined {
  return eventCursor;
}
export function setEventCursor(iso: string): void {
  eventCursor = iso;
}
