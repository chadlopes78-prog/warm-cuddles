import { supabase } from "@/integrations/supabase/client";

export const VAPID_PUBLIC_KEY = "BEZBvJVrnVoRB6FbVd6QVwzobDsoSg0LVNyHN7rfPT1PLxAb2BOdSxz1J8A2XrSlgjtio6yNuGfcKJrxtV6qLec";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Detects if an existing subscription uses a different VAPID key and auto-resubscribes.
async function ensureFreshSubscription(registration: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return null;

  // Compare the applicationServerKey of the existing subscription with current VAPID key
  const currentKeyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const existingKeyBytes = existing.options?.applicationServerKey
    ? new Uint8Array(existing.options.applicationServerKey as ArrayBuffer)
    : null;

  if (existingKeyBytes && existingKeyBytes.length === currentKeyBytes.length) {
    const matches = currentKeyBytes.every((b, i) => b === existingKeyBytes[i]);
    if (matches) return existing; // Key matches, no action needed
  }

  // Key mismatch — unsubscribe silently so the UI shows the subscribe button
  console.log("[Push] VAPID key changed, clearing old subscription...");
  await existing.unsubscribe();

  // Also remove from DB so we don't send to stale endpoint
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", existing.endpoint);
  }

  return null;
}

export async function subscribeToPushNotifications(silent = false) {
  const isPushSupported = "serviceWorker" in navigator && "PushManager" in window;
  const isNotificationSupported = "Notification" in window;

  if (!isPushSupported || !isNotificationSupported) {
    if (!silent) console.warn("[Push] Notificações não são suportadas pelas capacidades deste dispositivo/navegador.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Auto-cleanup stale subscriptions from old VAPID keys
    await ensureFreshSubscription(registration);

    let permission = Notification.permission;
    if (permission === "default") {
      if (silent) return; // Don't prompt silently
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      if (!silent) console.warn("[Push] Permissão negada para notificações.");
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const p256dh = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(subscription.getKey("p256dh")!))));
    const auth = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(subscription.getKey("auth")!))));

    const { error } = await supabase.from("push_subscriptions").upsert({
      user_id: session.user.id,
      endpoint: subscription.endpoint,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
      metadata: {
        push_type: "web-push",
        user_agent: navigator.userAgent,
        platform: navigator.platform
      }
    }, { onConflict: 'user_id,endpoint' });

    if (error) {
      console.error("[Push] Erro ao salvar no banco:", error);
      if (!silent) throw error;
    }

    return subscription;
  } catch (error) {
    console.error("[Push] Falha crítica na inscrição:", error);
    if (!silent) throw error;
  }
}

export async function unsubscribeFromPushNotifications() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq("endpoint", subscription.endpoint);
      }
      await subscription.unsubscribe();
    }
  } catch (error) {
    console.error("[Push] Erro ao remover inscrição:", error);
    throw error;
  }
}

// Call on dashboard mount to silently refresh/cleanup subscription if key changed
export async function checkAndRefreshPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const fresh = await ensureFreshSubscription(registration);
    // If subscription was valid and permission is still granted, refresh token in DB
    if (fresh && Notification.permission === "granted") {
      await subscribeToPushNotifications(true);
    }
  } catch (e) {
    console.error("[Push] checkAndRefreshPushSubscription error:", e);
  }
}
