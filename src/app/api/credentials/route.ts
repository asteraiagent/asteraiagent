import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, apiKey, apiSecret, passphrase } = body as {
      wallet: string;
      apiKey: string;
      apiSecret: string;
      passphrase?: string | null;
    };

    if (!wallet || !apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({ error: "wallet, apiKey, apiSecret are required" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const supabase = getSupabaseServer();
    await supabase.from("profiles").upsert({ id: wallet.toLowerCase(), wallet: wallet.toLowerCase() });

    const { error } = await supabase
      .from("aster_credentials")
      .upsert({
        user_id: wallet.toLowerCase(),
        api_key: apiKey,
        api_secret: apiSecret,
        passphrase: passphrase ?? null,
      });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: errMsg || "Unknown error" }), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet } = body as { wallet: string };
    if (!wallet) {
      return new Response(JSON.stringify({ error: "wallet is required" }), { status: 400 });
    }
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("aster_credentials")
      .delete()
      .eq("user_id", wallet.toLowerCase());
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: errMsg || "Unknown error" }), { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet");
    if (!wallet) {
      return new Response(JSON.stringify({ error: "wallet is required" }), { status: 400 });
    }
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("aster_credentials")
      .select("user_id")
      .eq("user_id", wallet.toLowerCase())
      .single();
    if (error && error.code !== "PGRST116") {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ exists: Boolean(data) }), { headers: { "content-type": "application/json" } });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: errMsg || "Unknown error" }), { status: 500 });
  }
}


