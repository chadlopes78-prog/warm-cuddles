import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/_dashboard/recovery")({
  component: RecoveryPage,
});

function RecoveryPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Recuperação de Carrinhos</h1>
        <p className="text-muted-foreground">Recupere vendas perdidas através de WhatsApp e Email.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Carrinhos Abandonados</CardTitle>
          <CardDescription>Lista de clientes que iniciaram o checkout mas não completaram o pagamento.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <MessageSquare className="h-6 w-6 text-slate-400" />
          </div>
          <p className="text-slate-500">Nenhum abandono de carrinho registrado.</p>
        </CardContent>
      </Card>
    </div>
  );
}
