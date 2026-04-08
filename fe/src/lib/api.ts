import { fetchEventSource } from '@microsoft/fetch-event-source';

const API_BASE = 'http://localhost:3000/api';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  source?: 'rag' | 'live' | 'hybrid' | 'cache';
  citations?: { text: string; url?: string; title?: string }[];
}

/**
 * Send a chat message and receive streaming SSE response.
 * Calls onChunk for each text chunk, onDone when complete.
 */
export async function sendChatMessage(
  userId: string,
  message: string,
  onChunk: (text: string) => void,
  onDone: (meta: { source?: string; citations?: ChatMessage['citations'] }) => void,
  onError: (error: string) => void,
) {
  class FatalError extends Error {}

  try {
    await fetchEventSource(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ userId, message }),
      async onopen(response) {
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new FatalError(err.error || 'Request failed');
        }

        const contentType = response.headers.get('content-type') || '';
        
        // Handle cached (non-streaming) response
        if (contentType.includes('application/json')) {
          const data = await response.json();
          onChunk(data.response);
          onDone({ source: data.source });
          throw new FatalError('JSON_CACHED_RESPONSE');
        }
      },
      onmessage(event) {
        try {
          const data = JSON.parse(event.data);
          if (data.done) {
            onDone({ source: data.source, citations: data.citations });
          } else if (data.text) {
            onChunk(data.text);
          } else if (data.error) {
            onError(data.error);
          }
        } catch {
          // Skip malformed JSON
        }
      },
      onerror(err) {
        if (err instanceof FatalError) {
          throw err; // Rethrow to stop retrying
        }
        throw err; // Stop retries on other errors as well
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message !== 'JSON_CACHED_RESPONSE') {
      onError(error.message || 'Network error');
    } else if (error instanceof Error === false) {
      onError('Network error');
    }
  }
}

/**
 * Fetch conversation history for a user.
 */
export async function fetchHistory(userId: string): Promise<ChatMessage[]> {
  const response = await fetch(`${API_BASE}/history/${userId}`);
  if (!response.ok) return [];
  const data = await response.json();
  return data.messages || [];
}
