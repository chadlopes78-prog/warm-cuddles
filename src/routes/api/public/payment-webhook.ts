import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/payment-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bodyText = await request.text();
        let payload: unknown = null;
        try {
          payload = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // Optional shared-secret verification. Some gateways support headers,
        // others only echo the callback URL query string; accept both without
        // making the public webhook unusable when a secret is configured.
        const expectedSecret = process.env.PAYMENT_WEBHOOK_SECRET;
        if (expectedSecret) {
          const url = new URL(request.url);
          const sent =
            request.headers.get("x-webhook-secret") ||
            request.headers.get("x-payment-secret") ||
            request.headers.get("x-webhook-token") ||
            request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
            url.searchParams.get("token") ||
            url.searchParams.get("secret") ||
            "";
          if (sent !== expectedSecret) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const {
          confirmSalePayment,
          findSaleForGatewayEvent,
          markSaleTerminalFailure,
          normalizeGatewayStatus,
          readGatewayMessage,
          readGatewayReference,
          readGatewayTransactionId,
        } = await import("@/lib/payments/confirmation.server");

        const transactionId = readGatewayTransactionId(payload);
        const reference = readGatewayReference(payload);

        if (!transactionId && !reference) {
          return new Response("Missing transaction id/reference", { status: 400 });
        }

        const status = normalizeGatewayStatus(payload, true);
        const payloadObject =
          payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
        const saleData = await findSaleForGatewayEvent(transactionId, reference);
        if (!saleData) {
          console.error("Sale not found for webhook", { transactionId, reference });
          return new Response("Sale not found", { status: 404 });
        }

        if (status === "paid") {
          console.log("[Webhook] payment webhook received", {
            orderId: saleData.id,
            paymentStatus: status,
            transactionId,
            reference,
          });
          await confirmSalePayment({
            saleId: saleData.id,
            transactionId,
            reference,
            rawPayload: payload,
            triggerPushcut: true,
          });
        } else if (status === "failed" || status === "expired") {
          console.log("[Webhook] Sale failed:", saleData.id);
          await markSaleTerminalFailure({
            saleId: saleData.id,
            status,
            transactionId,
            reference,
            reason: readGatewayMessage(payload) ?? String(payloadObject.message ?? payloadObject.error ?? status),
            method: saleData.payment_method ?? null,
          });
        }

        return Response.json({ ok: true, status });
      },
    },
  },
});
