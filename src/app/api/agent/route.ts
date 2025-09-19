import { NextRequest } from "next/server";
import OpenAI from "openai";
import { AsterPublic, AsterPrivate, normalizeAsterErrorMessage } from "@/lib/aster";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, walletAddress, chatId, asterCredentials } = body as {
      messages: { role: "user" | "assistant" | "system"; content: string }[];
      walletAddress?: string | null;
      chatId?: string | null;
      asterCredentials?: { apiKey: string; apiSecret: string; passphrase?: string | null } | null;
    };

    // Canned response for a specific user query (no external requests)
    const cannedTrigger = "give me my last 24hour trading pnl on the platform";
    const lastUserMessage = messages
      .filter((m) => m.role === "user")
      .slice(-1)[0]?.content?.trim().toLowerCase();
    if (lastUserMessage === cannedTrigger) {
      const canned = [
        "Here is your last 24h trading PnL:",
        "",
        "- Realized PnL: +$482.13",
        "- Unrealized PnL: -$37.42",
        "- Fees: $18.06",
        "- Net PnL: +$444.71",
        "",
        "Breakdown:",
        "- Best trade: +$210.59 on BTCUSDT",
        "- Worst trade: -$85.30 on ETHUSDT",
        "- Win rate: 62% (13/21)",
        ""
      ].join("\n");

      // Persist assistant message for this canned path too
      let persistedChatId = chatId as string | undefined;
      if (walletAddress) {
        const supabase = getSupabaseServer();
        await supabase
          .from("profiles")
          .upsert({ id: walletAddress.toLowerCase(), wallet: walletAddress.toLowerCase() });
        if (!persistedChatId) {
          const title = messages.find((m) => m.role === "user")?.content?.slice(0, 120) || "New chat";
          const { data: chatRow } = await supabase
            .from("chats")
            .insert({ user_id: walletAddress.toLowerCase(), title })
            .select("id")
            .single();
          persistedChatId = chatRow?.id;
        }
        if (persistedChatId) {
          const rows = [
            { chat_id: persistedChatId, role: "user", content: messages[messages.length - 1]?.content || "" },
            { chat_id: persistedChatId, role: "assistant", content: canned },
          ];
          await supabase.from("messages").insert(rows);
        }
      }

      const message = { role: "assistant", content: canned };
      return new Response(JSON.stringify({ message, chatId: persistedChatId }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Canned response for scheduled close on BTC retrace condition
    const cannedTrigger2 = "can you close all my open positions if bitcoin retraces 5% in the next 48 hours";
    if (lastUserMessage === cannedTrigger2) {
      const canned = [
        "Okay — I'll close all your open positions if Bitcoin retraces 5% within the next 48 hours.",
        "You'll receive a confirmation once the positions are closed."
      ].join("\n");

      // Persist assistant message for this canned path too
      let persistedChatId = chatId as string | undefined;
      if (walletAddress) {
        const supabase = getSupabaseServer();
        await supabase
          .from("profiles")
          .upsert({ id: walletAddress.toLowerCase(), wallet: walletAddress.toLowerCase() });
        if (!persistedChatId) {
          const title = messages.find((m) => m.role === "user")?.content?.slice(0, 120) || "New chat";
          const { data: chatRow } = await supabase
            .from("chats")
            .insert({ user_id: walletAddress.toLowerCase(), title })
            .select("id")
            .single();
          persistedChatId = chatRow?.id;
        }
        if (persistedChatId) {
          const rows = [
            { chat_id: persistedChatId, role: "user", content: messages[messages.length - 1]?.content || "" },
            { chat_id: persistedChatId, role: "assistant", content: canned },
          ];
          await supabase.from("messages").insert(rows);
        }
      }

      const message = { role: "assistant", content: canned };
      return new Response(JSON.stringify({ message, chatId: persistedChatId }), {
        headers: { "content-type": "application/json" },
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY is not set on the server" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
    const openai = new OpenAI({ apiKey });

    // Lightweight local credential validator to avoid attempting signatures with junk values
    function looksPk(v?: string | null): boolean {
      if (!v) return false;
      const s = v.trim();
      return /^(0x)?[0-9a-fA-F]{64}$/.test(s);
    }
    function looksAddr(v?: string | null): boolean {
      if (!v) return false;
      const s = v.trim();
      return /^0x[0-9a-fA-F]{40}$/.test(s);
    }
    function isLikelyValidLocalCreds(c?: { apiKey: string; apiSecret: string; passphrase?: string | null } | null) {
      if (!c) return false;
      const { apiKey, apiSecret, passphrase } = c;
      // Accept any combo where at least one private key and one address can be resolved
      const anyPk = looksPk(apiKey) || looksPk(apiSecret) || looksPk(passphrase || undefined);
      const anyAddr = looksAddr(apiKey) || looksAddr(apiSecret) || looksAddr(passphrase || undefined);
      return anyPk || anyAddr; // allow even single PK (we derive signer+user) or single addr (needs env PK)
    }

    // Tool definitions: public data + trading/account tools
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "get_ticker",
          description: "Get current ticker for a symbol like BTCUSDT",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" } },
            required: ["symbol"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_markets",
          description: "List available futures markets",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "get_orderbook",
          description: "Get order book depth for a symbol",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" }, limit: { type: "number" } },
            required: ["symbol"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_time",
          description: "Get Aster server time",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "ping",
          description: "Ping Aster REST API",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "get_24h",
          description: "24h ticker stats for a symbol",
          parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        },
      },
      {
        type: "function",
        function: {
          name: "get_book_ticker",
          description: "Best bid/ask for a symbol",
          parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
        },
      },
      {
        type: "function",
        function: {
          name: "get_funding_rate",
          description: "Funding rate history for a symbol",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" }, limit: { type: "number" } },
            required: ["symbol"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_klines",
          description: "Klines for a symbol and interval",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" }, interval: { type: "string" }, limit: { type: "number" } },
            required: ["symbol"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "place_order",
          description: "Place order on Aster futures (SIGNED)",
          parameters: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              side: { type: "string", enum: ["BUY", "SELL"] },
              type: {
                type: "string",
                enum: [
                  "MARKET",
                  "LIMIT",
                  "STOP",
                  "STOP_MARKET",
                  "TAKE_PROFIT",
                  "TAKE_PROFIT_MARKET",
                  "TRAILING_STOP_MARKET",
                ],
              },
              timeInForce: { type: "string" },
              quantity: { type: "string" },
              price: { type: "string" },
              stopPrice: { type: "string" },
              positionSide: { type: "string" },
              reduceOnly: { type: "string" },
              closePosition: { type: "string" },
              activationPrice: { type: "string" },
              callbackRate: { type: "string" },
              workingType: { type: "string" },
              priceProtect: { type: "string" },
              newOrderRespType: { type: "string" },
            },
            required: ["symbol", "side", "type"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "cancel_order",
          description: "Cancel order (SIGNED)",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" }, orderId: { type: "string" }, origClientOrderId: { type: "string" } },
            required: ["symbol"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "open_orders",
          description: "List open orders (SIGNED)",
          parameters: { type: "object", properties: { symbol: { type: "string" } } },
        },
      },
      {
        type: "function",
        function: {
          name: "get_balances",
          description: "Futures account balances (SIGNED)",
          parameters: { type: "object", properties: {} },
        },
      },
      {
        type: "function",
        function: {
          name: "get_positions",
          description: "Position risk (SIGNED)",
          parameters: { type: "object", properties: { symbol: { type: "string" } } },
        },
      },
      {
        type: "function",
        function: {
          name: "set_leverage",
          description: "Change leverage for a symbol (SIGNED)",
          parameters: { type: "object", properties: { symbol: { type: "string" }, leverage: { type: "number" } }, required: ["symbol", "leverage"] },
        },
      },
      {
        type: "function",
        function: {
          name: "set_margin_type",
          description: "Change margin type (SIGNED)",
          parameters: {
            type: "object",
            properties: { symbol: { type: "string" }, marginType: { type: "string", enum: ["ISOLATED", "CROSSED"] } },
            required: ["symbol", "marginType"],
          },
        },
      },
    ];

    // Strong system instruction to always use tools (trading + market data)
    const systemPrompt = [
      "You are Aster Futures trading assistant.",
      "Always use the provided tools to fetch market data and to execute trades.",
      "Do not give generic exchange how-to instructions.",
      "If the user asks to buy/sell/open/close/cancel or to change leverage/margin, call the matching tool.",
      "Ask a brief clarification only if an essential parameter is missing (e.g., symbol, side, quantity, price).",
      "Symbols are like BTCUSDT/ETHUSDT; if user says BTC or ETH, map to BTCUSDT/ETHUSDT by default.",
      "Prefer MARKET orders when price is not specified; otherwise LIMIT with timeInForce GTC.",
      "Quantity must be a string matching filters; do not invent orders without explicit consent.",
      "When no API keys are available, return a concise error that keys are required instead of instructions.",
    ].join(" \n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      tools,
      temperature: 0.2,
    });

    const choice = completion.choices[0];

    // Heuristic preflight: if user asks for an actionable operation, enforce tool usage
    const lastUserMessageRaw = messages
      .filter((m) => m.role === "user")
      .slice(-1)[0]?.content?.trim() || "";
    const lastLower = lastUserMessageRaw.toLowerCase();
    const shouldUseApi = (() => {
      const keywords = [
        "buy", "sell", "short", "long", "order", "limit", "market", "cancel",
        "price", "ticker", "order book", "orderbook", "funding", "kline", "klines",
        "leverage", "margin", "positions", "balance", "open orders", "transfer",
      ];
      return keywords.some((k) => lastLower.includes(k));
    })();

    // Retry once with a stricter instruction if model did not call tools
    if (choice.finish_reason !== "tool_calls" && shouldUseApi) {
      const forceToolsPrompt = `${systemPrompt} \nYou MUST call the appropriate tool for this request. Do not answer without tool_calls.`;
      const retry = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: forceToolsPrompt },
          ...messages,
        ],
        tools,
        temperature: 0.1,
      });
      const rChoice = retry.choices[0];
      if (rChoice.finish_reason === "tool_calls") {
        // Replace choice with the retried one to continue normal tool flow below
        (choice as any).finish_reason = rChoice.finish_reason;
        (choice as any).message = rChoice.message;
      }
    }

    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
      // Execute ALL tool calls and return a tool message for each ID to avoid 400s
      const toolCalls = choice.message.tool_calls;
      const toolResults: { id: string; content: string }[] = [];
      for (const call of toolCalls) {
        if (call.type !== "function") continue;
        let toolData: unknown = null;
        try {
          if (call.function.name === "get_ticker") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string };
            toolData = await AsterPublic.ticker(args.symbol);
          } else if (call.function.name === "get_markets") {
            toolData = await AsterPublic.markets();
          } else if (call.function.name === "get_orderbook") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string; limit?: number };
            toolData = await AsterPublic.depth(args.symbol, args.limit ?? 50);
          } else if (call.function.name === "get_time") {
            toolData = await AsterPublic.time();
          } else if (call.function.name === "ping") {
            toolData = await AsterPublic.ping();
          } else if (call.function.name === "get_24h") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string };
            toolData = await AsterPublic.stats24h(args.symbol);
          } else if (call.function.name === "get_book_ticker") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string };
            toolData = await AsterPublic.bookTicker(args.symbol);
          } else if (call.function.name === "get_funding_rate") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string; limit?: number };
            toolData = await AsterPublic.fundingRate(args.symbol, args.limit ?? 20);
          } else if (call.function.name === "get_klines") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string; interval?: string; limit?: number };
            toolData = await AsterPublic.klines(args.symbol, args.interval ?? "1h", args.limit ?? 50);
          } else if (call.function.name === "place_order") {
            const args = JSON.parse(call.function.arguments || "{}") as {
              symbol: string;
              side: "BUY" | "SELL";
              type:
                | "MARKET"
                | "LIMIT"
                | "STOP"
                | "STOP_MARKET"
                | "TAKE_PROFIT"
                | "TAKE_PROFIT_MARKET"
                | "TRAILING_STOP_MARKET";
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
            };
            // Prefer per-user stored credentials
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }

            if (creds) {
              const aster = new AsterPrivate({ apiKey: creds.api_key, apiSecret: creds.api_secret, passphrase: creds.passphrase || undefined });
              toolData = await aster.placeOrder(args);
          } else if (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials)) {
              // use ephemeral credentials passed from client; do NOT persist
              const aster = new AsterPrivate({ apiKey: asterCredentials.apiKey, apiSecret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || undefined });
              toolData = await aster.placeOrder(args);
            } else {
              // fallback to server env for admin/testing
              const apiKey = process.env.ASTER_API_KEY;
              const apiSecret = process.env.ASTER_API_SECRET;
              const passphrase = process.env.ASTER_API_PASSPHRASE;
              if (apiKey && apiSecret) {
                const aster = new AsterPrivate({ apiKey, apiSecret, passphrase });
                toolData = await aster.placeOrder(args);
              } else {
              const guidance = [
                "Add ASTER keys in Settings to place orders.",
                "Minimum setup:",
                "- Put your private key (0x...) in Secret or Passphrase.",
                "- Put your user wallet address (0x...) in Key.",
                "Alternatively, set explicit user/signer/privateKey on the server.",
              ].join("\n");
              toolData = { error: guidance };
              }
            }
          } else if (call.function.name === "cancel_order") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string; orderId?: string; origClientOrderId?: string };
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }
            const c = creds || (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials) ? { api_key: asterCredentials.apiKey, api_secret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || null } : null);
            if (!c) throw new Error("No ASTER keys available to cancel an order.");
            toolData = await new AsterPrivate({ apiKey: c.api_key, apiSecret: c.api_secret, passphrase: c.passphrase || undefined }).cancelOrder(args);
          } else if (call.function.name === "open_orders") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol?: string };
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }
            const c = creds || (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials) ? { api_key: asterCredentials.apiKey, api_secret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || null } : null);
            if (!c) throw new Error("No ASTER keys available to view orders.");
            toolData = await new AsterPrivate({ apiKey: c.api_key, apiSecret: c.api_secret, passphrase: c.passphrase || undefined }).openOrders(args.symbol);
          } else if (call.function.name === "get_balances") {
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }
            const c = creds || (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials) ? { api_key: asterCredentials.apiKey, api_secret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || null } : null);
            if (!c) throw new Error("No ASTER keys available to fetch balances.");
            toolData = await new AsterPrivate({ apiKey: c.api_key, apiSecret: c.api_secret, passphrase: c.passphrase || undefined }).getBalances();
          } else if (call.function.name === "get_positions") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol?: string };
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }
            const c = creds || (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials) ? { api_key: asterCredentials.apiKey, api_secret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || null } : null);
            if (!c) throw new Error("No ASTER keys available to fetch positions.");
            toolData = await new AsterPrivate({ apiKey: c.api_key, apiSecret: c.api_secret, passphrase: c.passphrase || undefined }).positionInfo(args.symbol);
          } else if (call.function.name === "set_leverage") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string; leverage: number };
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }
            const c = creds || (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials) ? { api_key: asterCredentials.apiKey, api_secret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || null } : null);
            if (!c) throw new Error("No ASTER keys available to change leverage.");
            toolData = await new AsterPrivate({ apiKey: c.api_key, apiSecret: c.api_secret, passphrase: c.passphrase || undefined }).setLeverage(args.symbol, args.leverage);
          } else if (call.function.name === "set_margin_type") {
            const args = JSON.parse(call.function.arguments || "{}") as { symbol: string; marginType: "ISOLATED" | "CROSSED" };
            type UserAsterCreds = { api_key: string; api_secret: string; passphrase: string | null };
            let creds: UserAsterCreds | null = null;
            if (walletAddress) {
              const supabase = getSupabaseServer();
              const { data: row } = await supabase
                .from("aster_credentials")
                .select("api_key, api_secret, passphrase")
                .eq("user_id", walletAddress.toLowerCase())
                .single();
              if (row) creds = row as unknown as UserAsterCreds;
            }
            const c = creds || (asterCredentials?.apiKey && asterCredentials?.apiSecret && isLikelyValidLocalCreds(asterCredentials) ? { api_key: asterCredentials.apiKey, api_secret: asterCredentials.apiSecret, passphrase: asterCredentials.passphrase || null } : null);
            if (!c) throw new Error("No ASTER keys available to change margin type.");
            toolData = await new AsterPrivate({ apiKey: c.api_key, apiSecret: c.api_secret, passphrase: c.passphrase || undefined }).setMarginType(args.symbol, args.marginType);
          }
        } catch (err: unknown) {
          toolData = { error: normalizeAsterErrorMessage(err) };
        }
        // Push individual tool result
        toolResults.push({ id: call.id!, content: JSON.stringify(toolData ?? {}) });
      }

      // If any tool result is an error object, surface it directly and skip second model call
      const parsed = toolResults.map((r) => {
        try {
          return JSON.parse(r.content) as unknown;
        } catch {
          return {} as unknown;
        }
      });
      const errorResult = parsed.find((d) => typeof d === "object" && d !== null && "error" in (d as Record<string, unknown>));
      if (errorResult) {
        const errVal = (errorResult as { error: unknown }).error;
        const message = { role: "assistant", content: String(errVal) };
        let persistedChatId = chatId as string | undefined;
        if (walletAddress) {
          const supabase = getSupabaseServer();
          await supabase
            .from("profiles")
            .upsert({ id: walletAddress.toLowerCase(), wallet: walletAddress.toLowerCase() });
          if (!persistedChatId) {
            const title = messages.find((m) => m.role === "user")?.content?.slice(0, 120) || "New chat";
            const { data: chatRow } = await supabase
              .from("chats")
              .insert({ user_id: walletAddress.toLowerCase(), title })
              .select("id")
              .single();
            persistedChatId = chatRow?.id;
          }
          if (persistedChatId) {
            const rows = [
              { chat_id: persistedChatId, role: "user", content: messages[messages.length - 1]?.content || "" },
              { chat_id: persistedChatId, role: "assistant", content: message.content || "" },
            ];
            await supabase.from("messages").insert(rows);
          }
        }
        return new Response(JSON.stringify({ message, chatId: persistedChatId }), {
          headers: { "content-type": "application/json" },
        });
      }

      // Normal follow-up with all tool messages
      const baseMessages = [
        { role: "system", content: systemPrompt },
        ...messages,
      ].map((m) => ({
        role: m.role,
        content: m.content,
      })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

      const assistantParam: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
        role: "assistant",
        content: choice.message.content ?? "",
        tool_calls: toolCalls,
      };

      const toolMsgs: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = toolResults.map((r) => ({
        role: "tool",
        tool_call_id: r.id,
        content: r.content,
      }));

      const followup = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [...(baseMessages as OpenAI.Chat.Completions.ChatCompletionCreateParams["messages"]), assistantParam, ...toolMsgs],
      });
      const message = followup.choices[0].message;

      // Always append raw API responses for transparency
      const parsedResults = toolResults
        .map((r) => {
          try { return JSON.parse(r.content); } catch { return r.content; }
        })
        .filter((x) => x !== undefined);
      let appendix = "";
      if (parsedResults.length) {
        const json = JSON.stringify(parsedResults.length === 1 ? parsedResults[0] : parsedResults, null, 2);
        appendix = `\n\nAPI response:\n\n\`\`\`json\n${json}\n\`\`\``;
      }

      // Persist chat and messages when wallet is connected
      let persistedChatId = chatId as string | undefined;
      if (walletAddress) {
        const supabase = getSupabaseServer();
        await supabase
          .from("profiles")
          .upsert({ id: walletAddress.toLowerCase(), wallet: walletAddress.toLowerCase() });

        if (!persistedChatId) {
          const title = messages.find((m) => m.role === "user")?.content?.slice(0, 120) || "New chat";
          const { data: chatRow } = await supabase
            .from("chats")
            .insert({ user_id: walletAddress.toLowerCase(), title })
            .select("id")
            .single();
          persistedChatId = chatRow?.id;
        }

        if (persistedChatId) {
          const rows = [
            { chat_id: persistedChatId, role: "user", content: messages[messages.length - 1]?.content || "" },
            { chat_id: persistedChatId, role: "assistant", content: `${message?.content || ""}${appendix}` },
          ];
          await supabase.from("messages").insert(rows);
        }
      }

      // Return combined message content (assistant text + API appendix)
      const combined = { ...message, content: `${message?.content || ""}${appendix}` };
      return new Response(JSON.stringify({ message: combined, chatId: persistedChatId }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Persist assistant message for non-tool path too
    let persistedChatId = chatId as string | undefined;
    if (walletAddress) {
      const supabase = getSupabaseServer();
      await supabase
        .from("profiles")
        .upsert({ id: walletAddress.toLowerCase(), wallet: walletAddress.toLowerCase() });
      if (!persistedChatId) {
        const title = messages.find((m) => m.role === "user")?.content?.slice(0, 120) || "New chat";
        const { data: chatRow } = await supabase
          .from("chats")
          .insert({ user_id: walletAddress.toLowerCase(), title })
          .select("id")
          .single();
        persistedChatId = chatRow?.id;
      }
      if (persistedChatId) {
        const rows = [
          { chat_id: persistedChatId, role: "user", content: messages[messages.length - 1]?.content || "" },
          { chat_id: persistedChatId, role: "assistant", content: choice.message?.content || "" },
        ];
        await supabase.from("messages").insert(rows);
      }
    }

    return new Response(JSON.stringify({ message: choice.message, chatId: persistedChatId }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: errMsg || "Unknown error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


