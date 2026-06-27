import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/dashboard/DateRangePicker";
import { Loader2, Smartphone, Wallet, TrendingUp, Percent } from "lucide-react";
import { startOfDay, endOfDay, subDays } from "date-fns";

export const Route = createFileRoute("/_dashboard/payment-summary")({
  component: PaymentSummaryPage,
});

type Sale = { amount: number; bump_amount: number | null; payment_method: string | null; status: string | null };

const SUCCESS = new Set(["approved", "paid", "success"]);

function methodOf(m: string | null | undefined): "mpesa" | "emola" | "other" {
  const s = (m || "").toLowerCase();
  if (s.includes("mpesa") || s.includes("m-pesa")) return "mpesa";
  if (s.includes("emola") || s.includes("e-mola")) return "emola";
  return "other";
}

const fmt = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "MZN", maximumFractionDigits: 2 }).format(n);

function PaymentSummaryPage() {
  const now = new Date();
  const [range, setRange] = useState<{ from: Date; to: Date }>({
    from: startOfDay(subDays(now, 6)),
    to: endOfDay(now),
  });
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const { data } = await supabase
        .from("sales")
        .select("amount,bump_amount,payment_method,status")
        .eq("user_id", session.user.id)
        .gte("created_at", range.from.toISOString())
        .lte("created_at", range.to.toISOString());
      if (!cancelled) {
        setSales((data || []) as Sale[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const summary = useMemo(() => {
    const acc = {
      mpesa: { total: 0, count: 0 },
      emola: { total: 0, count: 0 },
    };
    for (const s of sales) {
      if (!SUCCESS.has((s.status || "").toLowerCase())) continue;
      const m = methodOf(s.payment_method);
      if (m === "other") continue;
      const amt = Number(s.amount || 0) + Number(s.bump_amount || 0);
      acc[m].total += amt;
      acc[m].count += 1;
    }
    const grand = acc.mpesa.total + acc.emola.total;
    return {
      mpesa: {
        ...acc.mpesa,
        avg: acc.mpesa.count ? acc.mpesa.total / acc.mpesa.count : 0,
        pct: grand ? (acc.mpesa.total / grand) * 100 : 0,
      },
      emola: {
        ...acc.emola,
        avg: acc.emola.count ? acc.emola.total / acc.emola.count : 0,
        pct: grand ? (acc.emola.total / grand) * 100 : 0,
      },
      grand,
    };
  }, [sales]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Resumo por Método de Pagamento</h1>
          <p className="text-sm text-slate-500 mt-1">Comparativo entre M-Pesa e e-Mola no período selecionado.</p>
        </div>
        <DateRangePicker
          initialPreset="last7days"
          initialRange={range}
          onRangeChange={(r) => setRange(r)}
        />
      </div>

      {loading ? (
        <div className="flex h-[300px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <MethodCard
              label="M-Pesa"
              icon={<Smartphone className="h-5 w-5" />}
              accent="bg-red-50 text-red-600 border-red-100"
              data={summary.mpesa}
            />
            <MethodCard
              label="e-Mola"
              icon={<Wallet className="h-5 w-5" />}
              accent="bg-amber-50 text-amber-600 border-amber-100"
              data={summary.emola}
            />
          </div>

          <Card className="rounded-2xl border-slate-100 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-bold">Faturamento Total no Período</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-black tracking-tight text-slate-900">{fmt(summary.grand)}</p>
              <p className="mt-1 text-sm text-slate-500">
                {summary.mpesa.count + summary.emola.count} transações concluídas
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MethodCard({
  label, icon, accent, data,
}: {
  label: string;
  icon: React.ReactNode;
  accent: string;
  data: { total: number; count: number; avg: number; pct: number };
}) {
  return (
    <Card className="rounded-2xl border-slate-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-bold text-slate-900">{label}</CardTitle>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${accent}`}>{icon}</div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total recebido</p>
          <p className="text-2xl font-black tracking-tight text-slate-900">{fmt(data.total)}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100">
          <Stat label="Transações" value={String(data.count)} />
          <Stat
            label="Ticket médio"
            value={fmt(data.avg)}
            icon={<TrendingUp className="h-3 w-3" />}
          />
          <Stat
            label="% do total"
            value={`${data.pct.toFixed(1)}%`}
            icon={<Percent className="h-3 w-3" />}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
        {icon}{label}
      </p>
      <p className="mt-1 text-sm font-bold text-slate-900 truncate">{value}</p>
    </div>
  );
}
