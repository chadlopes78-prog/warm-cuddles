import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const E2_KEYS = [
  "e2payment_client_id",
  "e2payment_client_secret",
  "e2payment_wallet_mpesa",
  "e2payment_wallet_emola",
] as const;

export const getGatewayConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("key,value")
    .in("key", E2_KEYS as unknown as string[]);

  const map = new Map((data ?? []).map((r: { key: string; value: string | null }) => [r.key, r.value ?? ""]));
  return {
    clientId: map.get("e2payment_client_id") ?? "",
    clientSecret: map.get("e2payment_client_secret") ?? "",
    walletMpesa: map.get("e2payment_wallet_mpesa") ?? "",
    walletEmola: map.get("e2payment_wallet_emola") ?? "",
  };
});

const SaveGatewayInput = z.object({
  clientId: z.string().max(200),
  clientSecret: z.string().max(200),
  walletMpesa: z.string().max(100),
  walletEmola: z.string().max(100),
});

export const saveGatewayConfig = createServerFn({ method: "POST" })
  .inputValidator((input) => SaveGatewayInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = [
      { key: "e2payment_client_id", value: data.clientId.trim() },
      { key: "e2payment_client_secret", value: data.clientSecret.trim() },
      { key: "e2payment_wallet_mpesa", value: data.walletMpesa.trim() },
      { key: "e2payment_wallet_emola", value: data.walletEmola.trim() },
    ];
    const { error } = await supabaseAdmin
      .from("app_config")
      .upsert(rows, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
