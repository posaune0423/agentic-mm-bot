/**
 * Extended Execution Adapter
 *
 * Requirements: 4.3, 7.6, 7.7
 * - Post-only order placement via Extended SDK
 * - Order cancellation
 * - POST_ONLY_REJECTED detection
 *
 * SDK: https://github.com/Bvvvp009/Extended-TS-SDK
 */

import Decimal from "decimal.js";
import {
  initWasm,
  TESTNET_CONFIG,
  MAINNET_CONFIG,
  StarkPerpetualAccount,
  PerpetualTradingClient,
  PerpetualStreamClient,
  OrderSide as ExtendedOrderSide,
  OrderStatus as ExtendedOrderStatus,
  OrderStatusReason,
  TimeInForce,
  SelfTradeProtectionLevel,
  RateLimitException,
  NotAuthorizedException,
  type EndpointConfig,
  type OpenOrderModel,
  type PositionModel,
  type PerpetualStreamConnection,
} from "extended-typescript-sdk";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type {
  CancelOrderRequest,
  ExecutionError,
  ExecutionEvent,
  ExecutionPort,
  OpenOrder,
  OrderResponse,
  PlaceOrderRequest,
  PositionInfo,
} from "../ports";
import type { ExtendedConfig, ExtendedAccountStreamData, ExtendedOrderUpdate, ExtendedTradeUpdate } from "./types";

/**
 * Extended Execution Adapter
 *
 * Implements ExecutionPort for Extended exchange using extended-typescript-sdk
 */
export class ExtendedExecutionAdapter implements ExecutionPort {
  private config: ExtendedConfig;
  private endpointConfig: EndpointConfig;
  private starkAccount: StarkPerpetualAccount;
  private tradingClient: PerpetualTradingClient;
  private streamClient: PerpetualStreamClient;

  private eventHandlers: ((event: ExecutionEvent) => void)[] = [];
  private accountStream: PerpetualStreamConnection<ExtendedAccountStreamData> | null = null;
  private isWasmInitialized = false;

  constructor(config: ExtendedConfig) {
    this.config = config;
    this.endpointConfig = config.network === "mainnet" ? MAINNET_CONFIG : TESTNET_CONFIG;

    this.starkAccount = new StarkPerpetualAccount(
      config.vaultId,
      config.starkPrivateKey,
      config.starkPublicKey,
      config.apiKey,
    );

    this.tradingClient = new PerpetualTradingClient(this.endpointConfig, this.starkAccount);
    this.streamClient = new PerpetualStreamClient({
      apiUrl: this.endpointConfig.streamUrl,
    });
  }

  /**
   * Initialize WASM module (required before any signing operations)
   */
  private async ensureWasmInitialized(): Promise<void> {
    if (this.isWasmInitialized) return;
    await initWasm();
    this.isWasmInitialized = true;
  }

  placeOrder(request: PlaceOrderRequest): ResultAsync<OrderResponse, ExecutionError> {
    return ResultAsync.fromPromise(this.ensureWasmInitialized(), this.mapError).andThen(() =>
      ResultAsync.fromPromise(
        this.tradingClient.placeOrder({
          marketName: request.symbol,
          amountOfSynthetic: new Decimal(request.size),
          price: new Decimal(request.price),
          side: request.side === "buy" ? ExtendedOrderSide.BUY : ExtendedOrderSide.SELL,
          postOnly: request.postOnly,
          externalId: request.clientOrderId,
          timeInForce: request.postOnly ? TimeInForce.GTT : TimeInForce.IOC,
          selfTradeProtectionLevel: SelfTradeProtectionLevel.ACCOUNT,
        }),
        this.mapError,
      ).map(response => ({
        clientOrderId: response.data?.id ?? request.clientOrderId,
        exchangeOrderId: response.data?.id,
        status: this.mapOrderStatus(response.data?.status),
        ts: new Date(response.data?.createdTime ?? Date.now()),
      })),
    );
  }

  cancelOrder(request: CancelOrderRequest): ResultAsync<OrderResponse, ExecutionError> {
    if (request.exchangeOrderId) {
      const orderId = parseInt(request.exchangeOrderId, 10);

      return ResultAsync.fromPromise(this.tradingClient.orders.cancelOrder(orderId), this.mapError).map(() => ({
        clientOrderId: request.clientOrderId ?? "",
        exchangeOrderId: request.exchangeOrderId,
        status: "cancelled" as const,
        ts: new Date(),
      }));
    }

    if (request.clientOrderId) {
      return ResultAsync.fromPromise(
        this.tradingClient.orders.cancelOrderByExternalId(request.clientOrderId),
        this.mapError,
      ).map(() => ({
        clientOrderId: request.clientOrderId ?? "",
        status: "cancelled" as const,
        ts: new Date(),
      }));
    }

    return errAsync({
      type: "invalid_order" as const,
      message: "Either clientOrderId or exchangeOrderId is required",
    });
  }

  cancelAllOrders(symbol: string): ResultAsync<void, ExecutionError> {
    return ResultAsync.fromPromise(this.tradingClient.orders.massCancel({ markets: [symbol] }), this.mapError).map(
      () => undefined,
    );
  }

