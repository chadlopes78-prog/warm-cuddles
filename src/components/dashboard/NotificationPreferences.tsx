import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Prefs = {
  "sale.approved": boolean;
  "sale.pending": boolean;
  "sale.failed": boolean;
  "checkout.abandoned": boolean;
  refund: boolean;
  new_customer: boolean;
  daily_summary: boolean;
};

const DEFAULT_PREFS: Prefs = {
  "sale.approved": true,
  "sale.pending": true,
  "sale.failed": true,
  "checkout.abandoned": true,
  refund: true,
  new_customer: true,
  daily_summary: true,
};

const PREF_LABELS: { key: keyof Prefs; label: string; desc: string }[] = [
  { key: "sale.approved", label: "Venda confirmada", desc: "Pagamento recebido com sucesso" },
  { key: "sale.pending", label: "Pagamento pendente", desc: "Aguardando confirmação do pagamento" },
  { key: "sale.failed", label: "Pagamento falhado", desc: "Tentativa de pagamento rejeitada" },
  { key: "checkout.abandoned", label: "Carrinho abandonado", desc: "Cliente saiu sem concluir o pagamento" },
  { key: "refund", label: "Reembolso", desc: "Valor devolvido ao cliente" },
  { key: "new_customer", label: "Novo cliente", desc: "Primeiro acesso de um novo comprador" },
  { key: "daily_summary", label: "Resumo diário", desc: "Relatório das últimas 24 horas" },
];

export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setPrefs({
          "sale.approved": data["sale.approved"] ?? true,
          "sale.pending": data["sale.pending"] ?? true,
          "sale.failed": data["sale.failed"] ?? true,
          "checkout.abandoned": data["checkout.abandoned"] ?? true,
          refund: data.refund ?? true,
          new_customer: data.new_customer ?? true,
          daily_summary: data.daily_summary ?? true,
        });
      }
      setLoaded(true);
    };
    load();
  }, []);

  const toggle = async (key: keyof Prefs, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("notification_preferences").upsert(
        { user_id: user.id, ...updated, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );
    } catch {
      toast.error("Erro ao salvar preferência");
      setPrefs(prefs); // revert
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="h-32 flex items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;

  return (
    <div className="space-y-3">
      {PREF_LABELS.map(({ key, label, desc }) => (
        <div key={key} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
          <div>
            <Label className="font-medium text-sm">{label}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </div>
          <Switch
            checked={prefs[key]}
            onCheckedChange={(v) => toggle(key, v)}
            disabled={saving}
          />
        </div>
      ))}
    </div>
  );
}
