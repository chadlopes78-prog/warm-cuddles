import { createFileRoute } from "@tanstack/react-router";
import { Settings, Shield, Globe, Bell, User, History, MessageSquare, PieChart, Smartphone, Lock, Trash2, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { PushNotificationManager } from "@/components/dashboard/PushNotificationManager";
import { WebhooksSection } from "@/components/dashboard/WebhooksSection";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_dashboard/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [pushcutUrl, setPushcutUrl] = useState("");
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      
      if (error && error.code !== "PGRST116") throw error;
      return { ...data, email: user.email };
    }
  });

  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name);
    if (profile?.pushcut_url !== undefined && profile?.pushcut_url !== null) {
      setPushcutUrl(profile.pushcut_url);
    }
  }, [profile]);

  const updatePushcut = useMutation({
    mutationFn: async (url: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase
        .from("profiles")
        .update({ pushcut_url: url || null, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Link Pushcut salvo!");
    },
    onError: (error: any) => toast.error("Erro ao salvar: " + error.message),
  });

  const updateProfile = useMutation({
    mutationFn: async (name: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: user.id,
          full_name: name,
          updated_at: new Date().toISOString()
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Perfil atualizado com sucesso!");
    },
    onError: (error: any) => {
      toast.error("Erro ao atualizar perfil: " + error.message);
    }
  });
  
  const resetData = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Não autenticado");

      // We need to delete data associated with the user
      // Note: This assumes tables have RLS allowing deletion or user_id columns
      
      // 1. Delete sales (assuming RLS allows or we use product relationship)
      // Since we don't have a direct user_id on sales (it's via products), 
      // we first find the product IDs owned by the user.
      const { data: userProducts } = await supabase
        .from("products")
        .select("id")
        .eq("user_id", user.id);
      
      const productIds = userProducts?.map(p => p.id) || [];

      if (productIds.length > 0) {
        // Delete sales for these products
        const { error: salesError } = await supabase
          .from("sales")
          .delete()
          .in("product_id", productIds);
        
        if (salesError) throw salesError;
        
        // Delete traffic events for these products/pages
        const { data: userPages } = await supabase
          .from("traffic_pages")
          .select("id")
          .in("product_id", productIds);
        
        const pageIds = userPages?.map(p => p.id) || [];
        
        if (pageIds.length > 0) {
          const { error: eventsError } = await supabase
            .from("traffic_events")
            .delete()
            .in("page_id", pageIds);
          
          if (eventsError) throw eventsError;
        }
      }

      // 2. Delete notification logs
      const { error: notifyError } = await supabase
        .from("notifications_log")
        .delete()
        .eq("user_id", user.id);
      
      if (notifyError) throw notifyError;

      // 3. Delete marketing alerts
      const { error: alertsError } = await supabase
        .from("marketing_alerts")
        .delete()
        .eq("user_id", user.id);
      
      if (alertsError) throw alertsError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("Todos os dados foram resetados com sucesso!");
      setIsResetDialogOpen(false);
      setResetConfirmText("");
    },
    onError: (error: any) => {
      toast.error("Erro ao resetar dados: " + error.message);
    }
  });

  if (isLoading) return <div className="p-8">Carregando...</div>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">Gerencie sua conta e preferências da plataforma.</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <CardTitle>Dados do Perfil</CardTitle>
            </div>
            <CardDescription>Atualize suas informações pessoais.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="full-name">Nome Completo</Label>
                <Input 
                  id="full-name" 
                  value={fullName} 
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Seu nome" 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={profile?.email || ""} disabled />
              </div>
            </div>
            <Button 
              onClick={() => updateProfile.mutate(fullName)}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle>Segurança</CardTitle>
            </div>
            <CardDescription>Gerencie sua senha e autenticação.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nova Senha</Label>
                <Input id="new-password" type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar Nova Senha</Label>
                <Input id="confirm-password" type="password" placeholder="••••••••" />
              </div>
            </div>
            <Button variant="outline" className="gap-2">
              <Lock className="h-4 w-4" />
              Alterar Senha
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-primary/5 to-transparent border-primary/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              <CardTitle>Instalar App (PWA)</CardTitle>
            </div>
            <CardDescription>Use o PaymentBlack como um aplicativo nativo no seu iPhone ou Android.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white dark:bg-slate-900 border shadow-sm">
                <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">1</span>
                </div>
                <div className="text-sm">
                  <p className="font-semibold">No iPhone (iOS):</p>
                  <p className="text-muted-foreground">Abra no Safari, clique no ícone de <span className="font-bold">Compartilhar</span> e selecione <span className="font-bold">"Adicionar à Tela de Início"</span>.</p>
                </div>
              </div>
              
              <div className="flex items-start gap-3 p-4 rounded-xl bg-white dark:bg-slate-900 border shadow-sm">
                <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-primary">2</span>
                </div>
                <div className="text-sm">
                  <p className="font-semibold">No Android:</p>
                  <p className="text-muted-foreground">Clique nos três pontos do navegador e selecione <span className="font-bold">"Instalar Aplicativo"</span>.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>


        <WebhooksSection />


        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" />
              <CardTitle>Integrações</CardTitle>
            </div>
            <CardDescription>Conecte outras plataformas ao seu checkout.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground italic">Em breve novas integrações disponíveis.</p>
          </CardContent>
        </Card>

        <Card className="border-red-200 dark:border-red-900/30 bg-red-50/30 dark:bg-red-900/10">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              <CardTitle className="text-red-600">Zona de Perigo</CardTitle>
            </div>
            <CardDescription>Ações irreversíveis para sua conta e dados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-red-100 dark:border-red-900/20 bg-white dark:bg-slate-900">
              <div className="space-y-1">
                <p className="font-bold text-slate-900">Limpar Dados / Reiniciar Sistema</p>
                <p className="text-sm text-slate-500">
                  Apaga todas as transações, vendas, valores e gráficos. Sua conta e produtos permanecem.
                </p>
              </div>
              
              <AlertDialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="font-bold uppercase tracking-wider text-xs px-6">
                    Reset Total
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="max-w-md rounded-2xl border-none shadow-2xl">
                  <AlertDialogHeader>
                    <div className="flex items-center gap-3 text-red-600 mb-2">
                      <div className="p-2 bg-red-100 rounded-xl">
                        <AlertTriangle className="h-6 w-6" />
                      </div>
                      <AlertDialogTitle className="text-2xl font-black uppercase tracking-tight">Atenção Crítica!</AlertDialogTitle>
                    </div>
                    <AlertDialogDescription className="text-slate-600 font-bold text-lg leading-snug">
                      Esta ação irá apagar permanentemente todas as suas vendas e métricas. <span className="text-red-600 underline">Não há como desfazer.</span>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  
                  <div className="py-6 space-y-4">
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <p className="text-xs font-black uppercase text-slate-400 mb-2 tracking-widest">Para confirmar, digite abaixo:</p>
                      <p className="text-sm font-black text-slate-900 mb-4 tracking-tighter uppercase select-none">CONFIRMAR RESET</p>
                      <Input 
                        value={resetConfirmText}
                        onChange={(e) => setResetConfirmText(e.target.value)}
                        placeholder="Digite aqui..."
                        className="h-12 border-2 focus-visible:ring-red-500 rounded-xl font-bold uppercase tracking-widest text-center"
                      />
                    </div>
                  </div>

                  <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel 
                      onClick={() => {
                        setResetConfirmText("");
                        setIsResetDialogOpen(false);
                      }}
                      className="h-12 rounded-xl font-bold border-2"
                    >
                      CANCELAR
                    </AlertDialogCancel>
                    <Button
                      variant="destructive"
                      disabled={resetConfirmText !== "CONFIRMAR RESET" || resetData.isPending}
                      onClick={() => resetData.mutate()}
                      className="h-12 rounded-xl font-bold uppercase tracking-widest"
                    >
                      {resetData.isPending ? "PROCESSANDO..." : "EXECUTAR RESET TOTAL"}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const Separator = () => <div className="h-px bg-slate-100 dark:bg-slate-800 w-full" />;
