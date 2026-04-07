# RAG Conversational AI over Slack Documentation

A production-ready backend system that answers user questions about Slack by combining retrieval-augmented generation (RAG) with on-demand live documentation crawling. Built with Node.js, Express, TypeScript, MongoDB Atlas, Redis, and the Gemini API.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Request Lifecycle](#request-lifecycle)
- [Confidence-Based Routing](#confidence-based-routing)
- [Self-Learning Loop](#self-learning-loop)
- [Database Design](#database-design)
- [Caching Strategy](#caching-strategy)
- [Project Structure](#project-structure)
- [Setup Instructions](#setup-instructions)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)

---

## Overview

A user asks a question about Slack (e.g. "How do I use Block Kit?"). The system:

1. Searches its knowledge base for an answer (fast path)
2. If the knowledge base does not have a confident answer, it crawls docs.slack.dev in real-time (live path)
3. Answers using only Slack documentation -- never hallucinated content
4. Learns from every live fetch so the same question is fast next time
5. Remembers the user across conversations (short-term and long-term memory)

---

## Tech Stack

| Technology     | Role in the System                                                             |
|----------------|--------------------------------------------------------------------------------|
| Express        | HTTP server, routes, SSE streaming                                             |
| TypeScript     | Type safety across all services                                                |
| MongoDB Atlas  | Stores users, conversations, memory summaries, document chunks, crawled pages  |
| Redis          | Three cache layers (response, HTML, parsed docs) and BullMQ job queue          |
| BullMQ         | Background workers for memory summarization and self-learning ingestion        |
| Gemini API     | Query classification, embedding generation, answer generation (streaming)      |
| Cheerio        | Server-side HTML parsing to extract clean documentation content                |
| Zod            | Request body validation                                                        |
| Pino           | Structured JSON logging                                                        |

---

## Architecture

```
                          POST /api/chat
                               |
                               v
                       +---------------+
                       | chatController |
                       +-------+-------+
                               |
                               v
                       +---------------+
                       |  chatService   | <-- Orchestrator
                       +-------+-------+
                               |
              +----------------+----------------+
              |                |                |
     Promise.all (parallel)    |                |
              |                |                |
    +---------+-----+  +------+------+  +------+------+
    | Redis Cache   |  | classifyQuery|  | searchWith  |
    | Lookup        |  | (Gemini)    |  | Scores      |
    +---------------+  +-------------+  | (VectorDB)  |
                                        +------+------+
                                               |
                                    +----------+----------+
                                    |                     |
                              score >= 0.7          score < 0.7
                                    |                     |
                              RAG PATH              LIVE PATH
                                    |                     |
                           Use stored docs     +----------+----------+
                                    |          |                     |
                                    |    Resolve URLs         Fetch Pages
                                    |    (keyword map)      (FetcherService)
                                    |          |                     |
                                    |    Parse HTML           Extract Links
                                    |    (Cheerio)          (1-level deep)
                                    |          |                     |
                                    |    Chunk + Rank         Store in DB
                                    |    (embeddings)       (self-learning)
                                    |          |                     |
                                    +----------+----------+----------+
                                               |
                                               v
                                    +----------+----------+
                                    | Build Prompt         |
                                    | (system + context    |
                                    |  + memory + query)   |
                                    +----------+----------+
                                               |
                                               v
                                    +----------+----------+
                                    | Gemini 2.5 Flash     |
                                    | (streaming response) |
                                    +----------+----------+
                                               |
                                               v
                                    +----------+----------+
                                    | SSE Stream to Client |
                                    | + Cache response     |
                                    | + Save conversation  |
                                    | + Async memory job   |
                                    +---------------------+
```

---

## Request Lifecycle

### Phase 1: Request Arrives

```
POST /api/chat  ->  { userId: "user-123", message: "How do I use Block Kit?" }
```

The controller validates the request body using Zod, then hands off to `ChatService.processChat()`.

### Phase 2: Parallel Intelligence Gathering

The chat service fires four operations in parallel using `Promise.all`:

| Operation            | Service                            | What It Does                                                   |
|----------------------|------------------------------------|----------------------------------------------------------------|
| Cache lookup         | Redis                              | Check if this exact query was answered before                  |
| Query classification | `AIService.classifyQuery()`        | Ask Gemini to classify as simple, follow_up, or complex        |
| Vector search        | `VectorService.searchWithScores()` | Embed the query, cosine similarity against all stored chunks   |
| Recent messages      | `MemoryService.getRecentMessages()`| Fetch last 5 messages from MongoDB                             |

This parallel execution is a key performance optimization. All four happen simultaneously, not sequentially.

### Phase 3: The Confidence Router

The vector service returns a confidence result:

```typescript
{
  route: 'rag' | 'live',
  topScore: 0.82,
  vectorContext: [...]
}
```

- topScore >= 0.7: RAG path. Documents in the database are good enough. Response time is approximately 200ms.
- topScore < 0.7: Live path. Knowledge base is not confident enough. The system fetches from docs.slack.dev. Response time is approximately 3-8 seconds.

### Phase 4a: RAG Path (Fast)

If confidence is high, the system already has the matching documents in `vectorContext`. It skips directly to prompt construction.

### Phase 4b: Live Path (On-Demand Crawling)

The live docs service orchestrates:

1. URL Resolution: Maps the query to relevant docs.slack.dev URLs using keyword matching
2. Fetch Pages: Uses FetcherService with 3 retries, 10 second timeout, and 429 rate-limit handling. Fetches target URL plus up to 5 child pages (1-level deep). All fetches run in parallel.
3. Parse HTML: ParserService uses Cheerio to strip navigation, sidebar, footer, scripts, and styles. Extracts main content area, title, and headings. Normalizes whitespace and removes empty lines.
4. Chunk Content: Splits into 200-400 token pieces. Respects sentence and paragraph boundaries.
5. Rank by Relevance: Embeds all chunks via Gemini. Computes cosine similarity against query embedding. Returns the top 5 most relevant chunks.
6. Self-Learning (fire-and-forget): Stores crawled pages in the CrawledDocument collection in MongoDB. Queues top chunks for embedding and storage in DocumentChunks. The next time someone asks a similar question, the RAG path handles it.

### Phase 5: Prompt Construction

The system builds a structured prompt combining everything gathered:

```
SYSTEM: You are an assistant that answers strictly from Slack documentation.

CONTEXT:
[Doc 1] (URL: .../block-kit): Block Kit is a UI framework...
[Doc 2] (URL: .../messages): You can build rich messages...

USER LONG TERM SUMMARY: User is building a Slack bot for their team.

RECENT CONVERSATION:
User: What APIs does Slack provide?
Assistant: Slack provides the Web API, Events API, and...

USER: How do I use Block Kit?
```

### Phase 6: Streaming Response

The controller streams the Gemini response back via Server-Sent Events (SSE):

```
data: {"text": "Block Kit is "}
data: {"text": "a UI framework "}
data: {"text": "for building rich messages..."}
data: {"done": true, "source": "live", "citations": [...]}
```

The `source` field tells the client which path was used: `rag`, `live`, `hybrid`, or `cache`.

### Phase 7: Post-Response (Async)

After the response streams, background tasks fire:

1. Save conversation: Appends both user message and assistant response to the Conversations collection.
2. Memory summarization (BullMQ job): The memory worker summarizes the conversation into a long-term memory summary using Gemini.
3. Self-learning ingestion (BullMQ job): If the live path was used, embeds and stores the fetched doc chunks into DocumentChunks for future RAG hits.

---

## Confidence-Based Routing

The system supports three response paths based on vector search confidence:

| Path   | Trigger                       | Speed     | Example                                         |
|--------|-------------------------------|-----------|--------------------------------------------------|
| Cache  | Exact same query answered before | ~5ms   | Second person asking "What is Slack?"            |
| RAG    | Top similarity score >= 0.7   | ~200ms    | Question about Block Kit (already crawled)       |
| Live   | Top similarity score < 0.7    | ~3-8s     | First-ever question about Socket Mode            |

---

## Self-Learning Loop

The system teaches itself over time without any manual intervention:

```
Day 1:  User asks "What is Socket Mode?"
        Vector DB has no match (score: 0.3)
        LIVE PATH: Crawls docs.slack.dev/apis/connections/socket-mode
        Answers from live content
        Stores page and embeddings in MongoDB

Day 2:  Different user asks "How does Socket Mode work?"
        Vector DB matches the stored chunks (score: 0.85)
        RAG PATH: Answers instantly from stored embeddings
        No crawling needed
```

The system gets faster and more knowledgeable over time. Every live fetch enriches the vector database, converting future similar queries from slow live fetches into fast RAG lookups.

---

## Database Design

### MongoDB Collections

**Users**

| Field     | Type   | Description         |
|-----------|--------|---------------------|
| userId    | string | Unique identifier   |
| createdAt | Date   | Account creation    |

**Conversations**

| Field     | Type     | Description                              |
|-----------|----------|------------------------------------------|
| userId    | string   | References the user                      |
| messages  | array    | Array of { role, content, timestamp }    |
| updatedAt | Date     | Last message timestamp                   |

**Memory**

| Field     | Type   | Description                              |
|-----------|--------|------------------------------------------|
| userId    | string | References the user                      |
| summary   | string | LLM-generated summary of user intent     |
| updatedAt | Date   | Last summary update                      |

**DocumentChunks**

| Field     | Type     | Description                              |
|-----------|----------|------------------------------------------|
| text      | string   | Chunk of documentation text              |
| embedding | number[] | Vector embedding from Gemini             |
| metadata  | object   | Contains url and title                   |

**CrawledDocuments**

| Field          | Type   | Description                              |
|----------------|--------|------------------------------------------|
| url            | string | Page URL (unique index)                  |
| title          | string | Page title                               |
| content        | string | Full cleaned text content                |
| contentHash    | string | SHA256 hash for change detection         |
| lastCrawledAt  | Date   | When this page was last fetched          |

---

## Caching Strategy

Three layers of Redis caching reduce latency and external API calls:

| Cache Key              | TTL     | Content                        |
|------------------------|---------|--------------------------------|
| chat-cache:{query}     | 1 hour  | Full LLM response              |
| html-cache:{url}       | 1 hour  | Raw HTML from docs.slack.dev   |
| parsed-docs:{query}    | 6 hours | Parsed and chunked doc content |

---

## Project Structure

```
src/
  config/
    db.ts                          MongoDB connection
    redis.ts                       Redis client and BullMQ queues
  controllers/
    chatController.ts              POST /chat, GET /history
  models/
    User.ts                        User schema
    Conversation.ts                Message history
    Memory.ts                      Long-term summary
    DocumentChunk.ts               Embeddings for vector search
    CrawledDocument.ts             Raw crawled pages
  services/
    aiService.ts                   Gemini API (embed, generate, classify)
    chatService.ts                 Main orchestrator (RAG vs Live routing)
    liveDocsService.ts             On-demand doc fetching and ranking
    memoryService.ts               Conversation and memory DB operations
    vectorService.ts               Vector search and confidence scoring
    crawler/
      fetcherService.ts            HTTP with retries and timeouts
      parserService.ts             Cheerio HTML to clean text
      linkExtractorService.ts      URL discovery and filtering
      deduplicationService.ts      Redis SET dedup and SHA256 hashing
      storageService.ts            MongoDB upsert with change detection
  workers/
    memoryWorker.ts                Background: summarize and ingest
  routes/
    index.ts                       Route definitions
  utils/
    logger.ts                      Pino structured logger
  index.ts                         Express entry point
```

---

## Setup Instructions

### Prerequisites

- Node.js v18 or later
- Docker (for Redis)
- A MongoDB Atlas cluster
- A Gemini API key

### 1. Install Dependencies

```bash
cd be
npm install
```

### 2. Start Redis

```bash
docker run -d -p 6379:6379 redis
```

### 3. Configure Environment Variables

Create a `.env` file in the `be/` directory:

```
PORT=3000
MONGODB_URI=your_mongodb_atlas_connection_string
REDIS_URL=redis://localhost:6379
GEMINI_API_KEY=your_gemini_api_key
```

### 4. Seed Initial Documents (Optional)

```bash
npx ts-node src/scripts/ingestDocs.ts
```

This ingests a small set of mock Slack documentation into the vector database. The system will crawl and learn more documents automatically as users ask questions.

### 5. Start the Server

```bash
npm run dev
```

The server starts on port 3000. The system is ready to accept queries immediately. No pre-crawling step is required.

---

## API Reference

### POST /api/chat

Send a user query and receive a streamed response.

**Request:**

```json
{
  "userId": "user-123",
  "message": "How do I build rich messages in Slack?"
}
```

**Response (SSE stream):**

```
data: {"text": "To build rich messages "}
data: {"text": "in Slack, you can use "}
data: {"text": "Block Kit..."}
data: {"done": true, "source": "live", "citations": [...]}
```

The `source` field indicates: `rag`, `live`, `hybrid`, or `cache`.

### GET /api/history/:userId

Retrieve conversation history for a user.

**Response:**

```json
{
  "messages": [
    { "role": "user", "content": "How do I use Block Kit?", "timestamp": "..." },
    { "role": "assistant", "content": "Block Kit is a UI framework...", "timestamp": "..." }
  ]
}
```

---

## Environment Variables

| Variable      | Required | Description                                  |
|---------------|----------|----------------------------------------------|
| PORT          | No       | Server port (default: 3000)                  |
| MONGODB_URI   | Yes      | MongoDB Atlas connection string              |
| REDIS_URL     | No       | Redis URL (default: redis://localhost:6379)   |
| GEMINI_API_KEY| Yes      | Google Gemini API key                        |
