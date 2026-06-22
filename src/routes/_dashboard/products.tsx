import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Package,
  Plus,
  Search,
  MoreHorizontal,
  ExternalLink,
  QrCode,
  Edit,
  Trash2,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dashboard/products")({
  component: ProductsPage,
});

function ProductsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [supportNumber, setSupportNumber] = useState("");
  const [facebookPixelId, setFacebookPixelId] = useState("");
  const [facebookAccessToken, setFacebookAccessToken] = useState("");
  const [deliveryType, setDeliveryType] = useState("none");
  const [deliveryLink, setDeliveryLink] = useState("");
  const [accessLink, setAccessLink] = useState("");
  const [thankYouButtonText, setThankYouButtonText] = useState("Liberar acesso");
  const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string>("");
  // Order Bump
  const [bumpEnabled, setBumpEnabled] = useState(false);
  const [bumpTitle, setBumpTitle] = useState("");
  const [bumpDescription, setBumpDescription] = useState("");
  const [bumpPrice, setBumpPrice] = useState("");
  const [bumpButtonText, setBumpButtonText] = useState("Sim, quero adicionar!");
  const [bumpHighlightColor, setBumpHighlightColor] = useState("#16a34a");
  const [bumpImageFile, setBumpImageFile] = useState<File | null>(null);
  const [bumpImageUrl, setBumpImageUrl] = useState<string>("");

  const uploadProductImage = async (userId: string, file: File): Promise<string> => {
    const fileExt = file.name.split(".").pop();
    const filePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
    const { error: upErr } = await supabase.storage
      .from("product-images")
      .upload(filePath, file, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    const { data: signed, error: signErr } = await supabase.storage
      .from("product-images")
      .createSignedUrl(filePath, 60 * 60 * 24 * 365 * 10);
    if (signErr) throw signErr;
    return signed.signedUrl;
  };


  const fetchProducts = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erro ao buscar produtos");
    } else {
      setProducts(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    try {


      let deliveryFileUrl = "";

      if (deliveryFile) {
        const fileExt = deliveryFile.name.split(".").pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${user.id}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("product-deliverables")
          .upload(filePath, deliveryFile);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from("product-deliverables")
          .getPublicUrl(filePath);
        
        deliveryFileUrl = publicUrl;
      }

      let uploadedImageUrl = "";
      if (imageFile) {
        uploadedImageUrl = await uploadProductImage(user.id, imageFile);
      }
      let uploadedBannerUrl = "";
      if (bannerFile) {
        uploadedBannerUrl = await uploadProductImage(user.id, bannerFile);
      }
      let uploadedBumpImageUrl = "";
      if (bumpImageFile) {
        uploadedBumpImageUrl = await uploadProductImage(user.id, bumpImageFile);
      }

      const { data, error } = await supabase
        .from("products")
        .insert({
          name,
          description,
          price: parseFloat(price),
          category,
          user_id: user.id,
          status: "active",
          facebook_pixel_id: facebookPixelId,
          facebook_access_token: facebookAccessToken,
          delivery_type: deliveryType,
          delivery_link: deliveryLink,
          delivery_file_url: deliveryFileUrl,
          access_link: accessLink || deliveryLink,
          thank_you_button_text: thankYouButtonText || "Liberar acesso",
          image_url: uploadedImageUrl || null,
          checkout_banner_url: uploadedBannerUrl || null,
          bump_enabled: bumpEnabled,
          bump_title: bumpEnabled ? bumpTitle : null,
          bump_description: bumpEnabled ? bumpDescription : null,
          bump_price: bumpEnabled && bumpPrice ? parseFloat(bumpPrice) : null,
          bump_button_text: bumpEnabled ? bumpButtonText : null,
          bump_highlight_color: bumpEnabled ? bumpHighlightColor : null,
          bump_image_url: bumpEnabled ? (uploadedBumpImageUrl || null) : null,
        } as any)
        .select()
        .single();

      if (error) throw error;

      // Create default checkout record for the product
      const { error: checkoutError } = await supabase.from("checkouts").insert({
        product_id: data.id,
        title: name,
        subtitle: description ? description.substring(0, 100) : "",
      });

      if (checkoutError) {
        console.error("Erro ao criar configurações de checkout:", checkoutError);
        // We don't throw here to avoid failing product creation if checkout fails
      }

      const checkoutLink = `${window.location.origin}/p/${data.id}`;
      toast.success("Produto criado com sucesso!", {
        description: "O link de checkout já está pronto para uso.",
        action: {
          label: "Copiar Link",
          onClick: () => {
            navigator.clipboard.writeText(checkoutLink);
            toast.success("Link copiado!");
          }
        }
      });
      setIsDialogOpen(false);
      resetForm();
      fetchProducts();

    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setPrice("");
    setCategory("");
    setSupportPhone("");
    setFacebookPixelId("");
    setFacebookAccessToken("");
    setDeliveryType("none");
    setDeliveryLink("");
    setAccessLink("");
    setThankYouButtonText("Liberar acesso");
    setDeliveryFile(null);
    setImageFile(null);
    setImageUrl("");
    setBannerFile(null);
    setBannerUrl("");
    setBumpEnabled(false);
    setBumpTitle("");
    setBumpDescription("");
    setBumpPrice("");
    setBumpButtonText("Sim, quero adicionar!");
    setBumpHighlightColor("#16a34a");
    setBumpImageFile(null);
    setBumpImageUrl("");
  };

  const handleEditProduct = (product: any) => {
    setEditingProduct(product);
    setName(product.name);
    setDescription(product.description || "");
    setPrice(product.price.toString());
    setCategory(product.category || "");
    setSupportPhone(product.support_phone || "");
    setSupportNumber(product.support_number || product.support_phone || "");
    setFacebookPixelId(product.facebook_pixel_id || "");
    setFacebookAccessToken(product.facebook_access_token || "");
    setDeliveryType(product.delivery_type || "none");
    setDeliveryLink(product.delivery_link || "");
    setAccessLink(product.access_link || "");
    setThankYouButtonText(product.thank_you_button_text || "Liberar acesso");
    setImageUrl(product.image_url || "");
    setImageFile(null);
    setBannerUrl(product.checkout_banner_url || "");
    setBannerFile(null);
    setIsEditDialogOpen(true);
  };

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    try {
      let finalImageUrl = imageUrl;
      if (imageFile) {
        finalImageUrl = await uploadProductImage(editingProduct.user_id, imageFile);
      }
      let finalBannerUrl = bannerUrl;
      if (bannerFile) {
        finalBannerUrl = await uploadProductImage(editingProduct.user_id, bannerFile);
      }

      const { error } = await supabase
        .from("products")
        .update({
          name,
          description,
          price: parseFloat(price),
          category,
          facebook_pixel_id: facebookPixelId,
          facebook_access_token: facebookAccessToken,
          delivery_type: deliveryType,
          delivery_link: deliveryLink,
          access_link: accessLink || deliveryLink,
          thank_you_button_text: thankYouButtonText || "Liberar acesso",
          image_url: finalImageUrl || null,
          checkout_banner_url: finalBannerUrl || null,
        })
        .eq("id", editingProduct.id);

      if (error) throw error;

      toast.success("Produto atualizado com sucesso!");
      setIsEditDialogOpen(false);
      setEditingProduct(null);
      resetForm();
      fetchProducts();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este produto?")) return;

    try {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;

      toast.success("Produto excluído com sucesso!");
      fetchProducts();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const copyCheckoutLink = (productId: string) => {
    const url = `${window.location.origin}/p/${productId}`;
    navigator.clipboard.writeText(url);
    toast.success("Link de checkout copiado!");
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Produtos</h1>
          <p className="text-sm md:text-base text-muted-foreground">Gerencie seus produtos digitais e físicos.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2 w-full sm:w-auto">
              <Plus className="h-4 w-4" /> Novo Produto
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] w-[95vw] max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleCreateProduct}>
              <DialogHeader>
                <DialogTitle>Novo Produto</DialogTitle>
                <DialogDescription>
                  Preencha as informações para criar um novo produto.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nome do Produto</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Curso de Marketing" required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="image">Imagem do Produto</Label>
                  <Input id="image" type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
                  {imageFile && (
                    <img src={URL.createObjectURL(imageFile)} alt="Preview" className="mt-2 h-24 w-24 object-cover rounded border" />
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="banner">Banner do Checkout (opcional)</Label>
                  <Input id="banner" type="file" accept="image/*" onChange={(e) => setBannerFile(e.target.files?.[0] || null)} />
                  <p className="text-[10px] text-muted-foreground italic">Aparece no topo do checkout. Use para oferta, garantia, bónus ou aviso.</p>
                  {bannerFile && (
                    <img src={URL.createObjectURL(bannerFile)} alt="Preview banner" className="mt-2 w-full h-auto rounded border" />
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="facebook_pixel_id">Facebook Pixel ID</Label>
                  <Input id="facebook_pixel_id" value={facebookPixelId} onChange={(e) => setFacebookPixelId(e.target.value)} placeholder="Ex: 123456789" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="facebook_access_token">Facebook Access Token</Label>
                  <Input id="facebook_access_token" value={facebookAccessToken} onChange={(e) => setFacebookAccessToken(e.target.value)} placeholder="EAAB..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="price">Preço (MT)</Label>
                    <Input id="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1000" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="category">Categoria</Label>
                    <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Educação" />
                  </div>
                </div>
                <div className="border-t pt-4">
                  <Label className="font-semibold mb-2 block text-[#E30613]">Configurações de Acesso (Obrigatório)</Label>
                  <div className="grid gap-4">
                    <div className="grid gap-2">

                        <Label htmlFor="thank_you_button_text">Texto do Botão (Página de Obrigado)</Label>
                        <Input
                          id="thank_you_button_text"
                          value={thankYouButtonText}
                          onChange={(e) => setThankYouButtonText(e.target.value)}
                          placeholder="Ex: Liberar acesso, Levantar valor, Aceder conteúdo"
                          maxLength={40}
                        />
                        <p className="text-[10px] text-muted-foreground italic">Personalize o texto do botão verde mostrado após o pagamento.</p>
                    </div>
                    
                    <div className="grid gap-2 pt-2 border-t border-dashed">
                        <Label className="text-xs">Entrega Automática (Opcional)</Label>
                        <select 
                          value={deliveryType}
                          onChange={(e) => setDeliveryType(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        >
                            <option value="none">Nenhum adicional</option>
                            <option value="file">Upload de Arquivo</option>
                            <option value="link">Link Secundário</option>
                            <option value="both">Ambos</option>
                        </select>
                    </div>
                    {(deliveryType === 'file' || deliveryType === 'both') && (
                      <div className="grid gap-2">
                          <Label htmlFor="delivery_file">Arquivo Adicional</Label>
                          <Input id="delivery_file" type="file" onChange={(e) => setDeliveryFile(e.target.files?.[0] || null)} />
                      </div>
                    )}
                    {(deliveryType === 'link' || deliveryType === 'both') && (
                      <div className="grid gap-2">
                          <Label htmlFor="delivery_link">Link Adicional</Label>
                          <Input id="delivery_link" value={deliveryLink} onChange={(e) => setDeliveryLink(e.target.value)} placeholder="https://..." />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button type="submit" className="w-full sm:w-auto">Criar Produto</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-[425px] w-[95vw] max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleUpdateProduct}>
              <DialogHeader>
                <DialogTitle>Editar Produto</DialogTitle>
                <DialogDescription>
                  Atualize as informações do seu produto.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-name">Nome do Produto</Label>
                  <Input
                    id="edit-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Curso de Marketing"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-image">Imagem do Produto</Label>
                  <Input id="edit-image" type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} />
                  {(imageFile || imageUrl) && (
                    <img
                      src={imageFile ? URL.createObjectURL(imageFile) : imageUrl}
                      alt="Preview"
                      className="mt-2 h-24 w-24 object-cover rounded border"
                    />
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-banner">Banner do Checkout (opcional)</Label>
                  <Input id="edit-banner" type="file" accept="image/*" onChange={(e) => setBannerFile(e.target.files?.[0] || null)} />
                  <p className="text-[10px] text-muted-foreground italic">Aparece no topo do checkout. Deixe em branco para não exibir.</p>
                  {(bannerFile || bannerUrl) && (
                    <img
                      src={bannerFile ? URL.createObjectURL(bannerFile) : bannerUrl}
                      alt="Preview banner"
                      className="mt-2 w-full h-auto rounded border"
                    />
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-facebook_pixel_id">Facebook Pixel ID</Label>
                  <Input id="edit-facebook_pixel_id" value={facebookPixelId} onChange={(e) => setFacebookPixelId(e.target.value)} placeholder="Ex: 123456789" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-facebook_access_token">Facebook Access Token</Label>
                  <Input id="edit-facebook_access_token" value={facebookAccessToken} onChange={(e) => setFacebookAccessToken(e.target.value)} placeholder="EAAB..." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="edit-price">Preço (MT)</Label>
                    <Input
                      id="edit-price"
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="1000"
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-category">Categoria</Label>
                    <Input
                      id="edit-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="Educação"
                    />
                  </div>
                </div>
                <div className="border-t pt-4">
                  <Label className="font-semibold mb-2 block text-[#E30613]">Configurações de Acesso (Obrigatório)</Label>
                  <div className="grid gap-4">
                    <div className="grid gap-2">

                        <Label htmlFor="edit-thank_you_button_text">Texto do Botão (Página de Obrigado)</Label>
                        <Input
                          id="edit-thank_you_button_text"
                          value={thankYouButtonText}
                          onChange={(e) => setThankYouButtonText(e.target.value)}
                          placeholder="Ex: Liberar acesso, Levantar valor, Aceder conteúdo"
                          maxLength={40}
                        />
                    </div>
                    
                    <div className="grid gap-2 pt-2 border-t border-dashed">
                        <Label className="text-xs">Entrega Automática (Opcional)</Label>
                        <select 
                          value={deliveryType}
                          onChange={(e) => setDeliveryType(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        >
                            <option value="none">Nenhum adicional</option>
                            <option value="file">Upload de Arquivo</option>
                            <option value="link">Link Secundário</option>
                            <option value="both">Ambos</option>
                        </select>
                    </div>
                    {(deliveryType === 'link' || deliveryType === 'both') && (
                      <div className="grid gap-2">
                          <Label htmlFor="edit-delivery_link">Link Adicional</Label>
                          <Input id="edit-delivery_link" value={deliveryLink} onChange={(e) => setDeliveryLink(e.target.value)} placeholder="https://..." />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="submit">Salvar Alterações</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar produtos..." className="pl-9" />
        </div>
      </div>

      <div className="rounded-md border bg-white overflow-x-auto overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[150px]">Nome</TableHead>
              <TableHead className="hidden sm:table-cell">Preço</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Vendas</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Carregando produtos...
                </TableCell>
              </TableRow>
            ) : products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum produto encontrado.
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span className="truncate max-w-[120px] sm:max-w-none">{product.name}</span>
                      <span className="text-xs text-muted-foreground block sm:hidden">
                        {product.price.toLocaleString("pt-MZ")} MT
                      </span>
                      <span className="text-xs text-muted-foreground">{product.category}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{product.price.toLocaleString("pt-MZ")} MT</TableCell>
                  <TableCell>
                    <Badge
                      variant={product.status === "active" ? "secondary" : "outline"}
                      className={cn(
                        "text-[10px] sm:text-xs",
                        product.status === "active"
                          ? "bg-green-100 text-green-700 hover:bg-green-100"
                          : ""
                      )}
                    >
                      {product.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">0</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5 sm:gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="hidden lg:flex items-center gap-2 h-8 px-3 text-xs"
                        onClick={() => copyCheckoutLink(product.id)}
                      >
                        <Copy className="h-3 w-3" /> Link
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden h-8 w-8"
                        onClick={() => copyCheckoutLink(product.id)}
                        title="Copiar Link"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Ações</DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => window.open(`/p/${product.id}`, "_blank")}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" /> Ver Checkout
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEditProduct(product)}>
                            <Edit className="mr-2 h-4 w-4" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <QrCode className="mr-2 h-4 w-4" /> QR Code
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => handleDeleteProduct(product.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
