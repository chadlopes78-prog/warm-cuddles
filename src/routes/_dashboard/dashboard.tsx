import { useState, useMemo, lazy, Suspense, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  TrendingUp,
  TrendingDown,
  CreditCard,
  DollarSign,
  ShoppingCart,
  AlertCircle,
  BarChart3,
  AlertTriangle,
  RefreshCcw,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRangePicker, DateRangePreset } from "@/components/dashboard/DateRangePicker";
import {
  format,
  subDays,
  differenceInDays,
  startOfDay,
  endOfDay,
  parseISO,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

const PerformanceChart = lazy(() => import("@/components/dashboard/PerformanceChart"));

export const Route = createFileRoute("/_dashboard/dashboard")({
  validateSearch: (search: Record<string, unknown>) => {
    return { tab: (search.tab as string) || "overview" };
  },
  component: DashboardPage,
});

const QUICK_FILTERS: { label: string; preset: DateRangePreset; getRange: () => { from: Date; to: Date } }[] = [
  {
    label: "Hoje",
    preset: "today",
    getRange: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }),
  },
  {
    label: "Esta semana",
    preset: "last7days",
    getRange: () => ({ from: startOfWeek(new Date(), { locale: ptBR }), to: endOfDay(new Date()) }),
  },
  {
    label: "Este mês",
    preset: "thisMonth",
    getRange: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }),
  },
  {
    label: "Este ano",
    preset: "thisYear",
    getRange: () => ({ from: startOfYear(new Date()), to: endOfYear(new Date()) }),
  },
];

