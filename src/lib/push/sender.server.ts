import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VAPID_PUBLIC_KEY =
  "BETEoVdcIuhkKSgg8hOo_FMhcFPODIRW7prsctLKBjrCHHyUX3Vies5BrclXrsifs4H3-lRtJV1uBQ-HiXv4bVc";

function getVapidDetails() {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) throw new Error("VAPID_PRIVATE_KEY env var not set");
  webpush.setVapidDetails("mailto:admin@paymentblackmz.com", VAPID_PUBLIC_KEY, privateKey);
}

export type PushEvent =
  | "sale.approved"
  | "sale.pending"
  | "sale.failed"
  | "checkout.abandoned"
  | "refund"
  | "new_customer"
  | "daily_summary"
  | "system";

const EVENT_TITLES: Record<PushEvent, string> = {
  "sale.approved": "💰 Venda Confirmada!",
  "sale.pending": "⏳ Pagamento Pendente",
  "sale.failed": "❌ Pagamento Falhado",
  "checkout.abandoned": "🛒 Carrinho Abandonado",
  refund: "↩️ Reembolso",
  new_customer: "👤 Novo Cliente",
  daily_summary: "📊 Resumo Diário",
  system: "🔔 PaymentBlack",
};

export interface PushPayload {
  event: PushEvent;
  title?: string;
  body: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  // Check user preferences
  const { data: prefs } = await supabaseAdmin
    .from("notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // Respect per-event preferences (default: all enabled)
  const prefKey = payload.event as keyof typeof prefs;
  if (prefs && prefKey in prefs && prefs[prefKey as never] === false) {
    return; // User disabled this event
  }

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subs || subs.length === 0) return;

  try {
    getVapidDetails();
  } catch (e) {
    console.error("[push] VAPID not configured:", e);
    return;
  }

  const title = payload.title ?? EVENT_TITLES[payload.event] ?? "PaymentBlack";
  const notifPayload = JSON.stringify({
    title,
    body: payload.body,
    url: payload.url ?? "/dashboard",
    event: payload.event,
    metadata: payload.metadata ?? {},
  });

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        notifPayload,
        { TTL: 60 * 60 * 24 } // 24h TTL
      )
    )
  );

  // Remove expired/invalid subscriptions (410 Gone or 404)
  const expiredEndpoints: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const err = r.reason as { statusCode?: number };
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        expiredEndpoints.push(subs[i].endpoint);
      } else {
        console.error("[push] send error:", r.reason);
      }
    }
  });
  if (expiredEndpoints.length > 0) {
    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .in("endpoint", expiredEndpoints);
  }

  // Log notification
  await supabaseAdmin.from("notifications_log").insert({
    user_id: userId,
    title,
    body: payload.body,
    type: payload.event === "daily_summary" ? "daily_report" : payload.event.startsWith("sale") ? "sale" : "system",
    metadata: { event: payload.event, url: payload.url, ...(payload.metadata ?? {}) },
  });
}
