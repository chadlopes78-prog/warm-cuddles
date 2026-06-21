import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { 
  CheckCircle2, 
  Download, 
  ExternalLink, 
  ArrowRight,
  Package,
  Calendar,
  CreditCard,
  Hash,
  ShieldCheck,
  LayoutDashboard,
  MessageCircle,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";

import { z } from "zod";

const successSearchSchema = z.object({
  productId: z.string().optional(),
  saleId: z.string().optional(),
});

export const Route = createFileRoute("/success")({
  validateSearch: successSearchSchema,
  loaderDeps: ({ search }) => ({ productId: search.productId, saleId: search.saleId }),
  loader: async ({ deps: { productId, saleId } }) => {


    
    if (!productId || !saleId) return { sale: null, product: null };
    
    const { data: saleData } = await supabase
      .from("sales")
      .select("*, products(id, name, image_url, price, access_link, delivery_link, support_phone, support_number, warranty_days, delivery_type)")
      .eq("id", saleId)
      .single();
      
    if (!saleData) return { sale: null, product: null };
    
    return {
      sale: saleData,
      product: saleData.products,
    };
  },
  component: SuccessPage,
});

function SuccessPage() {
  const { productId, saleId } = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    // Immediate redirect to the official payment-success page
    navigate({
      to: "/payment-success",
      search: { productId, saleId },
      replace: true
    });
  }, [productId, saleId, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB]">
      <div className="text-center space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-[#E30613] mx-auto" />
        <p className="text-slate-500 font-bold">Redirecionando para o seu acesso...</p>
      </div>
    </div>
  );
}

import { Loader2 } from "lucide-react";
