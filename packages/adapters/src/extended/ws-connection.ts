/**
 * WsConnection - WebSocket connection wrapper with AsyncIterable support
 *
 * This module provides a direct WebSocket implementation using the `ws` package,
 * bypassing the SDK's PerpetualStreamClient to avoid the globalThis.WebSocket
 * resolution issues in Bun environments.
 *
 * Features:
 * - Direct URL + headers control (supports X-Api-Key for private streams)
 * - AsyncIterable interface for `for await` consumption
 * - Reconnection-friendly: connect()/close()/isClosed()
 *
 * @see https://api.docs.extended.exchange/#websocket-streams
 */

import WebSocket from "ws";
import { logger } from "@agentic-mm-bot/utils";

const log = logger;

/**
 * Options for creating a WebSocket connection
 */
export interface WsConnectionOptions {
  /**
   * Full WebSocket URL (e.g., wss://api.starknet.extended.exchange/orderbooks/BTC-USDC-PERP)
   */
  url: string;

  /**
   * Optional headers to send during handshake (e.g., X-Api-Key, User-Agent)
   */
  headers?: Record<string, string>;

  /**
   * Label for logging (e.g., "orderbook:BTC-USDC-PERP")
   */
  label?: string;
}

/**
 * A WebSocket connection that implements AsyncIterable for message consumption.
 *
 * Usage:
 * ```ts
 * const conn = new WsConnection({ url: 'wss://...' });
 * await conn.connect();
 * for await (const message of conn) {
 *   // message is already parsed JSON
 * }
 * ```
 */
export class WsConnection<T = unknown> implements AsyncIterable<T> {
  private ws: WebSocket | null = null;
  private closed = true;
  private url: string;
  private headers: Record<string, string>;
  private label: string;

  // Queue for buffering incoming messages
  private queue: T[] = [];
  private pendingResolve: ((result: IteratorResult<T>) => void) | null = null;
  private pendingReject: ((error: unknown) => void) | null = null;
  private lastError: Error | null = null;

  constructor(options: WsConnectionOptions) {
    this.url = options.url;
    this.headers = options.headers ?? {};
    this.label = options.label ?? options.url;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws && !this.closed) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.closed = false;
      this.lastError = null;
      this.queue = [];

      this.ws = new WebSocket(this.url, {
        headers: this.headers,
      });

      this.ws.on("open", () => {
        log.debug(`WsConnection opened: ${this.label}`);
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const raw = typeof data === "string" ? data : (data as Buffer).toString("utf8");
          const parsed = JSON.parse(raw) as T;
          this.enqueue(parsed);
        } catch (err) {
          log.warn(`WsConnection parse error: ${this.label}`, { error: err });
          // Ignore parse errors - rely on staleness/seq signals
        }
      });

      this.ws.on("close", (code, reason) => {
        log.debug(`WsConnection closed: ${this.label}`, {
          code,
          reason: reason.toString("utf8"),
        });
        this.handleClose();
      });

      this.ws.on("error", err => {
        log.warn(`WsConnection error: ${this.label}`, { error: err });
        this.lastError = err;

        // If not yet connected, reject the connect promise
        if (this.closed) {
          reject(err);
        } else {
          // Notify waiting iterator
          this.handleClose();
        }
      });
    });
  }

  /**
   * Close the WebSocket connection
   */
  async close(): Promise<void> {
    if (this.closed) return Promise.resolve();

    this.closed = true;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Wake up any pending iterator
    if (this.pendingResolve) {
      this.pendingResolve({ value: undefined as unknown as T, done: true });
      this.pendingResolve = null;
      this.pendingReject = null;
    }

    return Promise.resolve();
  }

  /**
   * Check if the connection is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get the underlying WebSocket (for advanced use cases)
   */
  get websocket(): WebSocket | null {
    return this.ws;
  }

  // =========================================================================
  // AsyncIterable Implementation
  // =========================================================================

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async (): Promise<IteratorResult<T>> => {
        // Return queued messages first
        if (this.queue.length > 0) {
          const value = this.queue.shift();
          if (value !== undefined) {
            return { value, done: false };
          }
        }

        // If closed, end iteration
        if (this.closed) {
          if (this.lastError) {
            throw this.lastError;
          }
          return { value: undefined as unknown as T, done: true };
        }

        // Wait for next message
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.pendingResolve = resolve;
          this.pendingReject = reject;
        });
      },

      return: async (): Promise<IteratorResult<T>> => {
        await this.close();
        return { value: undefined as unknown as T, done: true };
      },
    };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private enqueue(message: T): void {
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      this.pendingReject = null;
      resolve({ value: message, done: false });
    } else {
      this.queue.push(message);
    }
  }

  private handleClose(): void {
    this.closed = true;

    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      const reject = this.pendingReject;
      this.pendingResolve = null;
      this.pendingReject = null;

      if (this.lastError && reject) {
        reject(this.lastError);
      } else {
        resolve({ value: undefined as unknown as T, done: true });
      }
    }
  }
}

