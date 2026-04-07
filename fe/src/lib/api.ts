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
  onDone: (meta: { source?: string; citations?: any[] }) => void,
  onError: (error: string) => void,
) {
  try {
    const response = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, message }),
    });

    if (!response.ok) {
      const err = await response.json();
      onError(err.error || 'Request failed');
      return;
    }

    const contentType = response.headers.get('content-type') || '';

    // Handle cached (non-streaming) response
    if (contentType.includes('application/json')) {
      const data = await response.json();
      onChunk(data.response);
      onDone({ source: data.source });
      return;
    }

    // Handle SSE streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) {
      onError('No response body');
      return;
    }

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.done) {
            onDone({ source: data.source, citations: data.citations });
          } else if (data.text) {
            onChunk(data.text);
          } else if (data.error) {
            onError(data.error);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (error: any) {
    onError(error.message || 'Network error');
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
