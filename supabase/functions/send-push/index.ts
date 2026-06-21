import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import webpush from "npm:web-push";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { user_id, title, body, url = "/dashboard" } = await req.json();

    if (!user_id) {
      throw new Error("user_id is required");
    }

    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const subject = Deno.env.get("VAPID_SUBJECT") || "https://paymentblack.com";

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }

    // Pushcut is intentionally disabled here. It may only be sent by the
    // verified payment webhook path with persistent pushcut_logs deduplication.
    const [subsRes, logRes] = await Promise.all([
      supabaseClient.from("push_subscriptions").select("*").eq("user_id", user_id),
      supabaseClient
        .from("notifications_log")
        .insert({
          user_id,
          title,
          body,
          type: "push",
          metadata: { url, attempts: 1 },
        })
        .select()
        .single(),
    ]);

    if (subsRes.error) throw subsRes.error;
    const subscriptions = subsRes.data ?? [];
    const logEntry = logRes.data;

    // Web push tasks
    const webPushTasks = subscriptions.map(async (sub) => {
      try {
        const payload = JSON.stringify({
          title: title || "💰 Pagamento Recebido!",
          body: body || "Uma nova venda foi confirmada no seu checkout.",
          url: url || "/dashboard",
          badge: "/logo-192.png",
          icon: "/logo-192.png",
          timestamp: Date.now(),
        });
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        return { success: true, endpoint: sub.endpoint };
      } catch (err: any) {
        console.error(`Web push error to ${sub.endpoint}:`, err?.message);
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await supabaseClient.from("push_subscriptions").delete().eq("id", sub.id);
        }
        return { success: false, endpoint: sub.endpoint, error: err?.message, statusCode: err?.statusCode };
      }
    });

    const webResults = await Promise.all(webPushTasks);
    console.log("Pushcut blocked in send-push; webhook-only delivery is enforced.");

    if (logEntry) {
      await supabaseClient
        .from("notifications_log")
        .update({
          metadata: {
            url,
            results: webResults,
            pushcut: { blocked: true, reason: "webhook_only" },
            sent_at: new Date().toISOString(),
          },
        })
        .eq("id", logEntry.id);
    }

    return new Response(
      JSON.stringify({ success: true, results: webResults, pushcut: { blocked: true } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error: any) {
    console.error("Error in send-push function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
