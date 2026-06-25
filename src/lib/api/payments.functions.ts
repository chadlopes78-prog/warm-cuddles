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

export type PaymentResult =
  | { success: true; saleId: string; transactionId: string | null }
  | { success: false; error: string; saleId?: string };

export const getPaymentSuccessData = createServerFn({ method: "GET" })
  .inputValidator((input) => PaymentSuccessInput.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sale, error } = await supabaseAdmin
      .from("sales")
      .select(
        "id, status, products(id, access_link, delivery_link, support_phone, support_number, thank_you_button_text)",
      )
      .eq("id", data.saleId)
      .maybeSingle();

    if (error) {
      console.error("payment-success lookup error", error);
      throw new Error("Não foi possível consultar o estado do pagamento.");
    }
    if (!sale) return { sale: null, product: null };

    const status = String(sale.status ?? "").toLowerCase();
    const isPaid = ["paid", "approved", "success", "completed"].includes(status);
    const product = sale.products as {
      access_link?: string | null;
      delivery_link?: string | null;
      support_phone?: string | null;
      support_number?: string | null;
      thank_you_button_text?: string | null;
    } | null;

    return {
      sale: { status: sale.status },
      product: product
        ? {
            access_link: isPaid ? product.access_link : null,
            delivery_link: isPaid ? product.delivery_link : null,
            support_phone: product.support_phone,
            support_number: product.support_number,
            thank_you_button_text: product.thank_you_button_text,
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

export const processPayment = createServerFn({ method: "POST" })
  .inputValidator(PaymentInput)
  .handler(async ({ data }): Promise<PaymentResult> => {
    const msisdn = normalizeMozambicanPhone(data.msisdn);
    if (!/^258\d{9}$/.test(msisdn)) {
      return {
        success: false,
        error: "Número de telefone inválido. Use o formato 84/85/86/87xxxxxxx.",
      };
    }

    const localPrefix = msisdn.slice(3, 5);
    if (data.method === "mpesa" && !["84", "85"].includes(localPrefix)) {
      return { success: false, error: "Para M-Pesa use um número 84 ou 85." };
    }
    if (data.method === "emola" && !["86", "87"].includes(localPrefix)) {
      return { success: false, error: "Para e-Mola use um número 86 ou 87." };
    }

    const apiKey = process.env.PAYMENT_API_KEY || DEFAULT_API_KEY;
    const baseUrl = process.env.PAYMENT_API_BASE_URL || DEFAULT_BASE_URL;

    if (!apiKey) {
      return { success: false, error: "Gateway de pagamento não configurado no servidor." };
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
      readGatewayTransactionId,
      pendingReasonForMethod,
    } = confirmationMod;

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

    const { data: sale, error: saleError } = await supabaseAdmin
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

    if (saleError || !sale) {
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

    try {
      const endpoint = joinUrl(baseUrl, PAY_PATH);
      const body: Record<string, unknown> = {
        api_key: apiKey,
        method: gatewayMethod,
        phone: msisdn.slice(3), // Payflax expects 9-digit local number
        amount: String(amount),
        payout_number: payoutNumber.slice(3),
        payout_method: payoutMethod,
      };
      if (gatewayMethod === "emola_c2b") {
        body.name = customerName.slice(0, 60);
      }

      // Retry on transient gateway errors (network/timeout/5xx).
      // Up to 3 attempts with short backoff. PIN-bearing requests use
      // a generous timeout so customers have time to confirm on the phone.
      const MAX_ATTEMPTS = 3;
      let res: Response | null = null;
      let text = "";
      let lastErr: unknown = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        try {
          res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              Accept: "application/json",
              "User-Agent": "PagamentosMZ/1.0",
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          text = await res.text();
          // Retry only on server-side faults; don't replay a 2xx/4xx (PIN already pushed).
          if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
            console.warn("[gateway] 5xx, retrying", { attempt, status: res.status });
            await new Promise((r) => setTimeout(r, 400 * attempt));
            continue;
          }
          break;
        } catch (e) {
          lastErr = e;
          const aborted = (e as { name?: string })?.name === "AbortError";
          console.warn("[gateway] network/timeout", {
            attempt,
            aborted,
            err: (e as Error)?.message,
          });
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 400 * attempt));
            continue;
          }
          throw e;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      if (!res) throw lastErr ?? new Error("Gateway sem resposta");

      let json: Record<string, unknown> | null = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }

      console.info("payflax response", {
        status: res.status,
        method: gatewayMethod,
        endpoint,
        reference,
        body: text?.slice(0, 800),
      });


      // Payflax wraps result under `transacao`
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
          messageSource?.message ||
          messageSource?.error ||
          messageSource?.detail ||
          (finalStatus === "expired" ? "Pagamento expirado." : "Pagamento recusado pelo gateway.");
        await markSaleTerminalFailure({
          saleId: sale.id,
          status: finalStatus,
          transactionId: transactionId ? String(transactionId) : null,
          reference,
          reason: String(message),
          method: gatewayMethod,
        });
        return { success: false, saleId: sale.id, error: String(message) };
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
          .neq("status", "paid");
      }

      return {
        success: true,
        saleId: sale.id,
        transactionId: transactionId ? String(transactionId) : null,
      };
    } catch (err: unknown) {
      console.error("processPayment error", err);
      await supabaseAdmin
        .from("sales")
        .update({
          status: "pending",
          status_reason: pendingReasonForMethod(gatewayMethod, "awaiting_customer").label,
          payment_reference: reference,
        })
        .neq("status", "paid")
        .eq("id", sale.id);
      return { success: true, saleId: sale.id, transactionId: null };
    }
  });
