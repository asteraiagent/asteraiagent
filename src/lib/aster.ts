// Minimal Aster Futures API client wrapper (public v1 + signed v1/v3)
// Base: https://fapi.asterdex.com (per official docs)

const BASE_URL = process.env.NEXT_PUBLIC_ASTER_BASE_URL || "https://fapi.asterdex.com";
import { encodeAbiParameters, hexToBytes, keccak256, getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// For public endpoints nothing required.
// For signed endpoints, Aster requires EVM-style signing based on
// concatenation of sorted params + [user, signer, nonce].
// We support both the new explicit naming and a backwards-compatible mapping
// from previous fields used in UI (apiKey/apiSecret/passphrase).
export type ApiCredentials =
  | { user: string; signer: string; privateKey: `0x${string}` }
  | { apiKey: string; apiSecret: string; passphrase?: string };

type RequestInitLike = RequestInit & { headers?: Record<string, string> };

export class AsterApiError extends Error {
  status: number;
  code?: string | number;
  raw?: unknown;
  constructor(params: { message: string; status: number; code?: string | number; raw?: unknown }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.raw = params.raw;
    this.name = "AsterApiError";
  }
}

export function normalizeAsterErrorMessage(err: unknown): string {
  const text = (() => {
    if (err instanceof AsterApiError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
  })().toLowerCase();

  // Common mappings derived from typical exchange APIs
  if (text.includes("fetch failed") || text.includes("network") || text.includes("failed to fetch")) {
    return "Network error connecting to Aster. Check your internet or API base URL.";
  }
  if (text.includes("cloudfront") || text.includes("distribution is not configured") || text.includes("supports only cachable requests")) {
    return "Invalid Aster endpoint or HTTP method (403 from CloudFront). Make sure you use https://fapi.asterdex.com and the correct HTTP method.";
  }
  if (text.includes("insufficient") && text.includes("balance")) {
    return "Insufficient balance for this operation.";
  }
  if (text.includes("invalid") && (text.includes("signature") || text.includes("api key"))) {
    return "Invalid API keys or signature. Check your configuration.";
  }
  if (text.includes("rate") && text.includes("limit")) {
    return "Rate limit exceeded. Please try again later.";
  }
  if (text.includes("not found") || text.includes("unknown symbol") || text.includes("symbol does not exist")) {
    return "Trading instrument not found. Check the symbol (e.g., BTCUSDT).";
  }
  if (text.includes("maintenance") || text.includes("unavailable")) {
    return "Service temporarily unavailable. Please try again later.";
  }
  return `Aster error: ${text || "unknown error"}`;
}

async function http<T>(path: string, init: RequestInitLike = {}) {
  let res: Response;
  try {
    // Do not force content-type on plain GET requests
    const method = (init.method || "GET").toUpperCase();
    const headers = { ...(init.headers || {}) } as Record<string, string>;
    if (method !== "GET" && !headers["content-type"]) headers["content-type"] = "application/json";
    res = await fetch(`${BASE_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch (e: unknown) {
    // Normalize low-level network errors
    throw new AsterApiError({ message: normalizeAsterErrorMessage(e), status: 0 });
  }
  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    let code: string | number | undefined;
    let message = `Aster API error ${res.status}`;
    let raw: unknown = undefined;
    if (contentType.includes("application/json")) {
      try {
        const j: unknown = await res.json();
        raw = j;
        if (typeof j === "object" && j !== null) {
          const obj = j as Record<string, unknown>;
          const errObj = typeof obj.error === "object" && obj.error !== null ? (obj.error as Record<string, unknown>) : undefined;
          code = (obj.code as string | number | undefined) ?? (errObj?.code as string | number | undefined);
          const derivedMessage = (obj.message as string | undefined) ?? (obj.msg as string | undefined) ?? (errObj?.message as string | undefined);
          if (derivedMessage) message = derivedMessage;
        }
      } catch {
        // ignore json parse failure
        const t = await res.text();
        message = `${message}: ${t}`;
      }
    } else {
      const t = await res.text();
      message = `${message}: ${t}`;
    }
    throw new AsterApiError({ message, status: res.status, code, raw });
  }
  return (await res.json()) as T;
}

// Public endpoints
export const AsterPublic = {
  // Map from GET /fapi/v1/exchangeInfo → minimal market list used by UI
  markets: async () => {
    type ExchangeInfo = {
      symbols: Array<{
        symbol: string;
        status: string;
        pricePrecision: number;
      }>;
    };
    const info = await http<ExchangeInfo>("/fapi/v1/exchangeInfo");
    return (info.symbols || []).map((s) => ({
      symbol: s.symbol,
      status: s.status,
      pricePrecision: s.pricePrecision,
    }));
  },
  // Compose price from /ticker/price and mark price from /premiumIndex
  ticker: async (symbol: string) => {
    const [price, mark] = await Promise.all([
      http<{ symbol: string; price: string; time?: number }>(`/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`),
      http<
        | { symbol: string; markPrice: string }
        | Array<{ symbol: string; markPrice: string }>
      >(`/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`),
    ]);
    let markPrice: string | undefined;
    if (Array.isArray(mark)) {
      markPrice = mark.find((m) => m.symbol === symbol)?.markPrice;
    } else if (mark && typeof mark === "object" && "markPrice" in mark) {
      markPrice = (mark as { markPrice: string }).markPrice;
    }
    return { lastPrice: price.price, markPrice: markPrice ?? price.price } as { lastPrice: string; markPrice: string };
  },
  // Order book depth
  depth: async (symbol: string, limit = 50) => {
    type Depth = { bids: [string, string][]; asks: [string, string][] };
    const res = await http<Depth>(`/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
    return { bids: res.bids, asks: res.asks } as Depth;
  },
  // Server time
  time: async () => {
    return http<{ serverTime: number }>(`/fapi/v1/time`);
  },
  // Ping
  ping: async () => {
    return http<Record<string, never>>(`/fapi/v1/ping`);
  },
  // 24h stats
  stats24h: async (symbol: string) => {
    return http<Record<string, unknown>>(`/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
  },
  // Best bid/ask ticker
  bookTicker: async (symbol: string) => {
    return http<{ symbol: string; bidPrice: string; bidQty: string; askPrice: string; askQty: string; time?: number }>(
      `/fapi/v1/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`
    );
  },
  // Funding rate history (last N)
  fundingRate: async (symbol: string, limit = 20) => {
    return http<Array<{ symbol: string; fundingRate: string; fundingTime: number }>>(
      `/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
    );
  },
  // Klines
  klines: async (symbol: string, interval = "1h", limit = 50) => {
    return http<unknown>(`/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`);
  },
};

// Utilities for signing
function toHexPrefixed(input: string): `0x${string}` {
  const trimmed = (input || "").trim();
  const hex = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  return hex.toLowerCase() as `0x${string}`;
}

function normalizeAuth(creds: ApiCredentials): { user: `0x${string}`; signer: `0x${string}`; privateKey: `0x${string}` } {
  // Direct form (explicit fields)
  if ("user" in creds && "signer" in creds && "privateKey" in creds) {
    const c = creds as { user: string; signer: string; privateKey: `0x${string}` };
    const userAddr = getAddress(toHexPrefixed(c.user));
    const signerAddr = getAddress(toHexPrefixed(c.signer));
    const pk = toHexPrefixed(c.privateKey);
    return { user: userAddr as `0x${string}`, signer: signerAddr as `0x${string}`, privateKey: pk };
  }

  // Back-compat: { apiKey, apiSecret, passphrase }
  const b = creds as { apiKey: string; apiSecret: string; passphrase?: string };

  const looksPk = (v?: string) => !!v && /^0x?[0-9a-fA-F]{64}$/.test(v.trim());
  const looksAddr = (v?: string) => !!v && isAddress(v.trim() as `0x${string}`);

  // Resolve private key priority: passphrase > apiSecret > apiKey
  let privateKey: `0x${string}` | null = null;
  if (looksPk(b.passphrase)) privateKey = toHexPrefixed(b.passphrase!);
  else if (looksPk(b.apiSecret)) privateKey = toHexPrefixed(b.apiSecret);
  else if (looksPk(b.apiKey)) privateKey = toHexPrefixed(b.apiKey);

  // Resolve signer address: explicit address or derived from private key
  let signer: `0x${string}` | null = null;
  if (looksAddr(b.apiSecret)) signer = getAddress(toHexPrefixed(b.apiSecret)) as `0x${string}`;
  else if (privateKey) signer = (privateKeyToAccount(privateKey).address as `0x${string}`);

  // Resolve user address: explicit address, or derive from apiKey/privateKey, or fallback to signer
  let user: `0x${string}` | null = null;
  if (looksAddr(b.apiKey)) user = getAddress(toHexPrefixed(b.apiKey)) as `0x${string}`;
  else if (looksPk(b.apiKey)) user = (privateKeyToAccount(toHexPrefixed(b.apiKey)).address as `0x${string}`);
  else if (signer) user = signer;

  if (!privateKey || !signer || !user) {
    throw new Error("Aster credentials invalid: provide addresses for user/signer or a private key to derive them.");
  }
  return { user, signer, privateKey };
}

function ensureHexAddress(addr: string): `0x${string}` {
  // Return a checksummed 0x-prefixed address; throws if invalid
  return getAddress(toHexPrefixed(addr)) as `0x${string}`;
}

function toMicroseconds(nowMs: number): bigint {
  // Avoid BigInt literal for older TS targets
  return BigInt(Math.trunc(nowMs * 1000));
}

function stringifyAndSort(input: Record<string, unknown>): string {
  // Convert all values to strings, remove null/undefined, sort keys asc
  const clone: Record<string, string> = {};
  Object.keys(input).forEach((k) => {
    const v = input[k];
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      // stringify recursively
      const arr = v.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)));
      clone[k] = JSON.stringify(arr);
      return;
    }
    if (typeof v === "object") {
      clone[k] = JSON.stringify(v);
      return;
    }
    clone[k] = String(v);
  });
  return JSON.stringify(Object.fromEntries(Object.entries(clone).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))).replace(/\s+/g, "").replace(/'/g, '"');
}

