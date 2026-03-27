/**
 * GuiltySpark MCP Server
 *
 * Exposes three tools via MCP:
 *
 * 1. sanitize_prompt   — Scan text for PII and return sanitized version
 * 2. decode_response   — Reverse-substitute synthetic values in LLM response
 * 3. relay_prompt      — Full pipeline: sanitize → relay to LLM → decode response
 *
 * Session management: each MCP connection gets its own SubstitutionMap.
 * Maps are stored in a session registry keyed by a UUID returned to the client.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { loadConfig, toProtectionConfig } from './config.js';
import { scanText } from './pii-scanner.js';
import { applySubstitutions } from './substitution-engine.js';
import { decodeResponse } from './response-decoder.js';
import { relayToLLM } from './llm-relay.js';
import { getOrCreateSession, sessions } from './session-registry.js';
import { gsEvents, GS_EVENTS } from './events.js';
import { randomUUID } from 'crypto';

// ─── Tool schemas ──────────────────────────────────────────────────────────────

const SanitizePromptSchema = z.object({
  text: z.string().describe('The prompt text to sanitize'),
  session_id: z.string().optional().describe('Session ID for consistent substitutions across turns'),
});

const DecodeResponseSchema = z.object({
  text: z.string().describe('The LLM response text to decode'),
  session_id: z.string().describe('Session ID used during sanitization'),
});

const RelayPromptSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).describe('Conversation messages to sanitize and relay'),
  provider: z.enum(['anthropic', 'openai', 'openai-compatible']).default('anthropic'),
  model: z.string().default('claude-3-5-sonnet-20241022'),
  api_key: z.string().describe('API key for the LLM provider'),
  base_url: z.string().optional().describe('Base URL for openai-compatible providers'),
  session_id: z.string().optional().describe('Session ID for multi-turn conversations'),
  system_prompt: z.string().optional(),
});

// ─── Server setup ──────────────────────────────────────────────────────────────

export function createServer(): Server {
  const server = new Server(
    { name: 'guiltyspark', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const appConfig = loadConfig();
  const protectionConfig = toProtectionConfig(appConfig);

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'sanitize_prompt',
        description: 'Scan prompt text for PII and replace with realistic synthetic substitutes. Returns sanitized text and a session_id to use for decoding the response.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The prompt text to sanitize' },
            session_id: { type: 'string', description: 'Optional session ID for multi-turn conversations' },
          },
          required: ['text'],
        },
      },
      {
        name: 'decode_response',
        description: 'Restore original PII values in an LLM response by reversing the substitutions made during sanitization.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The LLM response to decode' },
            session_id: { type: 'string', description: 'Session ID from sanitize_prompt' },
          },
          required: ['text', 'session_id'],
        },
      },
      {
        name: 'relay_prompt',
        description: 'Full pipeline: sanitize messages, relay to LLM, decode response. PII never leaves the local machine.',
        inputSchema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                  content: { type: 'string' },
                },
                required: ['role', 'content'],
              },
            },
            provider: { type: 'string', enum: ['anthropic', 'openai', 'openai-compatible'], default: 'anthropic' },
            model: { type: 'string', default: 'claude-3-5-sonnet-20241022' },
            api_key: { type: 'string' },
            base_url: { type: 'string' },
            session_id: { type: 'string' },
            system_prompt: { type: 'string' },
          },
          required: ['messages', 'api_key'],
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'sanitize_prompt': {
          const input = SanitizePromptSchema.parse(args);
          const requestId = randomUUID();
          const session = getOrCreateSession(input.session_id);

          const scanResult = await scanText([input.text], protectionConfig, appConfig.ollama);
          const sanitized = applySubstitutions(input.text, scanResult.entities, session, protectionConfig.substitutionMode, protectionConfig.customEntities);

          // Emit pipeline events
          for (const entity of scanResult.entities) {
            gsEvents.emit(GS_EVENTS.ENTITY_DETECTED, {
              sessionId: session.sessionId, requestId, timestamp: Date.now(), entity,
            });
          }
          gsEvents.emit(GS_EVENTS.REQUEST_PROCESSED, {
            sessionId: session.sessionId, requestId, timestamp: Date.now(),
            originalText: input.text, sanitizedText: sanitized,
            entitiesFound: scanResult.entities.length, durationMs: scanResult.durationMs,
            provider: 'mcp',
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                sanitized,
                session_id: session.sessionId,
                entities_found: scanResult.entities.length,
                duration_ms: scanResult.durationMs,
                substitutions: scanResult.entities.map(e => ({
                  type: e.type,
                  source: e.source,
                  confidence: e.confidence,
                })),
              }),
            }],
          };
        }

        case 'decode_response': {
          const input = DecodeResponseSchema.parse(args);
          const session = sessions.get(input.session_id);

          if (!session) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: `Session ${input.session_id} not found or expired` }),
              }],
              isError: true,
            };
          }

          const decoded = decodeResponse(input.text, session);

          gsEvents.emit(GS_EVENTS.RESPONSE_DECODED, {
            sessionId: input.session_id, requestId: randomUUID(), timestamp: Date.now(),
            llmResponse: input.text, decodedResponse: decoded,
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ decoded, session_id: input.session_id }),
            }],
          };
        }

        case 'relay_prompt': {
          const input = RelayPromptSchema.parse(args);
          const requestId = randomUUID();
          const session = getOrCreateSession(input.session_id);

          // Sanitize all message content
          const sanitizedMessages = [];
          let allOriginalText = '';
          let allSanitizedText = '';
          let totalEntities = 0;
          for (const msg of input.messages) {
            const scanResult = await scanText([msg.content], protectionConfig, appConfig.ollama);
            const sanitizedContent = applySubstitutions(msg.content, scanResult.entities, session, protectionConfig.substitutionMode, protectionConfig.customEntities);
            sanitizedMessages.push({ ...msg, content: sanitizedContent });
            for (const entity of scanResult.entities) {
              gsEvents.emit(GS_EVENTS.ENTITY_DETECTED, {
                sessionId: session.sessionId, requestId, timestamp: Date.now(), entity,
              });
            }
            allOriginalText += msg.content + '\n';
            allSanitizedText += sanitizedContent + '\n';
            totalEntities += scanResult.entities.length;
          }

          gsEvents.emit(GS_EVENTS.REQUEST_PROCESSED, {
            sessionId: session.sessionId, requestId, timestamp: Date.now(),
            originalText: allOriginalText.trim(), sanitizedText: allSanitizedText.trim(),
            entitiesFound: totalEntities, durationMs: 0, provider: input.provider,
          });

          // Relay to LLM
          const llmResponse = await relayToLLM({
            provider: input.provider,
            model: input.model,
            messages: sanitizedMessages,
            systemPrompt: input.system_prompt,
            apiKey: input.api_key,
            baseUrl: input.base_url,
          });

          // Decode response
          const decodedContent = decodeResponse(llmResponse.content, session);

          gsEvents.emit(GS_EVENTS.RESPONSE_DECODED, {
            sessionId: session.sessionId, requestId, timestamp: Date.now(),
            llmResponse: llmResponse.content, decodedResponse: decodedContent,
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                response: decodedContent,
                session_id: session.sessionId,
                model: llmResponse.model,
                usage: llmResponse.usage,
              }),
            }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[guiltyspark] MCP server started on stdio');
}
