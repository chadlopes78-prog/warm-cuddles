import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, CheckCheck, Trash2, Search, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_dashboard/notifications")({
  component: NotificationsPage,
});

type NotifType = "sale" | "daily_report" | "motivation" | "system" | "sale.failed" | "checkout.abandoned" | "all";

const TYPE_LABELS: Record<string, string> = {
  sale: "Venda",
  "sale.failed": "Falha",
  daily_report: "Relatório",
  motivation: "Motivação",
  system: "Sistema",
  "checkout.abandoned": "Abandono",
};

const TYPE_COLORS: Record<string, string> = {
  sale: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  "sale.failed": "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  daily_report: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  motivation: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  system: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "checkout.abandoned": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<NotifType>("all");

  const fetchNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let q = supabase
      .from("notifications_log")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (typeFilter !== "all") q = q.eq("type", typeFilter);

    const { data } = await q;
    setNotifications((data ?? []) as Notification[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchNotifications();
  }, [typeFilter]);

  const markAllRead = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("notifications_log")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    await fetchNotifications();
    toast.success("Todas marcadas como lidas");
  };

  const markRead = async (id: string) => {
    await supabase
      .from("notifications_log")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
  };

  const deleteNotif = async (id: string) => {
    await supabase.from("notifications_log").delete().eq("id", id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const deleteAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("notifications_log").delete().eq("user_id", user.id);
    setNotifications([]);
    toast.success("Todas as notificações removidas");
  };

  const filtered = notifications.filter(
    (n) =>
      n.title.toLowerCase().includes(search.toLowerCase()) ||
      n.body.toLowerCase().includes(search.toLowerCase())
  );

  const unread = notifications.filter((n) => !n.read_at).length;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `${diffMin}m atrás`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h atrás`;
    return d.toLocaleDateString("pt-MZ", { day: "2-digit", month: "short" });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-black tracking-tight">Notificações</h1>
            {unread > 0 && (
              <p className="text-sm text-muted-foreground">{unread} não lida{unread !== 1 ? "s" : ""}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {unread > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <CheckCheck className="h-4 w-4 mr-1" />
              Marcar todas
            </Button>
          )}
          {notifications.length > 0 && (
            <Button variant="outline" size="sm" onClick={deleteAll} className="text-red-600 hover:text-red-700">
              <Trash2 className="h-4 w-4 mr-1" />
              Limpar
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar notificações..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as NotifType)}>
          <SelectTrigger className="w-36">
            <Filter className="h-4 w-4 mr-1" />
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="sale">Vendas</SelectItem>
            <SelectItem value="sale.failed">Falhas</SelectItem>
            <SelectItem value="daily_report">Relatórios</SelectItem>
            <SelectItem value="system">Sistema</SelectItem>
            <SelectItem value="checkout.abandoned">Abandonos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center text-muted-foreground gap-2">
          <Bell className="h-8 w-8 opacity-30" />
          <p className="text-sm font-medium">Nenhuma notificação encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read_at && markRead(n.id)}
              className={cn(
                "relative flex gap-3 rounded-xl border p-4 transition-all cursor-pointer hover:border-border/80",
                !n.read_at
                  ? "bg-accent/50 border-primary/20"
                  : "bg-card border-border"
              )}
            >
              {!n.read_at && (
                <span className="absolute right-4 top-4 h-2 w-2 rounded-full bg-primary" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="font-semibold text-sm leading-tight">{n.title}</span>
                  <Badge
                    className={cn(
                      "text-xs px-1.5 py-0 h-5 font-medium",
                      TYPE_COLORS[n.type] ?? TYPE_COLORS.system
                    )}
                  >
                    {TYPE_LABELS[n.type] ?? n.type}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{n.body}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">{formatDate(n.created_at)}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNotif(n.id);
                }}
                className="shrink-0 p-1 text-muted-foreground/40 hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
