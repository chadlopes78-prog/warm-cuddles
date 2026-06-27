import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://payflax.site";
const DEFAULT_API_KEY = "9e8848ec81379997bd3ff22dba132474593252a5d3d588d9ab9b2d1706f42faf";
const PAY_PATH = "/api/pay";

const PaymentInput = z.object({
  productId: z.string().min(1).max(120),
  method: z.enum(["mpesa", "emola"]),
  msisdn: z.string().min(9).max(20),
  customerName: z.string().min(1).max(100),
  contactPhone: z.string().max(20).optional(),
  trafficPageTrackingId: z.string().max(100).nullable().optional(),
  bumpAccepted: z.boolean().optional(),
});

const PaymentSuccessInput = z.object({
  saleId: z.string().uuid(),
});

const PAYMENT_SUCCESS_SELECT =
  "id, status, status_reason, created_at, payment_method, amount, customer_phone, transaction_id, payment_reference, products(id, access_link, delivery_link, support_phone, support_number, thank_you_button_text, thank_you_url)";

export type PaymentErrorCode =
  | "invalid_phone"
  | "method_mismatch"
  | "insufficient_balance"
  | "cancelled"
  | "timeout"
  | "duplicate"
  | "gateway"
  | "config"
  | "internal";

export type PaymentResult =
  | { success: true; saleId: string; transactionId: string | null }
  | { success: false; error: string; code?: PaymentErrorCode; retryable?: boolean; saleId?: string };

function classifyError(msg: string): { code: PaymentErrorCode; retryable: boolean } {
  const s = (msg || "").toLowerCase();
  if (/saldo|insufficient|insuf/.test(s)) return { code: "insufficient_balance", retryable: true };
  if (/cancel/.test(s)) return { code: "cancelled", retryable: true };
  if (/pin|timeout|tempo limite|n[aã]o confirmad|expir/.test(s)) return { code: "timeout", retryable: true };
  if (/duplicate|duplicad/.test(s)) return { code: "duplicate", retryable: false };
  if (/initiator|authentication|isdn|other process/.test(s)) return { code: "gateway", retryable: true };
  return { code: "gateway", retryable: true };
}


export const getPaymentSuccessData = createServerFn({ method: "GET" })
  .inputValidator((input) => PaymentSuccessInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let { data: sale, error } = await supabaseAdmin
      .from("sales")
      .select(
        "id, status, status_reason, created_at, payment_method, products(id, access_link, delivery_link, support_phone, support_number, thank_you_button_text, thank_you_url)",
      )
      .eq("id", data.saleId)
      .maybeSingle();

    if (error) {
      console.error("payment-success lookup error", error);
      throw new Error("Não foi possível consultar o estado do pagamento.");
    }
    if (!sale) return { sale: null, product: null };

    const currentStatus = String(sale.status ?? "").toLowerCase();
    const pendingAgeMs = sale.created_at ? Date.now() - new Date(sale.created_at).getTime() : 0;
    if (currentStatus === "pending" && pendingAgeMs > 6 * 60_000) {
      const { markSaleTerminalFailure } = await import("@/lib/payments/confirmation.server");
      await markSaleTerminalFailure({
        saleId: sale.id,
        status: "expired",
        reason: "Pagamento não confirmado dentro do tempo limite. Tente novamente ou escolha outro método.",
        method: sale.payment_method ?? null,
      }).catch((e) => console.error("[checkout] auto-expire pending sale failed", e));

      const refreshed = await supabaseAdmin
        .from("sales")
        .select(
          "id, status, status_reason, created_at, payment_method, products(id, access_link, delivery_link, support_phone, support_number, thank_you_button_text, thank_you_url)",
        )
        .eq("id", data.saleId)
        .maybeSingle();
      if (!refreshed.error && refreshed.data) sale = refreshed.data;
    }

    const status = String(sale.status ?? "").toLowerCase();
    const isPaid = ["paid", "approved", "success", "completed"].includes(status);
    const product = sale.products as {
      access_link?: string | null;
      delivery_link?: string | null;
      support_phone?: string | null;
      support_number?: string | null;
      thank_you_button_text?: string | null;
      thank_you_url?: string | null;
    } | null;

    return {
      sale: { status: sale.status, status_reason: sale.status_reason },
      product: product
        ? {
            access_link: isPaid ? product.access_link : null,
            delivery_link: isPaid ? product.delivery_link : null,
            support_phone: product.support_phone,
            support_number: product.support_number,
            thank_you_button_text: product.thank_you_button_text,
            thank_you_url: isPaid ? product.thank_you_url : null,
          }
        : null,
    };
  });

function normalizeMozambicanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("258") && digits.length === 12) return digits;
  if (digits.length === 9) return `258${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `258${digits.slice(1)}`;
  return digits;
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function configuredPublicUrl() {
  const raw =
    process.env.PAYMENT_CALLBACK_URL ||
    process.env.PAYMENT_WEBHOOK_URL ||
    process.env.PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return raw ? raw.replace(/\/+$/, "") : "";
}

function configuredWebhookUrl(requestOrigin = "") {
  const explicit = process.env.PAYMENT_WEBHOOK_URL || process.env.PAYMENT_CALLBACK_URL || "";
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || "";
  const appendSecret = (url: string) => {
    if (!secret) return url;
    try {
      const u = new URL(url);
      if (!u.searchParams.has("token") && !u.searchParams.has("secret")) {
        u.searchParams.set("token", secret);
      }
      return u.toString();
    } catch {
      return url;
    }
  };

  if (explicit && /^https?:\/\//i.test(explicit)) {
    const clean = explicit.replace(/\/+$/, "");
    try {
      const u = new URL(clean);
      if (/\/api\/public\/payment-webhook$/i.test(u.pathname)) return appendSecret(clean);
      u.pathname = `${u.pathname.replace(/\/+$/, "")}/api/public/payment-webhook`;
      return appendSecret(u.toString());
    } catch {
      // Fall back to appending the webhook path below.
    }
    return appendSecret(`${clean}/api/public/payment-webhook`);
  }

  const publicUrl = configuredPublicUrl();
  const origin = publicUrl || requestOrigin.replace(/\/+$/, "");
  return origin ? appendSecret(`${origin}/api/public/payment-webhook`) : "";
}

export const processPayment = createServerFn({ method: "POST" })
  .inputValidator(PaymentInput)
  .handler(async ({ data }): Promise<PaymentResult> => {
    const msisdn = normalizeMozambicanPhone(data.msisdn);
    if (!/^258\d{9}$/.test(msisdn)) {
      return {
        success: false,
        code: "invalid_phone",
        retryable: true,
        error: "Número de telefone inválido. Use o formato 84/85/86/87xxxxxxx.",
      };
    }

    const localPrefix = msisdn.slice(3, 5);
    if (data.method === "mpesa" && !["84", "85"].includes(localPrefix)) {
      return { success: false, code: "method_mismatch", retryable: true, error: "Para M-Pesa use um número 84 ou 85." };
    }
    if (data.method === "emola" && !["86", "87"].includes(localPrefix)) {
      return { success: false, code: "method_mismatch", retryable: true, error: "Para e-Mola use um número 86 ou 87." };
    }

    const apiKey = process.env.PAYMENT_API_KEY || DEFAULT_API_KEY;
    const baseUrl = process.env.PAYMENT_API_BASE_URL || DEFAULT_BASE_URL;

    if (!apiKey) {
      return { success: false, code: "config", retryable: false, error: "Gateway de pagamento não configurado no servidor." };
    }


    const t0 = Date.now();

    // Parallel: import admin client + confirmation helpers up-front
    const [{ supabaseAdmin }, confirmationMod] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/payments/confirmation.server"),
    ]);
    const {
      confirmSalePayment,
      markSaleTerminalFailure,
      normalizeGatewayStatus,
      paymentReferenceForSale,
      readGatewayMessage,
      readGatewayTransactionId,
      pendingReasonForMethod,
    } = confirmationMod;

    let requestOrigin = "";
    try {
      const { getRequestUrl } = await import("@tanstack/react-start/server");
      requestOrigin = getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin;
    } catch {
      requestOrigin = "";
    }

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        data.productId,
      );

    let productQuery = supabaseAdmin
      .from("products")
      .select("id, price, status, user_id, bump_enabled, bump_price");
    productQuery = isUuid
      ? productQuery.eq("id", data.productId)
      : productQuery.eq("custom_url", data.productId);

    const { data: product, error: productError } = await productQuery.single();

    if (productError || !product) {
      console.error("Product lookup failed for:", data.productId, productError);
      return { success: false, error: "Produto não encontrado." };
    }
    if (product.status && product.status !== "active") {
      return { success: false, error: "Produto indisponível para compra." };
    }

    const baseAmount = Number(product.price);
    const bumpEligible = Boolean(
      data.bumpAccepted && product.bump_enabled && product.bump_price && Number(product.bump_price) > 0,
    );
    const bumpAmount = bumpEligible ? Number(product.bump_price) : 0;
    const amount = baseAmount + bumpAmount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 500_000) {
      return { success: false, error: "Valor do produto inválido." };
    }

    const PLATFORM_PAYOUT = {
      mpesa: "258847842046",
      emola: "258863006821",
    };

    // Parallel: owner payout config + traffic page lookup (independent)
    const [ownerRes, trafficRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("payout_number, payout_method, payout_mpesa, payout_emola")
        .eq("id", product.user_id)
        .maybeSingle(),
      data.trafficPageTrackingId
        ? supabaseAdmin
            .from("traffic_pages")
            .select("id")
            .eq("tracking_id", data.trafficPageTrackingId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const op = ownerRes.data as {
      payout_number?: string | null;
      payout_method?: string | null;
      payout_mpesa?: string | null;
      payout_emola?: string | null;
    } | null;

    const methodSpecific = data.method === "mpesa" ? op?.payout_mpesa : op?.payout_emola;
    const legacyMatches =
      (data.method === "mpesa" && op?.payout_method === "mpesa_b2c") ||
      (data.method === "emola" && op?.payout_method === "emola_b2c");
    const payoutSource = methodSpecific || (legacyMatches ? op?.payout_number : null);

    const fallbackNumber = PLATFORM_PAYOUT[data.method];
    const payoutNumber = payoutSource
      ? normalizeMozambicanPhone(payoutSource)
      : fallbackNumber;

    if (!/^258\d{9}$/.test(payoutNumber)) {
      return { success: false, error: "Número de payout inválido." };
    }

    const payoutMethod = data.method === "mpesa" ? "mpesa_b2c" : "emola_b2c";

    const customerName = data.contactPhone
      ? `${data.customerName.trim()} (contacto: ${data.contactPhone.trim()})`
      : data.customerName.trim();

    const finalTrafficPageId = (trafficRes as { data: { id?: string } | null }).data?.id ?? null;

    // Pre-generate sale ID so reference + status_reason go in the initial INSERT
    // (saves a follow-up UPDATE round-trip before the gateway call).
    const saleId = crypto.randomUUID();
    const gatewayMethod = data.method === "mpesa" ? "mpesa_c2b" : "emola_c2b";
    const reference = paymentReferenceForSale(saleId);
    const initialPendingReason = pendingReasonForMethod(gatewayMethod, "awaiting_customer").label;
    const reqId = saleId.slice(0, 8);

    // Idempotency: if the same customer just initiated a payment for the same
    // product+amount in the last 30s and it is still pending, return that sale
    // instead of creating a duplicate (prevents double-charges from rage-clicks).
    {
      const cutoff = new Date(Date.now() - 30_000).toISOString();
      const { data: dup } = await supabaseAdmin
        .from("sales")
        .select("id, status, transaction_id")
        .eq("product_id", product.id)
        .eq("customer_phone", msisdn)
        .eq("amount", amount)
        .eq("status", "pending")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (dup?.id) {
        console.info("[payments] idempotent replay", { reqId, saleId: dup.id });
        return { success: true, saleId: dup.id, transactionId: dup.transaction_id ?? null };
      }
    }

    const saleInsertPromise = supabaseAdmin
      .from("sales")
      .insert({
        id: saleId,
        product_id: product.id,
        user_id: product.user_id,
        customer_name: customerName.slice(0, 100),
        customer_phone: msisdn,
        amount,
        payment_method: data.method,
        status: "pending",
        traffic_page_id: finalTrafficPageId,
        bump_accepted: bumpEligible,
        bump_amount: bumpEligible ? bumpAmount : null,
        payment_reference: reference,
        status_reason: initialPendingReason,
      } as any)
      .select("id")
      .single();

    // Early-fire: dispatch gateway request IN PARALLEL with sale INSERT for
    // BOTH M-Pesa and e-Mola. Gateway needs only phone/amount (saleId is
    // internal), so we remove a DB round-trip from the critical path before
    // the PIN prompt arrives on the customer's device. Keep-alive + idempotency
    // header avoid TCP/TLS handshake cost on warm workers and let the gateway
    // dedupe duplicated submissions.
    const endpoint = joinUrl(baseUrl, PAY_PATH);
    const gatewayPhone = data.method === "mpesa" ? msisdn : msisdn.slice(3);
    // PayBlack/Payflax docs: customer phone for e-Mola is local 9 digits,
    // but payout_number remains full 258XXXXXXXXX for both wallets.
    const gatewayPayoutNumber = payoutNumber;
    const earlyBody: Record<string, unknown> = {
      api_key: apiKey,
      method: gatewayMethod,
      phone: gatewayPhone,
      amount: String(amount),
      payout_number: gatewayPayoutNumber,
      payout_method: payoutMethod,
      transaction_reference: reference,
    };
    const callbackUrl = configuredWebhookUrl(requestOrigin);
    if (callbackUrl) earlyBody.callback_url = callbackUrl;
    if (gatewayMethod === "emola_c2b") earlyBody.name = customerName.slice(0, 60);

    const earlyController: AbortController = new AbortController();
    const earlyTimeoutId: ReturnType<typeof setTimeout> = setTimeout(
      () => earlyController.abort(),
      90_000,
    );
    const tGwSent = Date.now();
    console.info("[perf] gateway early-fire", {
      reqId, saleId, method: gatewayMethod, sinceStartMs: tGwSent - t0,
    });
    const earlyGatewayPromise: Promise<Response> = fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        Connection: "keep-alive",
        "User-Agent": "PagamentosMZ/1.0",
        "X-Request-Id": reqId,
        "X-Idempotency-Key": saleId,
      },
      body: JSON.stringify(earlyBody),
      signal: earlyController.signal,
      keepalive: true,
    });



    const { data: sale, error: saleError } = await saleInsertPromise;

    if (saleError || !sale) {
      // Abort the in-flight gateway request if the row could not be persisted.
      if (earlyController) earlyController.abort();
      if (earlyTimeoutId) clearTimeout(earlyTimeoutId);
      console.error("sale insert error", saleError);
      return { success: false, error: "Não foi possível registar a venda." };
    }

    // Fire-and-forget webhooks pre-payment
    {
      const basePayload = {
        sale_id: sale.id,
        product_id: product.id,
        customer_name: customerName.slice(0, 100),
        customer_phone: msisdn,
        amount,
        payment_method: data.method,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      void (async () => {
        const { enqueueWebhookEvent, processPendingForUser } = await import(
          "@/lib/webhooks/dispatcher.server"
        );
        await enqueueWebhookEvent({
          userId: product.user_id,
          event: "sale.created",
          payload: basePayload,
          productId: product.id,
        });
        await enqueueWebhookEvent({
          userId: product.user_id,
          event: "payment.requested",
          payload: basePayload,
          productId: product.id,
        });
        await processPendingForUser(product.user_id);
      })().catch((e) => console.error("[webhooks] enqueue pre-payment err", e));
    }

    console.info("[perf] processPayment pre-gateway", { ms: Date.now() - t0, saleId: sale.id });

    // Background processor: awaits the gateway response (which may block for the
    // full PIN window) and finalizes the sale. Returns nothing — failures are
    // logged and the sale stays "pending" so the webhook / reconciler can finish.
    const processGatewayResult = async (gatewayPromise: Promise<Response>) => {
      try {
        const res = await gatewayPromise;
        const text = await res.text();
        clearTimeout(earlyTimeoutId);
        console.info("[perf] gateway responded (bg)", {
          reqId, saleId: sale.id, status: res.status,
          gatewayMs: Date.now() - tGwSent, totalMs: Date.now() - t0,
        });

        let json: Record<string, unknown> | null = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

        console.info("payflax response", {
          reqId, status: res.status, method: gatewayMethod, endpoint, reference,
          body: text?.slice(0, 800),
        });

        const txEnvelope =
          json && typeof json === "object" && "transacao" in json
            ? ((json as Record<string, unknown>).transacao as Record<string, unknown>)
            : json;
        const transactionId =
          (txEnvelope && typeof txEnvelope === "object"
            ? ((txEnvelope.id as string | undefined) ??
              (txEnvelope.transaction_reference as string | undefined))
            : null) ?? readGatewayTransactionId(json);
        const finalStatus = normalizeGatewayStatus(txEnvelope ?? json, res.ok);

        if (finalStatus === "paid") {
          await confirmSalePayment({
            saleId: sale.id,
            transactionId: transactionId ? String(transactionId) : null,
            reference,
            rawPayload: json,
            triggerPushcut: true,
          });
        } else if (finalStatus === "failed" || finalStatus === "expired") {
          const messageSource =
            (txEnvelope as Record<string, unknown> | null) ?? (json as Record<string, unknown>);
          const message =
            readGatewayMessage(messageSource) ||
            messageSource?.message || messageSource?.error || messageSource?.detail ||
            (finalStatus === "expired" ? "Pagamento expirado." : "Pagamento recusado pelo gateway.");
          await markSaleTerminalFailure({
            saleId: sale.id,
            status: finalStatus,
            transactionId: transactionId ? String(transactionId) : null,
            reference,
            reason: String(message),
            method: gatewayMethod,
          });
        } else {
          await supabaseAdmin
            .from("sales")
            .update({
              status: "pending",
              status_reason: pendingReasonForMethod(gatewayMethod, "processing").label,
              transaction_id: transactionId ? String(transactionId).slice(0, 200) : null,
              payment_reference: reference,
            })
            .eq("id", sale.id)
            .eq("status", "pending");
        }
      } catch (err) {
        clearTimeout(earlyTimeoutId);
        console.error("[gateway] bg processor error", err);
        // Leave sale as pending; webhook / reconciler will resolve it.
        await supabaseAdmin
          .from("sales")
          .update({
            status: "pending",
            status_reason: pendingReasonForMethod(gatewayMethod, "awaiting_customer").label,
            payment_reference: reference,
          })
          .eq("id", sale.id)
          .eq("status", "pending")
          .then(undefined, () => {});
      }
    };

    // Race the gateway against a short client-facing budget. If the gateway
    // replies quickly with a terminal error (insufficient balance, invalid
    // number, etc.) we surface it to the customer. If it stays open waiting
    // for the PIN, we return success with the saleId so the client can poll
    // payment-success and avoid Safari's ~60s "Load failed" abort.
    // Short client-facing budget: just enough to catch immediate terminal
    // errors (invalid number, insufficient balance). The gateway pushes the
    // PIN to the SIM independently, so we don't need to wait for its HTTP
    // response to tell the customer to check their phone.
    const CLIENT_WAIT_MS = 3_000;
    const gatewaySettledPromise = earlyGatewayPromise
      .then((res) => ({ kind: "response" as const, res }))
      .catch((e) => ({ kind: "error" as const, error: e }));
    const raceResult = await Promise.race([
      gatewaySettledPromise,
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), CLIENT_WAIT_MS),
      ),
    ]);

    if (raceResult.kind === "timeout") {
      // Detach: finish gateway handling in background, return success now.
      console.info("[perf] client wait elapsed; detaching gateway", { reqId, saleId: sale.id });
      const bgTask = processGatewayResult(earlyGatewayPromise);
      const { waitUntil } = await import("@/lib/runtime/wait-until.server");
      if (!waitUntil(bgTask)) void bgTask;
      return { success: true, saleId: sale.id, transactionId: null };
    }

    if (raceResult.kind === "error") {
      clearTimeout(earlyTimeoutId);
      console.warn("[gateway] early-fire failed fast", {
        reqId, err: (raceResult.error as Error)?.message,
      });
      // Keep sale pending; webhook/reconciler can still resolve it.
      return { success: true, saleId: sale.id, transactionId: null };
    }

    // Got a synchronous gateway response within the budget.
    clearTimeout(earlyTimeoutId);
    const { res } = raceResult;
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }

    console.info("payflax response", {
      reqId, status: res.status, method: gatewayMethod, endpoint, reference,
      body: text?.slice(0, 800),
    });

    const txEnvelope =
      json && typeof json === "object" && "transacao" in json
        ? ((json as Record<string, unknown>).transacao as Record<string, unknown>)
        : json;
    const transactionId =
      (txEnvelope && typeof txEnvelope === "object"
        ? ((txEnvelope.id as string | undefined) ??
          (txEnvelope.transaction_reference as string | undefined))
        : null) ?? readGatewayTransactionId(json);
    const finalStatus = normalizeGatewayStatus(txEnvelope ?? json, res.ok);

    try {
      if (finalStatus === "paid") {
        await confirmSalePayment({
          saleId: sale.id,
          transactionId: transactionId ? String(transactionId) : null,
          reference,
          rawPayload: json,
          triggerPushcut: true,
        });
      } else if (finalStatus === "failed" || finalStatus === "expired") {
        const messageSource =
          (txEnvelope as Record<string, unknown> | null) ?? (json as Record<string, unknown>);
        const message =
          readGatewayMessage(messageSource) ||
          messageSource?.message || messageSource?.error || messageSource?.detail ||
          (finalStatus === "expired" ? "Pagamento expirado." : "Pagamento recusado pelo gateway.");
        await markSaleTerminalFailure({
          saleId: sale.id,
          status: finalStatus,
          transactionId: transactionId ? String(transactionId) : null,
          reference,
          reason: String(message),
          method: gatewayMethod,
        });
        const cls = classifyError(String(message));
        return { success: false, saleId: sale.id, error: String(message), code: cls.code, retryable: cls.retryable };
      } else {
        await supabaseAdmin
          .from("sales")
          .update({
            status: "pending",
            status_reason: pendingReasonForMethod(gatewayMethod, "processing").label,
            transaction_id: transactionId ? String(transactionId).slice(0, 200) : null,
            payment_reference: reference,
          })
          .eq("id", sale.id)
          .eq("status", "pending");
      }
    } catch (err) {
      console.error("processPayment finalize error", err);
    }

    return {
      success: true,
      saleId: sale.id,
      transactionId: transactionId ? String(transactionId) : null,
    };
  });
