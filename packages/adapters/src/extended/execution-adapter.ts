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
  TradingFeeModel,
  DEFAULT_FEES,
  type EndpointConfig,
  type MarketModel,
  type OpenOrderModel,
  type PositionModel,
  type PerpetualStreamConnection,
} from "extended-typescript-sdk";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { logger } from "@agentic-mm-bot/utils";

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
  private marketCache: Map<string, MarketModel> = new Map();
  private accountVaultCache: number | null = null;
  private accountL2KeyPrefixCache: string | null = null;
  private feeCache: Map<string, TradingFeeModel> = new Map();

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
    this.streamClient = new PerpetualStreamClient({ apiUrl: this.endpointConfig.streamUrl });

    // NOTE: Do not log secrets (API key / private key). Prefixes only.
    logger.info("Extended execution adapter constructed", {
      network: this.config.network,
      apiBaseUrl: this.endpointConfig.apiBaseUrl,
      streamUrl: this.endpointConfig.streamUrl,
      vaultId: this.config.vaultId,
      starkPublicKeyPrefix: String(this.config.starkPublicKey).slice(0, 10),
      apiKeyPresent: Boolean(this.config.apiKey),
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

  private async getMarket(symbol: string): Promise<MarketModel | null> {
    const cached = this.marketCache.get(symbol);
    if (cached) return cached;

    try {
      const res = await this.tradingClient.marketsInfo.getMarkets({ marketNames: [symbol] });
      const market = res.data?.[0] ?? null;
      if (market) this.marketCache.set(symbol, market);
      return market;
    } catch {
      return null;
    }
  }

  private normalizeDecimal(value: unknown, fallback: string): Decimal {
    if (value instanceof Decimal) return value;
    try {
      if (typeof value === "number" || typeof value === "string") return new Decimal(value);
      if (value && typeof value === "object") {
        if ("toString" in value) {
          const maybeToString = (value as { toString?: unknown }).toString;
          if (typeof maybeToString === "function") {
            const toStringFn = maybeToString as () => string;
            const s = toStringFn.call(value);
            return new Decimal(s);
          }
        }
      }
      return new Decimal(fallback);
    } catch {
      return new Decimal(fallback);
    }
  }

  private getFirstDataItem(res: unknown): unknown {
    if (!res || typeof res !== "object") return undefined;
    if (!("data" in res)) return undefined;
    const data = (res as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length === 0) return undefined;
    return data[0];
  }

  private getObjectProp(obj: unknown, key: string): unknown {
    if (!obj || typeof obj !== "object") return undefined;
    if (!(key in obj)) return undefined;
    return (obj as Record<string, unknown>)[key];
  }

  private async ensureTradingFee(symbol: string, postOnly: boolean): Promise<void> {
    const cached = this.feeCache.get(symbol);
    if (cached) {
      // For postOnly we want maker fee in the settlement hash. The SDK currently uses takerFeeRate
      // when building settlement (see README and SDK internals), so we override takerFeeRate=makerFeeRate.
      const maker = this.normalizeDecimal(this.getObjectProp(cached, "makerFeeRate"), "0");
      const taker = this.normalizeDecimal(this.getObjectProp(cached, "takerFeeRate"), "0");
      const builder = this.normalizeDecimal(this.getObjectProp(cached, "builderFeeRate"), "0");

      const effective = new TradingFeeModel(symbol, maker, taker, builder);
      const overridden = postOnly ? new TradingFeeModel(symbol, maker, maker, builder) : effective;
      this.starkAccount.setTradingFee(symbol, overridden);
      return;
    }

    try {
      const res: unknown = (await this.tradingClient.account.getFees({ marketNames: [symbol] })) as unknown;
      const fee: unknown = this.getFirstDataItem(res);

      const defaultMaker = this.normalizeDecimal(this.getObjectProp(DEFAULT_FEES, "makerFeeRate"), "0").toString();
      const defaultTaker = this.normalizeDecimal(this.getObjectProp(DEFAULT_FEES, "takerFeeRate"), "0").toString();
      const defaultBuilder = this.normalizeDecimal(this.getObjectProp(DEFAULT_FEES, "builderFeeRate"), "0").toString();

      const maker = this.normalizeDecimal(this.getObjectProp(fee, "makerFeeRate"), defaultMaker);
      const taker = this.normalizeDecimal(this.getObjectProp(fee, "takerFeeRate"), defaultTaker);
      const builder = this.normalizeDecimal(this.getObjectProp(fee, "builderFeeRate"), defaultBuilder);
      const effective = new TradingFeeModel(symbol, maker, taker, builder);
      this.feeCache.set(symbol, effective);

      const overridden = postOnly ? new TradingFeeModel(symbol, maker, maker, builder) : effective;
      this.starkAccount.setTradingFee(symbol, overridden);

      // #region agent log
      fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "post-fix2",
          hypothesisId: "H6",
          location: "packages/adapters/src/extended/execution-adapter.ts:ensureTradingFee",
          message: "loaded trading fees and applied override if postOnly",
          data: {
            symbol,
            postOnly,
            source: fee ? "api" : "default",
            makerFeeRate: maker.toString(),
            takerFeeRate: taker.toString(),
            builderFeeRate: builder.toString(),
            appliedTakerFeeRate: overridden.takerFeeRate.toString(),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion agent log
    } catch (error) {
      // Fallback to default fees, still apply postOnly override
      const maker = this.normalizeDecimal(this.getObjectProp(DEFAULT_FEES, "makerFeeRate"), "0");
      const taker = this.normalizeDecimal(this.getObjectProp(DEFAULT_FEES, "takerFeeRate"), "0");
      const builder = this.normalizeDecimal(this.getObjectProp(DEFAULT_FEES, "builderFeeRate"), "0");
      const effective = new TradingFeeModel(symbol, maker, taker, builder);
      this.feeCache.set(symbol, effective);
      const overridden = postOnly ? new TradingFeeModel(symbol, maker, maker, builder) : effective;
      this.starkAccount.setTradingFee(symbol, overridden);

      // #region agent log
      fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "post-fix2",
          hypothesisId: "H6",
          location: "packages/adapters/src/extended/execution-adapter.ts:ensureTradingFee",
          message: "failed to load fees; using default and applied override if postOnly",
          data: {
            symbol,
            postOnly,
            error: error instanceof Error ? error.message : String(error),
            makerFeeRate: maker.toString(),
            takerFeeRate: taker.toString(),
            builderFeeRate: builder.toString(),
            appliedTakerFeeRate: overridden.takerFeeRate.toString(),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion agent log
    }
  }

  private async getAccountInfoCached(): Promise<{ vault: number | null; l2KeyPrefix: string | null }> {
    if (this.accountVaultCache !== null || this.accountL2KeyPrefixCache !== null) {
      return {
        vault: this.accountVaultCache,
        l2KeyPrefix: this.accountL2KeyPrefixCache,
      };
    }

    try {
      const res: unknown = (await this.tradingClient.account.getAccount()) as unknown;
      const data = this.getObjectProp(res, "data");
      const l2Vault = this.getObjectProp(data, "l2Vault");
      const l2Key = this.getObjectProp(data, "l2Key");

      const l2KeyHex =
        typeof l2Key === "string" ? l2Key
        : typeof l2Key === "number" ? String(l2Key)
        : typeof l2Key === "bigint" ? l2Key.toString()
        : null;
      const l2KeyPrefix = l2KeyHex ? l2KeyHex.slice(0, 10) : null;
      this.accountL2KeyPrefixCache = l2KeyPrefix;

      const vaultNum = typeof l2Vault === "number" ? l2Vault : Number(l2Vault);
      if (Number.isFinite(vaultNum)) {
        this.accountVaultCache = vaultNum;
        return { vault: vaultNum, l2KeyPrefix };
      }
      return { vault: null, l2KeyPrefix };
    } catch {
      return { vault: null, l2KeyPrefix: null };
    }
  }

  private toDecimal(value: unknown): Decimal | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Decimal) return value;
    try {
      if (typeof value === "number" || typeof value === "string") return new Decimal(value);
      if (typeof value === "bigint") return new Decimal(value.toString());
      if (typeof value === "object" && "toString" in value) {
        const maybeToString = (value as { toString?: unknown }).toString;
        if (typeof maybeToString === "function") {
          const toStringFn = maybeToString as () => string;
          const s = toStringFn.call(value);
          return new Decimal(s);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private roundDownToStep(value: Decimal, step: Decimal): Decimal {
    if (step.lte(0)) return value;
    return value.div(step).toDecimalPlaces(0, Decimal.ROUND_DOWN).mul(step);
  }

  placeOrder(request: PlaceOrderRequest): ResultAsync<OrderResponse, ExecutionError> {
    // #region agent log
    fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "debug-session",
        runId: "post-fix",
        hypothesisId: "H0",
        location: "packages/adapters/src/extended/execution-adapter.ts:placeOrder:entry",
        message: "placeOrder called",
        data: {
          symbol: request.symbol,
          side: request.side,
          postOnly: request.postOnly,
          size: request.size,
          price: request.price,
          clientOrderIdPresent: Boolean(request.clientOrderId),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion agent log

    let amountOfSynthetic: Decimal;
    try {
      amountOfSynthetic = new Decimal(request.size);
    } catch {
      return errAsync({ type: "invalid_order" as const, message: `Invalid size: ${request.size}` });
    }

    // The quote calculator emits sizes with up to 6 decimals (base units).
    // Never truncate to 1 decimal: e.g. BTC sizes like 0.001 would become 0 and be rejected.
    amountOfSynthetic = amountOfSynthetic.toDecimalPlaces(6, Decimal.ROUND_DOWN);
    if (!amountOfSynthetic.isFinite() || amountOfSynthetic.lte(0)) {
      return errAsync({ type: "invalid_order" as const, message: `Invalid size after rounding: ${request.size}` });
    }

    return ResultAsync.fromPromise(this.ensureWasmInitialized(), this.mapError).andThen(() =>
      ResultAsync.fromPromise(
        (async () => {
          // Ensure the fee model is loaded. For postOnly orders, override takerFeeRate=makerFeeRate
          // because the SDK settlement currently uses takerFeeRate in the signed payload.
          await this.ensureTradingFee(request.symbol, request.postOnly);

          const account = await this.getAccountInfoCached();
          const accountVault = account.vault;
          const accountL2KeyPrefix = account.l2KeyPrefix;

          // #region agent log
          fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "debug-session",
              runId: "post-fix",
              hypothesisId: "H5",
              location: "packages/adapters/src/extended/execution-adapter.ts:placeOrder:accountVault",
              message: "account vault fetched (or missing)",
              data: {
                configuredVaultId: this.config.vaultId,
                accountVault,
                match: accountVault === null ? null : accountVault === this.config.vaultId,
                configuredStarkPublicKeyPrefix: String(this.config.starkPublicKey).slice(0, 10),
                accountL2KeyPrefix,
                keyMatch:
                  accountL2KeyPrefix === null ? null : (
                    accountL2KeyPrefix === String(this.config.starkPublicKey).slice(0, 10)
                  ),
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion agent log

          if (accountVault !== null && accountVault !== this.config.vaultId) {
            throw new Error(
              `Vault mismatch: configured vaultId=${this.config.vaultId} but account l2Vault=${accountVault} (network=${this.config.network})`,
            );
          }

          const market = await this.getMarket(request.symbol);
          const tc = this.getObjectProp(market as unknown, "tradingConfig");
          const minOrderSizeChange = this.getObjectProp(tc, "minOrderSizeChange");
          const minOrderSize = this.getObjectProp(tc, "minOrderSize");
          const minPriceChange = this.getObjectProp(tc, "minPriceChange");
          const quantityPrecision = this.getObjectProp(tc, "quantityPrecision");
          const pricePrecision = this.getObjectProp(tc, "pricePrecision");

          // #region agent log
          fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "debug-session",
              runId: "post-fix",
              hypothesisId: "H1",
              location: "packages/adapters/src/extended/execution-adapter.ts:placeOrder:marketConfig",
              message: "market trading config fetched (or missing)",
              data: {
                symbol: request.symbol,
                marketFound: Boolean(market),
                minOrderSizeChange:
                  typeof minOrderSizeChange === "string" ? minOrderSizeChange : String(minOrderSizeChange),
                minOrderSize: typeof minOrderSize === "string" ? minOrderSize : String(minOrderSize),
                minPriceChange: typeof minPriceChange === "string" ? minPriceChange : String(minPriceChange),
                quantityPrecision,
                pricePrecision,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion agent log

          const rawPrice = new Decimal(request.price);

          const minQtyStep = this.toDecimal(minOrderSizeChange);
          const minQty = this.toDecimal(minOrderSize);
          const priceStep = this.toDecimal(minPriceChange);

          const sizeRounded =
            minQtyStep && minQtyStep.gt(0) ? this.roundDownToStep(amountOfSynthetic, minQtyStep) : amountOfSynthetic;
          const priceRounded = priceStep && priceStep.gt(0) ? this.roundDownToStep(rawPrice, priceStep) : rawPrice;

          const sizeOk = !minQty || sizeRounded.gte(minQty);

          // #region agent log
          fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: "debug-session",
              runId: "post-fix",
              hypothesisId: "H2",
              location: "packages/adapters/src/extended/execution-adapter.ts:placeOrder:rounding",
              message: "computed raw/sent vs sdk-suggested rounding",
              data: {
                symbol: request.symbol,
                sentSize: amountOfSynthetic.toString(),
                sentPrice: rawPrice.toString(),
                minQtyStep: minQtyStep?.toString(),
                minQty: minQty?.toString(),
                priceStep: priceStep?.toString(),
                roundedSize: sizeRounded.toString(),
                roundedPrice: priceRounded.toString(),
                sizeOk,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion agent log

          if (!sizeRounded.isFinite() || sizeRounded.lte(0) || !sizeOk) {
            throw new Error(
              `Invalid size after market rounding (size=${amountOfSynthetic.toString()} rounded=${sizeRounded.toString()} min=${minQty?.toString() ?? "n/a"})`,
            );
          }

          if (!priceRounded.isFinite() || priceRounded.lte(0)) {
            throw new Error(
              `Invalid price after market rounding (price=${rawPrice.toString()} rounded=${priceRounded.toString()} step=${priceStep?.toString() ?? "n/a"})`,
            );
          }

          return this.tradingClient.placeOrder({
            marketName: request.symbol,
            amountOfSynthetic: sizeRounded,
            price: priceRounded,
            side: request.side === "buy" ? ExtendedOrderSide.BUY : ExtendedOrderSide.SELL,
            postOnly: request.postOnly,
            timeInForce: request.postOnly ? TimeInForce.GTT : TimeInForce.IOC,
            expireTime: undefined,
            selfTradeProtectionLevel: SelfTradeProtectionLevel.ACCOUNT,
            externalId: request.clientOrderId,
          });
        })(),
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

      // #region agent log
      fetch("http://127.0.0.1:7247/ingest/3d58f168-0a7e-4968-9928-76ef44de0352", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "debug-session",
          runId: "post-fix",
          hypothesisId: "H3",
          location: "packages/adapters/src/extended/execution-adapter.ts:mapError",
          message: "mapped exchange error",
          data: {
            message: error.message,
            hasInvalidQtyPrecision: message.includes("invalid quantity precision"),
            hasInvalidOrderParameters: message.includes("invalid order parameters"),
            hasInvalidVault: message.includes("invalid starkex vault"),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion agent log

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

      if (message.includes("invalid starkex vault")) {
        return {
          type: "auth",
          message:
            "Invalid StarkEx vault. Check EXTENDED_NETWORK (mainnet/testnet) and EXTENDED_VAULT_ID match the API key + Stark key for that network.",
        };
      }

      if (message.includes("invalid starkex signature")) {
        return {
          type: "auth",
          message:
            "Invalid StarkEx signature. Likely EXTENDED_STARK_PRIVATE_KEY / EXTENDED_STARK_PUBLIC_KEY do not match the account (l2Key) for this API key/network.",
        };
      }

      if (message.includes("vault mismatch")) {
        return {
          type: "auth",
          message:
            "Vault mismatch between EXTENDED_VAULT_ID and account l2Vault. Set EXTENDED_VAULT_ID to the l2Vault returned by /user/account/info for this API key/network.",
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