  getOpenOrders(symbol: string): ResultAsync<OpenOrder[], ExecutionError> {
    return ResultAsync.fromPromise(
      this.tradingClient.account.getOpenOrders({ marketNames: [symbol] }),
      this.mapError,
    ).map(response =>
      (response.data ?? []).map((o: OpenOrderModel) => ({
        clientOrderId: o.externalId,
        exchangeOrderId: o.id.toString(),
        symbol: o.market,
        side: (o.side as string) === "BUY" ? ("buy" as const) : ("sell" as const),
        price: o.price.toString(),
        size: o.qty.toString(),
        filledSize: o.filledQty?.toString() ?? "0",
        status: this.mapOrderStatus(o.status),
        createdAt: new Date(o.createdTime),
      })),
    );
  }

  getPosition(symbol: string): ResultAsync<PositionInfo | null, ExecutionError> {
    return ResultAsync.fromPromise(
      this.tradingClient.account.getPositions({ marketNames: [symbol] }),
      this.mapError,
    ).map(response => {
      const positions = response.data ?? [];
      if (positions.length === 0) return null;

      const p = positions[0] as PositionModel;
      const size = (p.side as string) === "LONG" ? p.size.toString() : "-" + p.size.toString();

      return {
        symbol: p.market,
        size,
        entryPrice: p.openPrice.toString(),
        unrealizedPnl: p.unrealisedPnl.toString(),
        updatedAt: new Date(p.updatedAt),
      };
    });
  }

  onEvent(handler: (event: ExecutionEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  connectPrivateStream(): ResultAsync<void, ExecutionError> {
    return ResultAsync.fromPromise(
      (async () => {
        const connection = this.streamClient.subscribeToAccountUpdates(this.config.apiKey);
        this.accountStream = await connection.connect();

        // Start listening for messages
        void this.listenAccountStream();
      })(),
      this.mapError,
    );
  }

  disconnectPrivateStream(): ResultAsync<void, ExecutionError> {
    if (this.accountStream) {
      return ResultAsync.fromPromise(this.accountStream.close(), this.mapError).map(() => {
        this.accountStream = null;
      });
    }
    return okAsync(undefined);
  }

  private async listenAccountStream(): Promise<void> {
    if (!this.accountStream) return;

    for await (const message of this.accountStream) {
      if (message.data) {
        this.handleAccountMessage(message.data);
      }
    }
  }

  private handleAccountMessage(data: ExtendedAccountStreamData): void {
    // Handle trades (fills)
    if (data.trades) {
      for (const trade of data.trades) {
        this.emitFillEvent(trade);
      }
    }

    // Handle order updates
    if (data.orders) {
      for (const order of data.orders) {
        this.emitOrderUpdateEvent(order);
      }
    }
  }

  private emitFillEvent(trade: ExtendedTradeUpdate): void {
    this.emitEvent({
      type: "fill",
      ts: new Date(trade.createdTime),
      clientOrderId: "",
      exchangeOrderId: trade.orderId.toString(),
      symbol: trade.market,
      side: trade.side === "BUY" ? "buy" : "sell",
      price: trade.price,
      size: trade.qty,
      fee: trade.fee,
      liquidity: trade.type === "MAKER" ? "maker" : "taker",
    });
  }

  private emitOrderUpdateEvent(order: ExtendedOrderUpdate): void {
    const status = this.mapOrderStatus(order.status as ExtendedOrderStatus);

    // Detect POST_ONLY_REJECTED
    const reason =
      order.statusReason === OrderStatusReason.POST_ONLY_FAILED ? "POST_ONLY_REJECTED" : order.statusReason;

    this.emitEvent({
      type: "order_update",
      ts: new Date(order.updatedTime),
      clientOrderId: order.externalId,
      exchangeOrderId: order.id.toString(),
      status,
      reason,
    });
  }

  private emitEvent(event: ExecutionEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  private mapOrderStatus(
    status?: ExtendedOrderStatus | string,
  ): "pending" | "open" | "filled" | "cancelled" | "rejected" {
    if (!status) return "pending";

    // Handle enum values
    if (typeof status === "object" || status in ExtendedOrderStatus) {
      switch (status as ExtendedOrderStatus) {
        case ExtendedOrderStatus.NEW:
        case ExtendedOrderStatus.UNTRIGGERED:
          return "pending";
        case ExtendedOrderStatus.PARTIALLY_FILLED:
          return "open";
        case ExtendedOrderStatus.FILLED:
          return "filled";
        case ExtendedOrderStatus.CANCELLED:
        case ExtendedOrderStatus.EXPIRED:
          return "cancelled";
        case ExtendedOrderStatus.REJECTED:
          return "rejected";
        default:
          return "pending";
      }
    }

    // Handle string values
    const statusStr = String(status).toUpperCase();
    if (statusStr === "NEW" || statusStr === "UNTRIGGERED") return "pending";
    if (statusStr === "PARTIALLY_FILLED") return "open";
    if (statusStr === "FILLED") return "filled";
    if (statusStr === "CANCELLED" || statusStr === "EXPIRED") return "cancelled";
    if (statusStr === "REJECTED") return "rejected";

    return "pending";
  }

  private mapError = (error: unknown): ExecutionError => {
    if (error instanceof RateLimitException) {
      return {
        type: "rate_limit",
        message: error.message,
        retryAfterMs: 1000,
      };
    }

    if (error instanceof NotAuthorizedException) {
      return {
        type: "auth",
        message: error.message,
      };
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("post_only") || message.includes("post only failed")) {
        return {
          type: "post_only_rejected",
          message: error.message,
        };
      }

      if (message.includes("insufficient") || message.includes("not enough")) {
        return {
          type: "insufficient_balance",
          message: error.message,
        };
      }

      return {
        type: "exchange_error",
        message: error.message,
      };
    }

    return {
      type: "unknown",
      message: String(error),
    };
  };
}
