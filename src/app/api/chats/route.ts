import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = (searchParams.get("wallet") || "").toLowerCase();
    if (!wallet) {
      return new Response(
        JSON.stringify({ error: "wallet is required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const supabase = getSupabaseServer();
    const { data: chats, error } = await supabase
      .from("chats")
      .select("id, title, created_at")
      .eq("user_id", wallet)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return new Response(JSON.stringify({ chats: chats || [] }), {
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


