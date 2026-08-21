// Relay helper: pushes events to the browser clients via the bot-relay
// socket.io mini-service (port 3003) over its internal HTTP broadcast endpoint.

const RELAY_URL = process.env.BOT_RELAY_URL || 'http://localhost:3003/internal/broadcast';

export async function broadcast(event: string, payload: unknown): Promise<void> {
  try {
    await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, payload }),
    });
  } catch (err) {
    console.error('[relay] broadcast failed (is bot-relay running on 3003?):', err);
  }
}