function DashboardPage() {
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>(() => {
    const saved = sessionStorage.getItem("dashboard-date-range");
    if (saved) {
      try {
        const { from, to } = JSON.parse(saved);
        return { from: new Date(from), to: new Date(to) };
      } catch { /* ignore */ }
    }
    return { from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) };
  });

  const [preset, setPreset] = useState<DateRangePreset>(
    () => (sessionStorage.getItem("dashboard-preset") as DateRangePreset) || "last7days"
  );

  const queryClient = useQueryClient();

  const { data: dashboardData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["dashboard-metrics", dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_start_date: dateRange.from.toISOString(),
        p_end_date: dateRange.to.toISOString(),
      });

      if (error) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw error;

        const { data: sales, error: salesError } = await supabase
          .from("sales")
          .select("amount, status, created_at, products(name)")
          .eq("user_id", user.id)
          .gte("created_at", dateRange.from.toISOString())
          .lte("created_at", dateRange.to.toISOString());

        if (salesError) throw salesError;

        const stats = {
          total_transactions: sales.length,
          success_count: sales.filter(s => s.status && ["approved", "paid", "success"].includes(s.status)).length,
          failed_count: sales.filter(s => s.status && ["failed", "error", "cancelled", "canceled"].includes(s.status)).length,
          total_value: sales.reduce((acc, s) => acc + Number(s.amount), 0),
          received_value: sales.filter(s => s.status && ["approved", "paid", "success"].includes(s.status)).reduce((acc, s) => acc + Number(s.amount), 0),
          lost_value: sales.filter(s => s.status && ["failed", "error", "cancelled", "canceled"].includes(s.status)).reduce((acc, s) => acc + Number(s.amount), 0),
        };

        const recentSales = sales.slice(0, 10).map(s => ({ ...s, product_name: (s.products as any)?.name }));

        const dailyMap = new Map();
        sales.forEach(s => {
          if (!s.created_at) return;
          const day = startOfDay(parseISO(s.created_at)).toISOString();
          const current = dailyMap.get(day) || { sucesso: 0, falha: 0 };
          if (s.status && ["approved", "paid", "success"].includes(s.status)) current.sucesso++;
          else if (s.status && ["failed", "error"].includes(s.status)) current.falha++;
          dailyMap.set(day, current);
        });

        return { stats, chartData: Array.from(dailyMap.entries()).map(([day, val]) => ({ day, ...val })), recentSales };
      }

      const result = data as any;
      const rawChartData = result.chartData || [];
      const stats = result.stats || { total_transactions: 0, success_count: 0, failed_count: 0, total_value: 0, received_value: 0, lost_value: 0 };
      const recentSales = result.recentSales || [];

      const days = differenceInDays(dateRange.to, dateRange.from) + 1;
      const formattedChartData = [];
      for (let i = 0; i < days; i++) {
        const dayDate = startOfDay(subDays(dateRange.to, days - 1 - i));
        const dayStr = format(dayDate, "yyyy-MM-dd");
        const dayLabel = format(dayDate, "dd/MM", { locale: ptBR });
        const existingDay = rawChartData.find((d: any) => d.day && format(parseISO(d.day), "yyyy-MM-dd") === dayStr);
        formattedChartData.push({
          name: dayLabel,
          sucesso: existingDay ? Number(existingDay.sucesso || 0) : 0,
          falha: existingDay ? Number(existingDay.falha || 0) : 0,
        });
      }

      return { stats, chartData: formattedChartData, recentSales };
    },
    staleTime: 1000 * 10,
    retry: 1,
  });

  const handleRangeChange = (range: { from: Date; to: Date }, newPreset: DateRangePreset) => {
    setDateRange(range);
    setPreset(newPreset);
    sessionStorage.setItem("dashboard-date-range", JSON.stringify(range));
    sessionStorage.setItem("dashboard-preset", newPreset);
  };

  const handleQuickFilter = (filter: typeof QUICK_FILTERS[number]) => {
    const range = filter.getRange();
    handleRangeChange(range, filter.preset);
  };

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.user?.id) return;
      channel = supabase
        .channel(`dashboard-sales-${session.user.id}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `user_id=eq.${session.user.id}` }, () => {
          queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { heroKpis, metricCards } = useMemo(() => {
    if (!dashboardData) return { heroKpis: [], metricCards: [] };

    const { stats } = dashboardData;
    const total = Number(stats.total_transactions) || 0;
    const success = Number(stats.success_count) || 0;
    const receivedGross = Number(stats.received_value) || 0;
    // Gateway fee: 15% + 15 MZN per approved transaction
    const gatewayFee = receivedGross * 0.15 + success * 15;
    const received = Math.max(0, receivedGross - gatewayFee);
    const conversionRate = total > 0 ? (success / total) * 100 : 0;
    const avgTicket = success > 0 ? received / success : 0;

    const fmtMT = (v: number) =>
      `${Number(v).toLocaleString("pt-MZ", { maximumFractionDigits: 0 })} MT`;

    return {
      heroKpis: [
        {
          title: "Receita Líquida",
          value: fmtMT(received),
          sub: `Bruto ${fmtMT(receivedGross)} − taxa ${fmtMT(gatewayFee)}`,
          icon: DollarSign,
          color: "emerald",
        },
        {
          title: "Taxa de Conversão",
          value: `${conversionRate.toFixed(1)}%`,
          sub: `${success} aprovadas de ${total} tentativas`,
          icon: TrendingUp,
          color: "blue",
        },
        {
          title: "Ticket Médio",
          value: fmtMT(avgTicket),
          sub: "Por venda aprovada, após taxa",
          icon: ArrowUpRight,
          color: "violet",
        },
      ],
      metricCards: [
        { label: "Transações", value: String(stats.total_transactions), icon: ShoppingCart, color: "slate" },
        { label: "Aprovadas", value: String(stats.success_count), icon: TrendingUp, color: "emerald" },
        { label: "Falhas", value: String(stats.failed_count), icon: TrendingDown, color: "rose" },
        { label: "Volume total", value: fmtMT(Number(stats.total_value)), icon: CreditCard, color: "blue" },
        { label: "Perdido", value: fmtMT(Number(stats.lost_value)), icon: AlertCircle, color: "rose" },
      ],
    };
  }, [dashboardData]);

  const colorMap: Record<string, { border: string; icon: string; badge: string; text: string }> = {
    emerald: { border: "border-emerald-500", icon: "bg-emerald-50 text-emerald-600", badge: "bg-emerald-500", text: "text-emerald-600" },
    blue: { border: "border-blue-500", icon: "bg-blue-50 text-blue-600", badge: "bg-blue-500", text: "text-blue-600" },
    violet: { border: "border-violet-500", icon: "bg-violet-50 text-violet-600", badge: "bg-violet-500", text: "text-violet-600" },
    rose: { border: "border-rose-500", icon: "bg-rose-50 text-rose-600", badge: "bg-rose-500", text: "text-rose-600" },
    slate: { border: "border-slate-700", icon: "bg-slate-100 text-slate-700", badge: "bg-slate-700", text: "text-slate-700" },
  };

  if (isLoading) {
    return (
      <div className="space-y-6 pb-12 max-w-[1400px] mx-auto animate-in fade-in duration-300">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-border">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-72" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-36 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-[380px] rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <AlertTriangle className="h-10 w-10 text-rose-400" />
        <p className="text-sm font-semibold text-muted-foreground">Erro ao carregar dados.</p>
        <Button onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCcw className="mr-2 h-4 w-4" /> Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 max-w-[1400px] mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col gap-4 pb-6 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            {isFetching && <RefreshCcw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <DateRangePicker onRangeChange={handleRangeChange} initialPreset={preset} initialRange={dateRange} />
        </div>

        {/* Quick filter tabs */}
        <div className="flex flex-wrap gap-2">
          {QUICK_FILTERS.map(filter => {
            const active = preset === filter.preset;
            return (
              <button
                key={filter.preset}
                onClick={() => handleQuickFilter(filter)}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-medium transition-all",
                  active
                    ? "bg-foreground text-background shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hero KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {heroKpis.map(kpi => {
          const c = colorMap[kpi.color];
          return (
            <Card key={kpi.title} className={cn("border-l-4 shadow-sm rounded-2xl", c.border)}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{kpi.title}</p>
                  <div className={cn("p-2 rounded-lg", c.icon)}>
                    <kpi.icon className="h-4 w-4" />
                  </div>
                </div>
                <p className={cn("text-3xl font-bold tracking-tight", c.text)}>{kpi.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Secondary metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {metricCards.map(m => {
          const c = colorMap[m.color];
          return (
            <Card key={m.label} className="shadow-sm rounded-xl">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground">{m.label}</p>
                  <div className={cn("p-1.5 rounded-md", c.icon)}>
                    <m.icon className="h-3.5 w-3.5" />
                  </div>
                </div>
                <p className="text-xl font-bold text-foreground truncate">{m.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Performance chart */}
      <Card className="shadow-sm rounded-2xl">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Performance de Vendas</CardTitle>
          </div>
          <CardDescription className="text-xs">Aprovadas vs. falhas no período selecionado</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <Suspense fallback={<div className="h-[340px] w-full rounded-xl bg-muted animate-pulse" />}>
            <PerformanceChart data={dashboardData.chartData} />
          </Suspense>
        </CardContent>
      </Card>

      {/* Recent activity */}
      <Card className="shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle className="text-sm font-semibold">Atividade Recente</CardTitle>
          <CardDescription className="text-xs">Últimas transações do seu checkout</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {dashboardData.recentSales && dashboardData.recentSales.length > 0 ? (
            <div className="divide-y divide-border">
              {dashboardData.recentSales.map((sale: any) => {
                const isSuccess = ["paid", "approved", "success"].includes(sale.status);
                const isFail = ["failed", "error"].includes(sale.status);
                return (
                  <div key={sale.id} className="flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "h-9 w-9 rounded-full flex items-center justify-center",
                        isSuccess ? "bg-emerald-100 text-emerald-600" : isFail ? "bg-rose-100 text-rose-500" : "bg-blue-100 text-blue-600"
                      )}>
                        {isSuccess ? <TrendingUp className="h-4 w-4" /> : isFail ? <TrendingDown className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground leading-tight">
                          {sale.product_name || "Produto"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {sale.customer_name || "—"} · {format(parseISO(sale.created_at), "dd/MM HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase",
                        isSuccess ? "bg-emerald-100 text-emerald-700" : isFail ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-blue-700"
                      )}>
                        {isSuccess ? "Aprovado" : isFail ? "Falhou" : "Pendente"}
                      </span>
                      <p className="text-sm font-bold text-foreground tabular-nums">
                        {Number(sale.amount).toLocaleString("pt-MZ")} MT
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShoppingCart className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">Nenhuma transação no período</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
