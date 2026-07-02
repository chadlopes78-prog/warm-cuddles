import { createFileRoute } from "@tanstack/react-router";

const ADMIN_EMAILS = ["chadlopesff@gmail.com", "dercktuane@gmail.com"];

const E2_KEYS = [
  "e2payment_client_id",
  "e2payment_client_secret",
  "e2payment_wallet_mpesa",
  "e2payment_wallet_emola",
] as const;

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function getSessionEmail(request: Request): Promise<string | null> {
  const { createClient } = await import("@supabase/supabase-js");
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
  );
  const { data } = await client.auth.getUser(token);
  return data?.user?.email ?? null;
}

async function handleGET(request: Request) {
  const email = await getSessionEmail(request);
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return new Response("Não autorizado", { status: 401 });
  }
  const db = await getSupabaseAdmin();
  const { data, error } = await db
    .from("app_config")
    .select("key,value")
    .in("key", E2_KEYS as unknown as string[]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const map = new Map((data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? ""]));
  return Response.json({
    clientId: map.get("e2payment_client_id") ?? "",
    clientSecret: map.get("e2payment_client_secret") ?? "",
    walletMpesa: map.get("e2payment_wallet_mpesa") ?? "",
    walletEmola: map.get("e2payment_wallet_emola") ?? "",
  });
}

async function handlePOST(request: Request) {
  const email = await getSessionEmail(request);
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return new Response("Não autorizado", { status: 401 });
  }
  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return new Response("JSON inválido", { status: 400 });
  }
  const rows = [
    { key: "e2payment_client_id", value: String(body.clientId ?? "").trim() },
    { key: "e2payment_client_secret", value: String(body.clientSecret ?? "").trim() },
    { key: "e2payment_wallet_mpesa", value: String(body.walletMpesa ?? "").trim() },
    { key: "e2payment_wallet_emola", value: String(body.walletEmola ?? "").trim() },
  ];
  const db = await getSupabaseAdmin();
  const { error } = await db.from("app_config").upsert(rows, { onConflict: "key" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/admin/gateway-config")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
