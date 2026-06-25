import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { getPaymentSuccessData } from "@/lib/api/payments.functions";

import { CheckCircle2, ArrowRight, MessageCircle, Loader2 } from "lucide-react";
import { z } from "zod";

const successSearchSchema = z.object({
  saleId: z.string().optional(),
  productId: z.string().optional(),
});

type SaleSuccessData = {
  sale: { status?: string | null } | null;
  product: {
    access_link?: string | null;
    delivery_link?: string | null;
    support_phone?: string | null;
    support_number?: string | null;
    thank_you_button_text?: string | null;
    thank_you_url?: string | null;
  } | null;
};

export const Route = createFileRoute("/payment-success")({
  validateSearch: successSearchSchema,
  component: PaymentSuccessPage,
});

function PaymentSuccessPage() {
  const { saleId } = Route.useSearch();
  const [data, setData] = useState<SaleSuccessData | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const fetchPaymentData = useServerFn(getPaymentSuccessData);

  useEffect(() => {
    if (!saleId) return;

    let cancelled = false;
    let attempts = 0;
    // Fast cadence first (1.2s), then slow (3s). Total ~3min.
    const FAST_ATTEMPTS = 25;
    const MAX_ATTEMPTS = 80;
    const TERMINAL = ["paid", "approved", "success", "completed", "failed", "expired", "cancelled", "canceled"];

    const poll = async () => {
      while (!cancelled && attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
          const result = await fetchPaymentData({ data: { saleId } });
          if (cancelled) return;
          if (result) {
            setData(result);
            const status = String(result.sale?.status ?? "").toLowerCase();
            if (TERMINAL.includes(status)) return;
          }
        } catch (e) {
          console.error("[payment-success] poll error", e);
        }
        const delay = attempts < FAST_ATTEMPTS ? 1200 : 3000;
        await new Promise((r) => setTimeout(r, delay));
      }
      if (!cancelled) setTimedOut(true);
    };

    poll();

    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        fetchPaymentData({ data: { saleId } })
          .then((r) => r && setData(r))
          .catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [saleId, fetchPaymentData]);

  const product = data?.product;
  const status = String(data?.sale?.status ?? "").toLowerCase();
  const isPaid = ["paid", "approved", "success", "completed"].includes(status);
  const accessLink = product?.access_link || product?.delivery_link;
  const supportNumber = product?.support_number || product?.support_phone || "258840000000";
  const buttonText = (product?.thank_you_button_text || "Liberar acesso").trim();

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md text-center space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="space-y-6">
          <div className="h-20 w-20 rounded-full bg-emerald-50 flex items-center justify-center mx-auto">
            {isPaid ? (
              <CheckCircle2 className="h-10 w-10 text-emerald-500" strokeWidth={2.2} />
            ) : (
              <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" strokeWidth={2.2} />
            )}
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
              {isPaid
                ? "Obrigado por confiar na gente"
                : timedOut
                  ? "Confirmação em processamento"
                  : "A confirmar pagamento"}
            </h1>
            <p className="text-slate-500 text-base md:text-lg">
              {isPaid
                ? "Para liberar o seu acesso, clique no botão abaixo"
                : timedOut
                  ? "Se o valor saiu da sua conta, a venda será aprovada automaticamente assim que o banco finalizar a confirmação."
                  : "Assim que a confirmação chegar, o acesso será liberado automaticamente."}
            </p>
          </div>
        </div>

        {isPaid && accessLink ? (
          <a
            href={accessLink}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex w-full items-center justify-center gap-2 h-16 px-8 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white text-lg font-semibold shadow-xl shadow-emerald-200/70 transition-all duration-200 active:scale-[0.98] animate-[pulse_2.4s_ease-in-out_infinite]"
          >
            {buttonText}
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </a>
        ) : isPaid ? (
          <p className="text-slate-500 text-sm">
            O seu acesso será enviado em breve. Em caso de dúvida, contacte o suporte.
          </p>
        ) : (
          <p className="text-slate-500 text-sm">
            {timedOut
              ? "Pode falar com o suporte com o comprovativo se precisar de ajuda imediata."
              : "Mantenha esta página aberta. O pagamento ainda está pendente de confirmação."}
          </p>
        )}

        <a
          href={`https://wa.me/${supportNumber.replace(/\D/g, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <MessageCircle className="h-4 w-4" /> Precisa de ajuda? Falar com suporte
        </a>
      </div>
    </div>
  );
}
