import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { address } = (await req.json()) as { address: string };
  const supabase = getSupabaseServer();

  // For demo purposes, use wallet address as user id; in production use Supabase Auth Web3 provider.
  const { data: userRow, error } = await supabase
    .from("profiles")
    .upsert({ id: address.toLowerCase(), wallet: address.toLowerCase() })
    .select()
    .single();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ user: userRow }), {
    headers: { "content-type": "application/json" },
  });
}


