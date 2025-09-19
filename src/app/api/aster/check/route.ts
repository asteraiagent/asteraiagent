import { NextRequest } from "next/server";
import { AsterPublic, normalizeAsterErrorMessage } from "@/lib/aster";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { asterCredentials } = body as {
      asterCredentials?: { apiKey: string; apiSecret: string; passphrase?: string | null } | null;
    };

    // Simple connectivity check (public endpoints only)
    const connectivity = await AsterPublic.markets()
      .then(() => ({ ok: true }))
      .catch((e) => ({ ok: false, error: normalizeAsterErrorMessage(e) }));

    let auth: { ok: boolean; error?: string } = { ok: false };
    // Auth check is not possible without full signing; just echo presence of keys
    if (asterCredentials?.apiKey && asterCredentials?.apiSecret) {
      auth = { ok: true };
    } else auth = { ok: false, error: "Missing local credentials" };

    return new Response(
      JSON.stringify({ connectivity, auth }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: errMsg }), { status: 500 });
  }
}


