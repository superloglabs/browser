import type { Client } from "./client.js";

// The running client, kept apart from init so the capture functions stay
// small: an application can import them eagerly and load init in a chunk of
// its own.
let current: Client | null = null;

export function currentClient(): Client | null {
  return current;
}

export function setCurrentClient(client: Client | null): void {
  current = client;
}