// ============================================================================
// Factory Functions for Extended Streams
// ============================================================================

/**
 * Extended stream endpoint configuration
 */
export interface ExtendedStreamConfig {
  /**
   * Base stream URL (e.g., wss://api.starknet.extended.exchange)
   */
  streamUrl: string;

  /**
   * API key for private streams (X-Api-Key header)
   */
  apiKey?: string;
}

/**
 * Stream paths for Extended Exchange WebSocket API
 * @see https://api.docs.extended.exchange/#websocket-streams
 */
export const ExtendedStreamPaths = {
  orderbooks: (market: string) => `/orderbooks/${market}`,
  trades: (market: string) => `/publicTrades/${market}`,
  markPrice: (market: string) => `/prices/mark/${market}`,
  indexPrice: (market: string) => `/prices/index/${market}`,
  funding: (market: string) => `/funding/${market}`,
  account: () => "/account",
} as const;

/**
 * Create a WebSocket connection for an Extended public stream
 */
export function createPublicStreamConnection<T = unknown>(
  config: ExtendedStreamConfig,
  path: string,
  label?: string,
): WsConnection<T> {
  const url = `${config.streamUrl}${path}`;

  return new WsConnection<T>({
    url,
    headers: {
      "User-Agent": "agentic-mm-bot/1.0",
    },
    label: label ?? path,
  });
}

/**
 * Create a WebSocket connection for Extended private account stream
 */
export function createPrivateStreamConnection<T = unknown>(
  config: ExtendedStreamConfig,
  label?: string,
): WsConnection<T> {
  if (config.apiKey === undefined || config.apiKey === "") {
    throw new Error("API key is required for private stream connection");
  }

  const url = `${config.streamUrl}${ExtendedStreamPaths.account()}`;

  return new WsConnection<T>({
    url,
    headers: {
      "User-Agent": "agentic-mm-bot/1.0",
      "X-Api-Key": config.apiKey,
    },
    label: label ?? "account",
  });
}

/**
 * Interface for WebSocket connections used by adapters.
 * Both WsConnection and test mocks should implement this interface.
 */
export interface IWsConnection<T> extends AsyncIterable<T> {
  connect: () => Promise<void>;
  close: () => Promise<void>;
  isClosed: () => boolean;
}

/**
 * Connection factory type for dependency injection in tests
 */
export type WsConnectionFactory<T = unknown> = (
  url: string,
  headers?: Record<string, string>,
  label?: string,
) => IWsConnection<T>;

/**
 * Default connection factory using WsConnection
 */
export const defaultConnectionFactory: WsConnectionFactory = <T = unknown>(
  url: string,
  headers?: Record<string, string>,
  label?: string,
): IWsConnection<T> => {
  return new WsConnection<T>({ url, headers, label });
};
