"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { QuickActions } from "@/lib/aster";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { cn } from "@/lib/cn";
import { useAccount } from "wagmi";

type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatListItem = { id: string; title: string | null; created_at: string };

// removed helper; we rely on wagmi's useAccount

export default function Chat() {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "history">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [showApiKeyNotice, setShowApiKeyNotice] = useState(false);
  const [copiedCA, setCopiedCA] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { address, isConnected } = useAccount();
  const missingAsterCreds = !(apiKey && apiSecret);
  const CONTRACT_ADDRESS = "XXXXXXXXXXXXXXXXXX";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Avoid SSR/CSR mismatch for wallet connection dependent UI
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load local settings
  useEffect(() => {
    if (!mounted) return;
    try {
      const k = localStorage.getItem("aster_api_key") || "";
      const s = localStorage.getItem("aster_api_secret") || "";
      const p = localStorage.getItem("aster_passphrase") || "";
      setApiKey(k);
      setApiSecret(s);
      setPassphrase(p);
    } catch {}
  }, [mounted]);

  // No server creds probing; we store only locally

  function saveLocalCreds() {
    try {
      localStorage.setItem("aster_api_key", apiKey);
      localStorage.setItem("aster_api_secret", apiSecret);
      localStorage.setItem("aster_passphrase", passphrase);
    } catch {}
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 1500);
  }

  // Removed server credentials flow: keys are only stored locally

  // Load dismissal state for the API key notice
  useEffect(() => {
    if (!mounted) return;
    try {
      const dismissed = localStorage.getItem("aster_api_banner_dismissed") === "1";
      if (dismissed) setShowApiKeyNotice(false);
    } catch {}
  }, [mounted]);

  function timeAgo(iso: string): string {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diff = Math.max(0, Math.floor((now - then) / 1000));
    if (diff < 60) return `${diff}s ago`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  const fetchChats = useCallback(async () => {
    if (!mounted || !isConnected || !address) return;
    setLoadingChats(true);
    try {
      const res = await fetch(`/api/chats?wallet=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (Array.isArray(data.chats)) setChats(data.chats as ChatListItem[]);
    } catch {}
    setLoadingChats(false);
  }, [mounted, isConnected, address]);

  async function openChat(chatId: string) {
    if (!address) return;
    try {
      const res = await fetch(`/api/messages?wallet=${encodeURIComponent(address)}&chatId=${encodeURIComponent(chatId)}`);
      const data = await res.json();
      const msgs: ChatMessage[] = Array.isArray(data.messages)
        ? (data.messages as { role: "user" | "assistant"; content: string }[]).map((m) => ({ role: m.role, content: m.content }))
        : [];
      setMessages(msgs);
      (globalThis as { __chatId?: string | null }).__chatId = chatId;
      setActiveTab("chat");
    } catch {}
  }

  // Load chats when wallet connects or when switching to history
  useEffect(() => {
    if (activeTab === "history") void fetchChats();
  }, [activeTab, fetchChats]);

  async function send(content: string) {
    const userCountBefore = messages.filter((m) => m.role === "user").length;
    const isFirstUserMessage = userCountBefore === 0;
    const newMessages = [...messages, { role: "user", content } as ChatMessage];
    setMessages(newMessages);
    // Show notice after the first user message if keys are missing and not dismissed
    if (isFirstUserMessage) {
      const dismissed = (() => {
        try {
          return localStorage.getItem("aster_api_banner_dismissed") === "1";
        } catch {
          return false;
        }
      })();
      if (!dismissed && !(apiKey && apiSecret)) setShowApiKeyNotice(true);
    }
    setLoading(true);
    try {
      // Include local credentials when present (we do not store them on server)
      const asterCredentials = apiKey && apiSecret ? { apiKey, apiSecret, passphrase: passphrase || undefined } : null;
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          walletAddress: address || null,
          chatId: (globalThis as { __chatId?: string | null }).__chatId || null,
          asterCredentials,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(text || `Unexpected response: ${res.status}`);
      }
      const data = await res.json();
      const text = data.message?.content || data.error || "Response error";
      setMessages((m) => [...m, { role: "assistant", content: text }]);
      const prevChatId = (globalThis as { __chatId?: string | null }).__chatId || null;
      if (data.chatId) (globalThis as { __chatId?: string | null }).__chatId = data.chatId as string;
      // If a new chat was created on send, refresh history
      if (!prevChatId && data.chatId) {
        void fetchChats();
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Error: ${errMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSendFromComposer() {
    const value = input.trim();
    if (!value) return;
    setInput("");
    void send(value);
  }

  function fillPrompt(text: string) {
    setInput(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  return (
    <div className="min-h-screen w-full bg-[#0c0c0c] text-[#eaeaea]">
      <div className="flex w-full min-h-screen">
        {mounted && isConnected ? (
          <aside className="hidden sm:flex sm:flex-col sm:w-16 border-r border-[#1f1f1f] bg-[#0a0a0a] items-center py-6 gap-6">
            <img src="/logo.png" alt="Aster" className="h-10 w-10" />
            <div className="h-px w-8 bg-[#1f1f1f]" />
            <button onClick={() => setActiveTab("chat")} className="w-10 h-10 rounded-lg bg-[#151515] border border-[#242424] text-xl">🏠</button>
            <button onClick={() => setActiveTab("history")} className="w-10 h-10 rounded-lg bg-[#151515] border border-[#242424] text-xl">💬</button>
            <div className="relative">
              <button onClick={() => setSettingsOpen((v) => !v)} className="w-10 h-10 rounded-lg bg-[#151515] border border-[#242424] text-xl">⚙️</button>
              {missingAsterCreds && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[#ef4444] border border-[#0a0a0a]" />
              )}
            </div>
          </aside>
        ) : null}

        <div className="flex-1 flex flex-col items-center">
          <header className="w-full flex items-center justify-between pt-6 pb-2 px-6">
            <nav className="flex items-center gap-4">
              <a
                href="https://discord.gg/QYJsuNJ7"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord"
                className="text-[#a6a6a6] hover:text-white transition-colors"
              >
                <img src="/discord.svg" alt="Discord" className="h-6 w-6 sm:h-7 sm:w-7 opacity-90 hover:opacity-100" />
              </a>
              <a
                href="https://github.com/agent-aster"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="text-[#a6a6a6] hover:text-white transition-colors"
              >
                <img src="/github.svg" alt="GitHub" className="h-6 w-6 sm:h-7 sm:w-7 opacity-90 hover:opacity-100" />
              </a>
              <a
                href="https://x.com/agentaster"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
                className="text-[#a6a6a6] hover:text-white transition-colors"
              >
                <img src="/x.svg" alt="X" className="h-6 w-6 sm:h-7 sm:w-7 opacity-90 hover:opacity-100" />
              </a>
            </nav>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(CONTRACT_ADDRESS);
                    setCopiedCA(true);
                    setTimeout(() => setCopiedCA(false), 1500);
                  } catch {}
                }}
                className="rounded-md border border-[#2a2a2a] px-2 py-1 text-[11px] text-[#a6a6a6] hover:text-white hover:border-[#3a3a3a] transition"
                aria-label="Copy contract address"
                title="Copy contract address"
              >
                {copiedCA ? "Copied" : `CA: ${CONTRACT_ADDRESS}`}
              </button>
              <ConnectButton chainStatus="none" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "full" }} />
            </div>
          </header>

          <main className="w-full max-w-4xl flex-1 px-6 pb-12">
            <div className="flex flex-col items-center">
              <div className="mt-2 mb-6">
                <div className="flex gap-10 items-center text-sm">
                  <button
                    className={cn(
                      "px-1 pb-1 text-[#a6a6a6]",
                      activeTab === "chat" && "text-white border-b-2 border-[#f2b46d]"
                    )}
                    onClick={() => setActiveTab("chat")}
                  >
                    Chat
                  </button>
                  <button
                    className={cn(
                      "px-1 pb-1 text-[#a6a6a6]",
                      activeTab === "history" && "text-white border-b-2 border-[#f2b46d]"
                    )}
                    onClick={() => setActiveTab("history")}
                  >
                    History
                  </button>
                </div>
              </div>

              {activeTab === "chat" && (
                <>
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="relative">
                      <div className="absolute inset-0 rounded-full blur-3xl bg-[#35567a]/20" />
                      <div className="relative rounded-2xl bg-[#0f0f0f] border border-[#1f1f1f] p-6">
                        <img src="/logo.png" alt="Aster Logo" className="h-24 w-24" />
                      </div>
                    </div>
                    <h1 className="mt-5 text-2xl font-semibold text-white">
                      Chat with{" "}
                      <span className="inline-flex items-start gap-2 align-top">
                        <span className="text-[#f2b46d]">Aster Ai Agent</span>
                        <span className="relative -top-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold leading-none bg-[#f2b46d] text-white">
                          BETA
                        </span>
                      </span>
                    </h1>
                  </div>

                  {/* Quick actions under the title */}
                  <div className="mb-6 grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {QuickActions.map((qa) => (
                      <button
                        key={qa.key}
                        onClick={() => fillPrompt(qa.prompt)}
                        className="text-left rounded-md border border-[#2a2a2a] bg-[#171717] hover:bg-[#202020] transition-colors px-3 py-2 text-xs"
                      >
                        {qa.title}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {activeTab === "chat" ? (
              <>
                <div className="min-h-[160px]">
                  <div className="flex flex-col gap-4">
                    {messages.map((m, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-xl border p-4 leading-7 max-w-3xl",
                          m.role === "assistant"
                            ? "bg-[#111111] border-[#262626] text-[#d6d6d6]"
                            : "bg-[#171717] border-[#2a2a2a] text-white ml-auto"
                        )}
                      >
                        {m.content}
                      </div>
                    ))}
                    {loading && (
                      <div className="rounded-xl border border-[#262626] bg-[#111111] p-4 text-[#9a9a9a] max-w-3xl">
                        Thinking…
                      </div>
                    )}
                    <div ref={endRef} />
                  </div>
                </div>

                {showApiKeyNotice && (
                  <div className="mt-4 mb-2 rounded-lg border border-[#2a2a2a] bg-[#151515] p-3 text-sm text-[#eaeaea] flex items-start justify-between gap-3">
                    <div>
                      To place orders, you need to add your
                      {" "}
                      <button
                        onClick={() => setSettingsOpen(true)}
                        className="underline text-[#f2b46d] hover:opacity-90"
                      >
                        Aster API key
                      </button>
                      .
                    </div>
                    <button
                      aria-label="Закрыть уведомление"
                      onClick={() => {
                        setShowApiKeyNotice(false);
                        try {
                          localStorage.setItem("aster_api_banner_dismissed", "1");
                        } catch {}
                      }}
                      className="shrink-0 rounded-md border border-[#333] px-2 py-1 text-[#a8a8a8] hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <div className="mt-6">
                  <div className="flex items-end gap-2 bg-[#141414] border border-[#2a2a2a] rounded-xl p-2">
                    <textarea
                      ref={textareaRef}
                      className="flex-1 bg-transparent outline-none text-sm px-3 py-2 placeholder:text-[#7a7a7a] resize-none max-h-[200px] min-h-[44px]"
                      placeholder="Type your message… (Shift+Enter for new line)"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendFromComposer();
                        }
                      }}
                    />
                    <button
                      disabled={!input.trim() || loading || !(mounted && isConnected)}
                      onClick={handleSendFromComposer}
                      className="rounded-lg bg-[#f2b46d] text-black text-sm font-medium px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {mounted && isConnected ? "Send" : "Connect wallet"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-[#262626] bg-[#111111]/60 p-0 text-[#a8a8a8]">
                <div className="border-b border-[#262626] px-4 py-3 text-white">History</div>
                <div className="max-h-[480px] overflow-auto divide-y divide-[#1f1f1f]">
                  {loadingChats ? (
                    <div className="px-4 py-3">Loading…</div>
                  ) : chats.length === 0 ? (
                    <div className="px-4 py-3">No history yet. Start a conversation.</div>
                  ) : (
                    chats.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => void openChat(c.id)}
                        className="w-full text-left px-4 py-3 hover:bg-[#161616] focus:bg-[#161616] transition-colors"
                      >
                        <div className="text-sm text-white truncate">{c.title || "Untitled"}</div>
                        <div className="text-xs text-[#8a8a8a]">{timeAgo(c.created_at)}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[#2a2a2a] bg-[#141414] p-5 text-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="text-white font-medium">Settings</div>
              <button onClick={() => setSettingsOpen(false)} className="rounded-md border border-[#333] px-2 py-1">✕</button>
            </div>

            <div className="mb-3 text-xs text-[#a8a8a8]">
              We do not store your keys on the server. They are kept locally in your browser and
              are sent to the server only to execute an order.
            </div>

            <div className="mb-3">
              <div className="text-[#a8a8a8] mb-1">ASTER_API_KEY</div>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full rounded-md bg-[#171717] border border-[#2a2a2a] px-3 py-2" placeholder="api key" />
            </div>
            <div className="mb-3">
              <div className="text-[#a8a8a8] mb-1">ASTER_API_SECRET</div>
              <input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} className="w-full rounded-md bg-[#171717] border border-[#2a2a2a] px-3 py-2" placeholder="api secret" />
            </div>
            <div className="mb-4">
              <div className="text-[#a8a8a8] mb-1">ASTER_API_PASSPHRASE (optional)</div>
              <input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} className="w-full rounded-md bg-[#171717] border border-[#2a2a2a] px-3 py-2" placeholder="passphrase" />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button onClick={saveLocalCreds} className="rounded-md bg-[#171717] border border-[#2a2a2a] px-3 py-2">{saveStatus === "saved" ? "Saved" : "Save"}</button>
              <button
                onClick={async () => {
                  setTestStatus("testing");
                  try {
                    const res = await fetch("/api/aster/check", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ asterCredentials: apiKey && apiSecret ? { apiKey, apiSecret, passphrase: passphrase || undefined } : null }),
                    });
                    const data = await res.json();
                    if (data?.auth?.ok && data?.connectivity?.ok) setTestStatus("ok"); else setTestStatus("fail");
                  } catch {
                    setTestStatus("fail");
                  }
                  setTimeout(() => setTestStatus("idle"), 2000);
                }}
                className="rounded-md bg-[#171717] border border-[#2a2a2a] px-3 py-2"
              >
                {testStatus === "testing" ? "Testing…" : testStatus === "ok" ? "Test passed" : testStatus === "fail" ? "Test failed" : "Test"}
              </button>
              <button onClick={() => { localStorage.removeItem("aster_api_key"); localStorage.removeItem("aster_api_secret"); localStorage.removeItem("aster_passphrase"); setApiKey(""); setApiSecret(""); setPassphrase(""); }} className="rounded-md bg-[#171717] border border-[#2a2a2a] px-3 py-2">Clear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