function formEncode(obj: Record<string, string | number | boolean>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

async function signedParams(params: Record<string, unknown>, creds: ApiCredentials) {
  const { user, signer, privateKey } = normalizeAuth(creds);
  const now = Date.now();
  const timestamp = now;
  const recvWindow = 50000;
  const business = { ...params, recvWindow, timestamp } as Record<string, unknown>;
  const nonce = toMicroseconds(now);
  const jsonStr = stringifyAndSort(business);

  const encoded = encodeAbiParameters(
    [
      { type: "string" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
    ],
    [jsonStr, ensureHexAddress(user), ensureHexAddress(signer), nonce]
  );
  const keccak = keccak256(encoded);
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signMessage({ message: { raw: hexToBytes(keccak) } });

  return {
    ...business,
    nonce: nonce.toString(),
    user: ensureHexAddress(user),
    signer: ensureHexAddress(signer),
    signature,
  } as Record<string, string>;
}

// Authenticated endpoints
export class AsterPrivate {
  constructor(private creds: ApiCredentials) {}

  private async send<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown>): Promise<T> {
    const payload = await signedParams(params, this.creds);
    const url = `${BASE_URL}${path}`;
    if (method === "GET" || method === "DELETE") {
      const qs = formEncode(payload);
      const res = await fetch(`${url}?${qs}`, { method, headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        throw new AsterApiError({ message: text || `HTTP ${res.status}`, status: res.status });
      }
      return (await res.json()) as T;
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formEncode(payload),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new AsterApiError({ message: text || `HTTP ${res.status}`, status: res.status });
    }
    return (await res.json()) as T;
  }

  async getBalances() {
    return this.send<unknown>("GET", "/fapi/v3/balance", {});
  }

  async accountInfo() {
    return this.send<unknown>("GET", "/fapi/v3/account", {});
  }

  async positionInfo(symbol?: string) {
    const params: Record<string, unknown> = {};
    if (symbol) params.symbol = symbol;
    return this.send<unknown>("GET", "/fapi/v3/positionRisk", params);
  }

  async openOrders(symbol?: string) {
    const params: Record<string, unknown> = {};
    if (symbol) params.symbol = symbol;
    return this.send<unknown>("GET", "/fapi/v1/openOrders", params);
  }

  async placeOrder(input: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT" | "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET" | "TRAILING_STOP_MARKET";
    timeInForce?: "GTC" | "IOC" | "FOK" | "GTX";
    quantity?: string;
    price?: string;
    stopPrice?: string;
    positionSide?: "BOTH" | "LONG" | "SHORT";
    reduceOnly?: "true" | "false";
    closePosition?: "true" | "false";
    activationPrice?: string;
    callbackRate?: string;
    workingType?: "MARK_PRICE" | "CONTRACT_PRICE";
    priceProtect?: "TRUE" | "FALSE";
    newOrderRespType?: "ACK" | "RESULT";
  }) {
    // Map to API params
    const params: Record<string, unknown> = { ...input };
    if (("quantity" in params ? !params.quantity : true) && "size" in input) {
      const maybeSize = (input as { size?: string }).size;
      if (maybeSize) params.quantity = maybeSize;
    }
    return this.send<unknown>("POST", "/fapi/v3/order", params);
  }

  async getOrder(params: { symbol: string; orderId?: string; origClientOrderId?: string }) {
    return this.send<unknown>("GET", "/fapi/v3/order", params);
  }

  async cancelOrder(params: { symbol: string; orderId?: string; origClientOrderId?: string }) {
    return this.send<unknown>("DELETE", "/fapi/v1/order", params);
  }

  async cancelAll(symbol: string) {
    return this.send<unknown>("DELETE", "/fapi/v1/allOpenOrders", { symbol });
  }

  async setLeverage(symbol: string, leverage: number) {
    return this.send<unknown>("POST", "/fapi/v1/leverage", { symbol, leverage });
  }

  async setMarginType(symbol: string, marginType: "ISOLATED" | "CROSSED") {
    return this.send<unknown>("POST", "/fapi/v1/marginType", { symbol, marginType });
  }
}

export const QuickActions = [
  { key: "markets", title: "Markets", prompt: "List available markets (symbols) and their status." },
  { key: "price-btc", title: "Price", prompt: "Show last and mark price for BTCUSDT." },
  { key: "depth-btc", title: "Order book", prompt: "Show order book (depth 20) for BTCUSDT." },
  { key: "price-eth", title: "Price ETH", prompt: "Show last and mark price for ETHUSDT." },
  { key: "book-btc", title: "Bid/Ask", prompt: "Show best bid and ask for BTCUSDT." },
  { key: "24h-btc", title: "24h stats", prompt: "Show 24h ticker stats for BTCUSDT." },
  { key: "fund-btc", title: "Funding", prompt: "Show latest funding rate history for BTCUSDT." },
  { key: "klines-btc", title: "1h klines", prompt: "Show last 50 1h klines for BTCUSDT." },
];


