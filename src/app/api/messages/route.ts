import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get("chatId");
    const wallet = (searchParams.get("wallet") || "").toLowerCase();
    if (!chatId || !wallet) {
      return new Response(
        JSON.stringify({ error: "chatId and wallet are required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const supabase = getSupabaseServer();

    const { data: chat, error: chatErr } = await supabase
      .from("chats")
      .select("id")
      .eq("id", chatId)
      .eq("user_id", wallet)
      .single();
    if (chatErr) throw chatErr;
    if (!chat) {
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { "content-type": "application/json" },
      });
    }

    const { data: messages, error } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    return new Response(JSON.stringify({ messages: messages || [] }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}


