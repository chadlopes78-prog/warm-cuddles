import { createFileRoute, Outlet, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  LayoutDashboard,
  Package,
  Users,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  CreditCard,
  BarChart3,
  ChevronDown,
  Globe,
  Menu,
  X,
  Target,
  Zap,
  AlertCircle,
  Loader2,
  Receipt
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { subscribeToPushNotifications } from "@/lib/push-notifications";
import { isAdminEmail } from "@/lib/admins";

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayoutWrapper,
  errorComponent: ({ error, reset }) => <ErrorFallback error={error} reset={reset} />,
});

function ErrorFallback({ error, reset }: { error: any; reset: () => void }) {
  return (
    <div className="flex h-[400px] w-full flex-col items-center justify-center p-6 text-center">
      <Alert variant="destructive" className="max-w-md bg-white border-red-100 shadow-xl rounded-2xl p-6">
        <AlertCircle className="h-6 w-6 mb-4 mx-auto text-red-500" />
        <AlertTitle className="text-xl font-black text-slate-900 mb-2">Erro ao carregar painel</AlertTitle>
        <AlertDescription className="text-slate-500 font-medium mb-6">
          {error?.message || "Houve um problema técnico ao renderizar esta seção."}
        </AlertDescription>
        <Button 
          onClick={() => reset()} 
          className="w-full bg-black hover:bg-slate-900 text-white font-bold rounded-xl h-12"
        >
          Tentar novamente
        </Button>
      </Alert>
    </div>
  );
}

function DashboardLayoutWrapper() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-full items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest animate-pulse">
            Carregando PaymentBlack...
          </p>
        </div>
      </div>
    }>
      <DashboardLayout />
    </Suspense>
  );
}

function DashboardLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState<string[]>(["Relatórios"]);
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const checkStatus = (p: any) => {
      if (p?.status === "banned") {
        navigate({ to: "/blocked" });
      } else if (p?.status === "rejected") {
        navigate({ to: "/blocked" });
      } else if (p?.status === "pending") {
        navigate({ to: "/waiting-approval" });
      }
    };


    const checkAuth = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        
        if (!session) {
          navigate({ to: "/auth" });
          return;
        }

        // ADMIN BYPASS TOTAL
        if (isAdminEmail(session.user.email)) {
          setUser(session.user);
          setProfile({ role: 'admin' });
          return;
        }

        // Fetch profile to check status and role
        const { data: userProfile, error } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();

        if (error) throw error;

        if (!userProfile) {
          // If profile doesn't exist, create it as pending (requires admin approval)
          const { data: newProfile, error: upsertError } = await supabase
            .from("profiles")
            .upsert({ 
              id: session.user.id,
              full_name: session.user.user_metadata?.full_name || '',
              status: 'pending',
              role: 'user'
            })
            .select()
            .maybeSingle();
          
          if (upsertError) throw upsertError;

          if (newProfile) {
            setProfile(newProfile);
            checkStatus(newProfile);
          }
        } else {
          setProfile(userProfile);
          checkStatus(userProfile);
        }
        
        setUser(session.user);
        
        // Update last login
        await supabase.from("profiles").update({ last_login: new Date().toISOString() }).eq("id", session.user.id);

        // Auto-subscribe/update push notifications
        // We do this silently on every dashboard layout mount to ensure tokens are fresh
        if ("Notification" in window) {
          subscribeToPushNotifications(true).catch(err => 
            console.error("Error silently updating push token:", err)
          );
        }

        // Realtime sales notification for in-app toasts
        const channel = supabase
          .channel(`user-sales-${session.user.id}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'sales',
              filter: `user_id=eq.${session.user.id}`
            },
            (payload: any) => {
              // Only notify if status changed to paid
              if (payload.new.status === 'paid' && payload.old.status !== 'paid') {
                const amount = payload.new.amount;
                toast.success(
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-sm uppercase tracking-widest text-emerald-600">🔔 Nova Venda</span>
                    <span className="text-lg font-black text-slate-900 leading-none tracking-tighter">💰 Pingou🎉 {amount} MT</span>
                  </div>,
                  {
                    icon: (
                      <div className="bg-black p-2 rounded-xl border border-slate-800 shadow-2xl flex items-center justify-center animate-bounce">
                        <CreditCard className="h-4 w-4 text-white" />
                      </div>
                    ),
                    duration: 8000,
                  }
                );
              }
            }
          )
          .subscribe();

        return () => {
          supabase.removeChannel(channel);
        };
        return () => {};
      } catch (err) {
        console.error("Auth check error:", err);
        navigate({ to: "/auth" });
      }
    };

    checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        navigate({ to: "/auth" });
      } else {
        setUser(session.user);
        if (isAdminEmail(session.user.email)) {
          setProfile({ role: 'admin' });
        } else {
          const { data: p } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
          if (p) {
            setProfile(p);
            checkStatus(p);
          }
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const menuItems = [
    { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
    { name: "Produtos", icon: Package, path: "/products" },
    { name: "Transações", icon: Receipt, path: "/transactions" },
    { name: "Clientes", icon: Users, path: "/customers" },
    { name: "Relatórios", icon: BarChart3, path: "/dashboard" },
    { name: "Pixel Facebook", icon: Target, path: "/pixel" },
    { name: "Assistente IA", icon: Zap, path: "/dashboard", params: { tab: 'ai' } },
    ...(profile?.role === 'admin' || isAdminEmail(user?.email) ? [{ name: "Painel Operacional", icon: ShieldCheck, path: "/admin" }] : []),
    { name: "Configurações", icon: Settings, path: "/settings" },
  ];

  const toggleMenu = (name: string) => {
    setExpandedMenus(prev => 
      prev.includes(name) ? prev.filter(m => m !== name) : [...prev, name]
    );
  };

  if (!user) return null;

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-6">
        <Link to="/dashboard" className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-black border border-slate-800 shadow-lg">
            <span className="text-lg font-black text-white">P</span>
          </div>
          {(isSidebarOpen || isMobileMenuOpen) && (
            <span className="text-lg font-bold tracking-tight truncate">Paymentblack</span>
          )}
        </Link>
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 p-3">
        {menuItems.map((item) => {
          const isExpanded = expandedMenus.includes(item.name);
          const subItems = (item as { subItems?: { name: string; icon: typeof item.icon; path: string }[] }).subItems;
          const hasSubItems = !!subItems && subItems.length > 0;
          const isActive = location.pathname === item.path || (hasSubItems && subItems!.some(sub => location.pathname === sub.path));

          return (
            <div key={item.name} className="space-y-1">
              {hasSubItems ? (
                <button
                  onClick={() => toggleMenu(item.name)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100",
                    isActive ? "bg-primary/5 text-primary" : "text-slate-600",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="h-5 w-5 shrink-0" />
                    {(isSidebarOpen || isMobileMenuOpen) && <span>{item.name}</span>}
                  </div>
                  {(isSidebarOpen || isMobileMenuOpen) && (
                    <ChevronDown className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")} />
                  )}
                </button>
              ) : (
                <Link
                  to={item.path}
                  search={item.params}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all hover:bg-slate-100 active:scale-95",
                    isActive ? "bg-slate-100 text-slate-900" : "text-slate-600",
                  )}
                >
                  <item.icon className={cn("h-5 w-5 shrink-0", isActive ? "text-slate-900" : "text-slate-500")} />
                  {(isSidebarOpen || isMobileMenuOpen) && <span>{item.name}</span>}
                </Link>
              )}

              {hasSubItems && isExpanded && (isSidebarOpen || isMobileMenuOpen) && (
                <div className="ml-4 space-y-1 border-l pl-4">
                  {subItems!.map((subItem) => (
                    <Link
                      key={subItem.path}
                      to={subItem.path}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-slate-100",
                        location.pathname === subItem.path ? "bg-primary/5 text-primary" : "text-slate-600",
                      )}
                    >
                      <subItem.icon className="h-4 w-4 shrink-0" />
                      <span>{subItem.name}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-3">
        <Separator className="mb-3" />
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {(isSidebarOpen || isMobileMenuOpen) && <span>Sair</span>}
        </button>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="mt-2 hidden lg:flex w-full items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-100"
        >
          {isSidebarOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50/50">
      <div className="fixed top-0 left-0 right-0 z-50 flex h-16 items-center justify-between border-b bg-white px-4 lg:hidden">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-black border border-slate-800 shadow-sm">
            <span className="text-lg font-black text-white">P</span>
          </div>
          <span className="text-lg font-bold tracking-tight">Paymentblack</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="rounded-full hover:bg-slate-100"
        >
          {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-64 border-r bg-white transition-transform duration-300 lg:hidden",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent />
      </aside>

      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen border-r bg-white transition-all duration-300 lg:block",
          isSidebarOpen ? "w-64" : "w-20",
        )}
      >
        <SidebarContent />
      </aside>

      <main className={cn(
        "flex-1 transition-all duration-300 pt-16 lg:pt-0", 
        isSidebarOpen ? "lg:ml-64" : "lg:ml-20"
      )}>
        <div className="p-4 md:p-8">
          <Suspense fallback={
            <div className="flex h-[400px] w-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary/20" />
            </div>
          }>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}