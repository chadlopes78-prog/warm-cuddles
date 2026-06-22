import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PAID_STATUSES = new Set([
  "success",
  "successful",
  "paid",
  "completed",
  "complete",
  "approved",
  "confirmed",
  "processed",
]);
const FAILED_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
  "rejected",
  "refused",
  "declined",
  "denied",
]);
const EXPIRED_STATUSES = new Set(["expired", "timeout", "timed_out"]);

export type NormalizedPaymentStatus = "paid" | "failed" | "expired" | "pending";

type GatewayPayload = Record<string, unknown>;
type SaleForConfirmation = {
  id: string;
  status?: string | null;
  user_id?: string | null;
  product_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  amount?: number | string | null;
  payment_method?: string | null;
  transaction_id?: string | null;
  payment_reference?: string | null;
  traffic_page_id?: string | null;
  products?: { name?: string | null } | null;
};

function asObject(value: unknown): GatewayPayload {
  return value && typeof value === "object" ? (value as GatewayPayload) : {};
}

function nestedObject(payload: GatewayPayload, key: string): GatewayPayload {
  return asObject(payload[key]);
}

export function paymentReferenceForSale(saleId: string) {
  return `PMZ${saleId.replace(/[^a-zA-Z0-9]/g, "")}`.slice(0, 20);
}

export function readGatewayTransactionId(input: unknown): string | null {
  const payload = asObject(input);
  const data = nestedObject(payload, "data");
  const value =
    payload.transaction_id ??
    payload.transactionId ??
    payload.payment_id ??
    payload.paymentId ??
    payload.id ??
    data.transaction_id ??
    data.transactionId ??
    data.payment_id ??
    data.paymentId ??
    data.id ??
    null;
  return value == null ? null : String(value);
}

export function readGatewayReference(input: unknown): string | null {
  const payload = asObject(input);
  const data = nestedObject(payload, "data");
  const value =
    payload.reference ??
    payload.external_reference ??
    payload.merchant_reference ??
    data.reference ??
    data.external_reference ??
    data.merchant_reference ??
    null;
  return value == null ? null : String(value);
}

export function normalizeGatewayStatus(input: unknown, httpOk = true): NormalizedPaymentStatus {
  const payload = asObject(input);
  const data = nestedObject(payload, "data");
  const successValue = payload.success ?? payload.ok ?? data.success ?? data.ok;
  const raw = String(
    payload.status ??
      payload.payment_status ??
      payload.state ??
      payload.result ??
      data.status ??
      data.payment_status ??
      data.state ??
      data.result ??
      "",
  )
    .toLowerCase()
    .trim();
  const successText = String(successValue ?? "")
    .toLowerCase()
    .trim();

  if (PAID_STATUSES.has(raw)) return "paid";
  if (EXPIRED_STATUSES.has(raw)) return "expired";
  if (FAILED_STATUSES.has(raw)) return "failed";

  const message = String(
    payload.message ??
      payload.error ??
      payload.detail ??
      data.message ??
      data.error ??
      data.detail ??
      "",
  ).toLowerCase();
  // Não marcar como "paid" apenas por success:true / mensagem "sucesso" —
  // gateways como Payflax retornam isso ao só solicitar o PIN ao cliente.
  // Apenas status explícitos em PAID_STATUSES contam como aprovado.
  void combinedSuccessMessage;
  if (
    /(customer\s+did\s+not\s+enter\s+pin|pin\s+incorret|recus|reject|declin|cancel|insufficient|saldo\s+insuficiente)/i.test(
      `${combinedSuccessMessage} ${raw}`,
    )
  ) {
    return "failed";
  }
  if (
    successValue === false &&
    httpOk &&
    /(recus|reject|declin|cancel|fail|erro|expir)/i.test(message)
  ) {
    return message.includes("expir") ? "expired" : "failed";
  }

  return "pending";
}

