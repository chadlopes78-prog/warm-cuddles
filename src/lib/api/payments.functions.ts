import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const E2PAY_BASE_URL = "https://e2payments.explicador.co.mz";

const PaymentInput = z.object({
  productId: z.string().min(1).max(120),
  method: z.enum(["mpesa", "emola"]),
  msisdn: z.string().min(9).max(20),
  customerName: z.string().min(1).max(100),
  contactPhone: z.string().max(20).optional(),
  trafficPageTrackingId: z.string().max(100).nullable().optional(),
});

const PaymentSuccessInput = z.object({
  saleId: z.string().uuid(),
});

export type PaymentResult =
  | {
      success: true;
      saleId: string;
      transactionId: string | null;
    }
  | {
      success: false;
      error: string;
      saleId?: string;
    };

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

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const clientId = process.env.E2PAYMENT_CLIENT_ID;
  const clientSecret = process.env.E2PAYMENT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais e2payment não configuradas no servidor.");
  }

  const res = await fetch(`${E2PAY_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; PaymentBlackmz/1.0)",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }

  if (!res.ok || !json?.access_token) {
    console.error("e2payment token error", { status: res.status, body: text?.slice(0, 500) });
    throw new Error(`Falha ao autenticar com e2payment (HTTP ${res.status}).`);
  }

  const expiresInMs = (Number(json.expires_in) || 3600) * 1000;
  cachedToken = {
    value: String(json.access_token),
    expiresAt: Date.now() + expiresInMs,
  };
  return cachedToken.value;
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

    const walletId =
      data.method === "mpesa"
        ? process.env.E2PAYMENT_WALLET_MPESA
        : process.env.E2PAYMENT_WALLET_EMOLA;

    if (!walletId) {
      return {
        success: false,
        error: `Carteira ${data.method.toUpperCase()} não configurada no servidor.`,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        data.productId,
      );

    let productQuery = supabaseAdmin.from("products").select("id, price, status, user_id");

    if (isUuid) {
      productQuery = productQuery.eq("id", data.productId);
    } else {
      productQuery = productQuery.eq("custom_url", data.productId);
    }

    const { data: product, error: productError } = await productQuery.single();

    if (productError || !product) {
      console.error("Product lookup failed for:", data.productId, productError);
      return { success: false, error: "Produto não encontrado." };
    }
    if (product.status && product.status !== "active") {
      return { success: false, error: "Produto indisponível para compra." };
    }

    const amount = Number(product.price);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 500_000) {
      return { success: false, error: "Valor do produto inválido." };
    }

    const customerName = data.contactPhone
      ? `${data.customerName.trim()} (contacto: ${data.contactPhone.trim()})`
      : data.customerName.trim();

    let finalTrafficPageId: string | null = null;
    if (data.trafficPageTrackingId) {
      const { data: pageData } = await supabaseAdmin
        .from("traffic_pages")
        .select("id")
        .eq("tracking_id", data.trafficPageTrackingId)
        .maybeSingle();
      finalTrafficPageId = pageData?.id ?? null;
    }

    const { data: sale, error: saleError } = await supabaseAdmin
      .from("sales")
      .insert({
        product_id: product.id,
        user_id: product.user_id,
        customer_name: customerName.slice(0, 100),
        customer_phone: msisdn,
        amount,
        payment_method: data.method,
        status: "pending",
        traffic_page_id: finalTrafficPageId,
      })
      .select("id")
      .single();

    if (saleError || !sale) {
      console.error("sale insert error", saleError);
      return { success: false, error: "Não foi possível registar a venda." };
    }

    // Eventos: venda criada + pagamento solicitado (fire-and-forget)
    {
      const { enqueueWebhookEvent, processPendingForUser } =
        await import("@/lib/webhooks/dispatcher.server");
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

    const MERCHANT_NAME = "PagamentosMZ";
    const PAYMENT_DESCRIPTION = "Pagamento de produto digital";
    const {
      confirmSalePayment,
      markSaleTerminalFailure,
      normalizeGatewayStatus,
      paymentReferenceForSale,
      readGatewayTransactionId,
    } = await import("@/lib/payments/confirmation.server");
    const reference = paymentReferenceForSale(sale.id);
    const localPhone = msisdn.slice(3); // 9-digit local format expected by e2payments

    await supabaseAdmin.from("sales").update({ payment_reference: reference }).eq("id", sale.id);

    try {
      const token = await getAccessToken();
      const clientId = process.env.E2PAYMENT_CLIENT_ID!;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90_000);

      const endpoint =
        data.method === "mpesa"
          ? `${E2PAY_BASE_URL}/v1/c2b/mpesa-payment/${walletId}`
          : `${E2PAY_BASE_URL}/v1/c2b/emola-payment/${walletId}`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "PagamentosMZ/1.0",
        },
        body: JSON.stringify({
          client_id: clientId,
          amount: String(amount),
          phone: localPhone,
          reference,
          merchant_name: MERCHANT_NAME,
          description: PAYMENT_DESCRIPTION,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      const text = await res.text();
      let json: Record<string, unknown> | null = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { raw: text };
      }

      console.info("e2payment response", {
        status: res.status,
        method: data.method,
        endpoint,
        reference,
        body: text?.slice(0, 800),
      });

      const transactionId = readGatewayTransactionId(json);
      const finalStatus = normalizeGatewayStatus(json, res.ok);

      if (finalStatus === "paid") {
        await confirmSalePayment({ saleId: sale.id, transactionId, reference, rawPayload: json });
      } else if (finalStatus === "failed" || finalStatus === "expired") {
        const message =
          json?.message ||
          json?.error ||
          json?.detail ||
          (finalStatus === "expired" ? "Pagamento expirado." : "Pagamento recusado pelo gateway.");
        await markSaleTerminalFailure({
          saleId: sale.id,
          status: finalStatus,
          transactionId,
          reference,
          reason: String(message),
        });
        return { success: false, saleId: sale.id, error: String(message) };
      } else {
        await supabaseAdmin
          .from("sales")
          .update({
            status: "pending",
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
          payment_reference: reference,
        })
        .neq("status", "paid")
        .eq("id", sale.id);
      return {
        success: true,
        saleId: sale.id,
        transactionId: null,
      };
    }
  });