async function fetchSaleById(saleId: string) {
  const { data, error } = await supabaseAdmin
    .from("sales")
    .select(
      "id, status, user_id, product_id, customer_name, customer_phone, amount, payment_method, transaction_id, payment_reference, traffic_page_id, products(name)",
    )
    .eq("id", saleId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findSaleForGatewayEvent(
  transactionId: string | null,
  reference: string | null,
) {
  if (transactionId) {
    const { data, error } = await supabaseAdmin
      .from("sales")
      .select(
        "id, status, user_id, product_id, customer_name, customer_phone, amount, payment_method, transaction_id, payment_reference, traffic_page_id, products(name)",
      )
      .eq("transaction_id", transactionId.slice(0, 200))
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (reference) {
    const { data, error } = await supabaseAdmin
      .from("sales")
      .select(
        "id, status, user_id, product_id, customer_name, customer_phone, amount, payment_method, transaction_id, payment_reference, traffic_page_id, products(name)",
      )
      .eq("payment_reference", reference.slice(0, 200))
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  return null;
}

export async function confirmSalePayment(options: {
  saleId: string;
  transactionId?: string | null;
  reference?: string | null;
  rawPayload?: unknown;
  triggerPushcut?: boolean;
}) {
  const { saleId, transactionId, reference, rawPayload, triggerPushcut = false } = options;

  const updatePayload: { status: string; payment_reference: string; transaction_id?: string } = {
    status: "paid",
    payment_reference: reference ? reference.slice(0, 200) : paymentReferenceForSale(saleId),
  };
  if (transactionId) updatePayload.transaction_id = transactionId.slice(0, 200);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("sales")
    .update(updatePayload)
    .eq("id", saleId)
    .neq("status", "paid")
    .select(
      "id, status, user_id, product_id, customer_name, customer_phone, amount, payment_method, transaction_id, payment_reference, traffic_page_id, products(name)",
    )
    .maybeSingle();

  if (updateError) throw updateError;

  if (!updated) {
    if (transactionId || reference) {
      await supabaseAdmin
        .from("sales")
        .update({
          ...(transactionId ? { transaction_id: transactionId.slice(0, 200) } : {}),
          ...(reference ? { payment_reference: reference.slice(0, 200) } : {}),
        })
        .eq("id", saleId)
        .eq("status", "paid");
    }
    const currentSale = await fetchSaleById(saleId);
    if (currentSale?.status === "paid") {
      await dispatchApprovedSideEffects(currentSale, rawPayload, triggerPushcut).catch((err) => {
        console.error("[payments] approved side-effects retry failed", err);
      });
    }
    return { sale: currentSale, becamePaid: false };
  }

  await dispatchApprovedSideEffects(updated, rawPayload, triggerPushcut).catch((err) => {
    console.error("[payments] approved side-effects failed", err);
  });

  return { sale: updated, becamePaid: true };
}

export async function markSaleTerminalFailure(options: {
  saleId: string;
  status: "failed" | "expired";
  transactionId?: string | null;
  reference?: string | null;
  reason?: string | null;
}) {
  const { saleId, status, transactionId, reference, reason } = options;
  const finalStatus = status === "expired" ? "failed" : "failed";
  const { data: updated, error } = await supabaseAdmin
    .from("sales")
    .update({
      status: finalStatus,
      transaction_id: transactionId ? transactionId.slice(0, 200) : undefined,
      payment_reference: reference
        ? reference.slice(0, 200)
        : reason
          ? reason.slice(0, 200)
          : undefined,
    })
    .eq("id", saleId)
    .neq("status", "paid")
    .neq("status", "failed")
    .select(
      "id, status, user_id, product_id, customer_name, customer_phone, amount, payment_method",
    )
    .maybeSingle();

  if (error) throw error;
  if (!updated?.user_id) return { becameFailed: false };

  const { enqueueWebhookEvent, processPendingForUser } =
    await import("@/lib/webhooks/dispatcher.server");
  await enqueueWebhookEvent({
    userId: updated.user_id,
    productId: updated.product_id,
    event: status === "expired" ? "payment.expired" : "payment.refused",
    payload: {
      sale_id: updated.id,
      product_id: updated.product_id,
      customer_name: updated.customer_name,
      customer_phone: updated.customer_phone,
      amount: updated.amount,
      payment_method: updated.payment_method,
      status: finalStatus,
      reason: reason?.slice(0, 200) ?? status,
    },
  });
  await processPendingForUser(updated.user_id);
  return { becameFailed: true };
}

async function dispatchApprovedSideEffects(
  sale: SaleForConfirmation,
  rawPayload: unknown,
  triggerPushcut: boolean,
) {
  const userId = sale.user_id as string | null;
  if (!userId) return;

  const { enqueueWebhookEvent, processPendingForUser } =
    await import("@/lib/webhooks/dispatcher.server");
  const productName = sale.products?.name ?? null;
  const payload = {
    sale_id: sale.id,
    product_id: sale.product_id,
    product_name: productName,
    customer_name: sale.customer_name,
    customer_phone: sale.customer_phone,
    amount: sale.amount,
    payment_method: sale.payment_method,
    status: "paid",
    payment_status: "paid",
    transaction_id: sale.transaction_id,
    payment_reference: sale.payment_reference,
    paid_at: new Date().toISOString(),
    pushcut_source: triggerPushcut ? "payment_webhook" : "blocked",
    gateway_payload: rawPayload ?? null,
  };

  // SINGLE EVENT POLICY: insert exactly ONE delivery per endpoint per sale.
  // Bypass the fan-out enqueue helper — for each endpoint we choose the highest
  // priority subscribed event and insert that single delivery directly.
  // Dedupe key `${saleId}` (no event prefix) guarantees that even if this code
  // runs twice for the same sale, the unique index blocks duplicates.
  const PRIORITY = ["sale.approved", "payment.received", "product.delivered"] as const;
  const { data: endpoints } = await supabaseAdmin
    .from("webhook_endpoints")
    .select("id, events, active, product_ids, is_pushcut")
    .eq("user_id", userId)
    .eq("active", true);

  let inserted = 0;
  for (const ep of endpoints ?? []) {
    const events = Array.isArray(ep.events) ? (ep.events as string[]) : [];
    const scope = ep.product_ids as string[] | null;
    const matchesProduct =
      !scope || scope.length === 0 || (sale.product_id ? scope.includes(sale.product_id) : false);
    const chosen = PRIORITY.find((e) => events.includes(e));
    console.log("[webhooks] dispatch decision", {
      endpointId: ep.id,
      saleId: sale.id,
      subscribed: events,
      matchesProduct,
      chosen: chosen ?? null,
      isPushcut: ep.is_pushcut,
      allowedPushcutSource: triggerPushcut,
    });
    if (!matchesProduct || !chosen) continue;
    if (ep.is_pushcut && !triggerPushcut) {
      console.log("[pushcut] blocked: non-webhook source", { orderId: sale.id, endpointId: ep.id });
      continue;
    }

    const { error: insertErr } = await supabaseAdmin
      .from("webhook_deliveries")
      .insert({
        webhook_id: ep.id,
        user_id: userId,
        event: chosen,
        payload: payload as never,
        dedupe_key: `approved:${sale.id}:${ep.id}`,
      });
    if (insertErr) {
      if (insertErr.code !== "23505") {
        console.error("[webhooks] direct enqueue failed", insertErr);
      } else {
        console.log("[webhooks] dedupe skipped", { endpointId: ep.id, saleId: sale.id });
      }
      continue;
    }
    inserted++;
  }
  if (inserted > 0) await processPendingForUser(userId);
  // Silence unused warning for helper kept for non-approved flows.
  void enqueueWebhookEvent;

  if (sale.traffic_page_id) {
    await supabaseAdmin.from("traffic_events").insert({
      page_id: sale.traffic_page_id,
      event_type: "purchase",
      metadata: { saleId: sale.id, productId: sale.product_id },
    });
  }
}
