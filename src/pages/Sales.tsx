import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format, startOfDay, endOfDay } from "date-fns";
import { Building2, Sparkles, Undo2, CloudOff } from "lucide-react";
import { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/DateRangePicker";
import BranchBadge from "@/components/BranchBadge";
import SaleReceipt, { ReceiptData } from "@/components/SaleReceipt";
import { useUserBranches } from "@/hooks/useUserBranch";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { enqueueSale } from "@/lib/offlineQueue";

interface Branch { id: string; name: string; }
interface FuelType { id: string; name: string; price_per_litre: number; stock_level: number; vat_rate?: number; }
interface Pump { id: string; code: string; label: string | null; status: string; }

export default function Sales() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState(searchParams.get("branch") || "");
  const [fuelTypes, setFuelTypes] = useState<FuelType[]>([]);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [selectedPump, setSelectedPump] = useState("");
  const [selectedFuel, setSelectedFuel] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sales, setSales] = useState<any[]>([]);
  const [useLegacyFuel, setUseLegacyFuel] = useState(false);
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: today, to: today });
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Recent sales search & filters
  const [saleSearch, setSaleSearch] = useState("");
  const [saleFuelFilter, setSaleFuelFilter] = useState("all");
  const [salePaymentFilter, setSalePaymentFilter] = useState("all");
  const [saleStatusFilter, setSaleStatusFilter] = useState("all");

  // Sale reversal request (any user; requires admin approval)
  const [reverseSale, setReverseSale] = useState<any | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseSubmitting, setReverseSubmitting] = useState(false);
  const [pendingReversals, setPendingReversals] = useState<Record<string, string>>({});

  // Admin-only: backdate a sale by overriding created_at.
  // Format: yyyy-MM-ddTHH:mm (datetime-local). Empty = use server "now".
  const [saleDateOverride, setSaleDateOverride] = useState("");

  // Custom sale (admin only)
  const [customOpen, setCustomOpen] = useState(false);
  const [customFuel, setCustomFuel] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customLitres, setCustomLitres] = useState("");
  const [customPayment, setCustomPayment] = useState("cash");
  const [customPhone, setCustomPhone] = useState("");
  const [customDateOverride, setCustomDateOverride] = useState("");
  const [customSubmitting, setCustomSubmitting] = useState(false);

  const isAdmin = hasRole("admin");
  const isAttendant = hasRole("attendant") && !hasRole("admin") && !hasRole("manager");
  const myBranches = useUserBranches();
  const attendantHasNoBranch = isAttendant && myBranches.length === 0;
  const { online, counts: syncCounts } = useOfflineSync();

  const saleFuelOptions = Array.from(new Set(sales.map((s: any) => s.fuel_types?.name).filter(Boolean))) as string[];
  const filteredSales = sales.filter((s: any) => {
    const fuelName = s.fuel_types?.name ?? "";
    if (saleFuelFilter !== "all" && fuelName !== saleFuelFilter) return false;
    if (salePaymentFilter !== "all" && s.payment_method !== salePaymentFilter) return false;
    const status = s.reversed_at ? "reversed" : pendingReversals[s.id] === "pending" ? "pending" : pendingReversals[s.id] === "rejected" ? "rejected" : "reversible";
    if (saleStatusFilter !== "all" && status !== saleStatusFilter) return false;
    const q = saleSearch.trim().toLowerCase();
    if (!q) return true;
    return [fuelName, s.payment_method, String(s.litres), String(s.total_amount), format(new Date(s.created_at), "MMM d, HH:mm")]
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const [salePage, setSalePage] = useState(1);
  const [salePageSize, setSalePageSize] = useState(25);
  const totalSalePages = Math.max(1, Math.ceil(filteredSales.length / salePageSize));
  const currentSalePage = Math.min(salePage, totalSalePages);
  const pagedSales = filteredSales.slice((currentSalePage - 1) * salePageSize, currentSalePage * salePageSize);
  useEffect(() => { setSalePage(1); }, [saleSearch, saleFuelFilter, salePaymentFilter, saleStatusFilter, salePageSize]);





  useEffect(() => {
    const loadBranches = async () => {
      const { data } = await supabase.from("branches").select("id, name").eq("is_active", true);
      const branchList = (data as Branch[]) ?? [];
      setBranches(branchList);
      if (branchList.length === 1) setSelectedBranchId(branchList[0].id);
    };
    loadBranches();
  }, []);

  useEffect(() => {
    const loadPumps = async () => {
      setSelectedPump("");
      if (!selectedBranchId) { setPumps([]); return; }
      const { data } = await supabase.from("pumps").select("id, code, label, status").eq("branch_id", selectedBranchId).order("code");
      setPumps((data as Pump[]) ?? []);
    };
    loadPumps();
  }, [selectedBranchId]);


  useEffect(() => {
    let cancelled = false;
    const loadFuels = async (resetSelection: boolean) => {
      if (resetSelection) setSelectedFuel("");
      if (selectedBranchId) {
        const { data } = await supabase.from("branch_fuel_types").select("*").eq("branch_id", selectedBranchId);
        const branchFuels = (data as FuelType[]) ?? [];
        if (branchFuels.length > 0) {
          // Live tank levels: sum current_level_litres of all tanks linked to each fuel product
          const { data: links } = await supabase
            .from("branch_fuel_type_tanks")
            .select("branch_fuel_type_id, tanks(current_level_litres)")
            .in("branch_fuel_type_id", branchFuels.map((f) => f.id));
          const liveLevels: Record<string, number> = {};
          ((links as any[]) ?? []).forEach((l) => {
            if (!l.tanks) return;
            liveLevels[l.branch_fuel_type_id] = (liveLevels[l.branch_fuel_type_id] ?? 0) + Number(l.tanks.current_level_litres);
          });
          if (cancelled) return;
          setFuelTypes(branchFuels.map((f) => (
            f.id in liveLevels ? { ...f, stock_level: liveLevels[f.id] } : f
          )));
          setUseLegacyFuel(false);
        } else {
          const { data: legacy } = await supabase.from("fuel_types").select("*");
          if (cancelled) return;
          setFuelTypes(legacy ?? []);
          setUseLegacyFuel(true);
        }
      } else if (branches.length === 0) {
        const { data } = await supabase.from("fuel_types").select("*");
        if (cancelled) return;
        setFuelTypes(data ?? []);
        setUseLegacyFuel(true);
      }
    };
    loadFuels(true);
    // Keep fuel levels live while the sales screen is open
    const iv = setInterval(() => loadFuels(false), 15000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [selectedBranchId, branches]);

  const loadSales = async () => {
    let query = supabase.from("sales").select("*, fuel_types(name, price_per_litre, vat_rate), branches(name)").order("created_at", { ascending: false }).limit(100);
    if (selectedBranchId) query = query.eq("branch_id", selectedBranchId);
    if (dateRange?.from) {
      query = query.gte("created_at", startOfDay(dateRange.from).toISOString());
      query = query.lte("created_at", endOfDay(dateRange.to ?? dateRange.from).toISOString());
    }
    const { data } = await query;
    const list = data ?? [];
    setSales(list);
    if (list.length) {
      const { data: revs } = await supabase
        .from("sale_reversals")
        .select("sale_id, status")
        .in("sale_id", list.map((s: any) => s.id));
      setPendingReversals(Object.fromEntries(((revs as any[]) ?? []).map((r) => [r.sale_id, r.status])));
    } else {
      setPendingReversals({});
    }
  };

  const submitReversal = async () => {
    if (!reverseSale || !user) return;
    if (!reverseReason.trim()) { toast({ title: "Enter a reason", variant: "destructive" }); return; }
    setReverseSubmitting(true);
    try {
      const { error } = await supabase.from("sale_reversals").insert({
        sale_id: reverseSale.id,
        branch_id: reverseSale.branch_id,
        reason: reverseReason.trim(),
        requested_by: user.id,
      });
      if (error) throw error;
      toast({ title: "Reversal requested", description: "An admin must approve it before the sale is reversed." });
      setReverseSale(null);
      setReverseReason("");
      await loadSales();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setReverseSubmitting(false);
    }
  };

  const reprintSale = (s: any) => {
    setReceipt({
      receiptNo: s.id.slice(0, 8).toUpperCase(),
      date: new Date(s.created_at),
      branchName: s.branches?.name,
      fuelName: s.fuel_types?.name ?? "",
      pricePerLitre: Number(s.fuel_types?.price_per_litre ?? (Number(s.total_amount) / Number(s.litres || 1))),
      litres: Number(s.litres),
      vatRate: Number(s.fuel_types?.vat_rate ?? 16),
      totalAmount: Number(s.total_amount),
      paymentMethod: s.payment_method,
    });
    setReceiptOpen(true);
  };

  useEffect(() => {
    loadSales();
  }, [selectedBranchId, dateRange]);

  const selectedFuelData = fuelTypes.find((f) => f.id === selectedFuel);
  const totalAmount = Number(amount || 0);
  const litresCalc = selectedFuelData && totalAmount > 0 ? totalAmount / selectedFuelData.price_per_litre : 0;

  // Concurrency-safe stock deduction. Uses atomic RPC to prevent race conditions
  // and guarantee tanks never go negative when multiple sales fire simultaneously.
  // `idempotencyKey` (typically the sale id) makes retries safe — the RPC will
  // skip the deduction if the same key has already been processed.
  const deductStock = async (fuel: FuelType, litres: number, idempotencyKey?: string) => {
    if (useLegacyFuel) {
      // Legacy path — keep simple update (no linked tanks)
      const newStock = Math.max(0, Number(fuel.stock_level) - litres);
      await supabase.from("fuel_types").update({ stock_level: newStock }).eq("id", fuel.id);
      return;
    }
    const { error } = await supabase.rpc("deduct_fuel_sale", {
      _branch_fuel_type_id: fuel.id,
      _litres: litres,
      _idempotency_key: idempotencyKey,
    });
    if (error) throw error;
  };

  // Resolve a branch_fuel_type to a legacy fuel_types.id (sales.fuel_type_id references legacy table).
  const resolveLegacyFuelId = async (fuel: FuelType): Promise<string> => {
    if (useLegacyFuel) return fuel.id;
    const { data: legacyMatch } = await supabase
      .from("fuel_types").select("id").eq("name", fuel.name).maybeSingle();
    if (legacyMatch?.id) return legacyMatch.id as string;
    const { data: created, error } = await supabase
      .from("fuel_types")
      .insert({ name: fuel.name, price_per_litre: fuel.price_per_litre, stock_level: 0, vat_rate: fuel.vat_rate ?? 16 } as any)
      .select("id").single();
    if (error) throw error;
    return created.id as string;
  };

  const refreshFuels = async () => {
    if (useLegacyFuel) {
      const { data } = await supabase.from("fuel_types").select("*");
      setFuelTypes(data ?? []);
    } else if (selectedBranchId) {
      const { data } = await supabase.from("branch_fuel_types").select("*").eq("branch_id", selectedBranchId);
      const branchFuels = (data as FuelType[]) ?? [];
      if (branchFuels.length === 0) { setFuelTypes([]); return; }
      // Live tank levels: sum current_level_litres of linked tanks per fuel product
      const { data: links } = await supabase
        .from("branch_fuel_type_tanks")
        .select("branch_fuel_type_id, tanks(current_level_litres)")
        .in("branch_fuel_type_id", branchFuels.map((f) => f.id));
      const liveLevels: Record<string, number> = {};
      ((links as any[]) ?? []).forEach((l) => {
        if (!l.tanks) return;
        liveLevels[l.branch_fuel_type_id] = (liveLevels[l.branch_fuel_type_id] ?? 0) + Number(l.tanks.current_level_litres);
      });
      setFuelTypes(branchFuels.map((f) => (f.id in liveLevels ? { ...f, stock_level: liveLevels[f.id] } : f)));
    }
  };

  // Fetch resulting tank levels for a branch_fuel_type (after deduction).
  const fetchDeductionSnapshot = async (fuel: FuelType, litres: number) => {
    if (useLegacyFuel) {
      return { fuelName: fuel.name, litresDeducted: litres, tanks: [] as { label: string; remaining: number; capacity?: number }[] };
    }
    const { data } = await supabase
      .from("branch_fuel_type_tanks")
      .select("tanks(id, fuel_name, capacity_litres, current_level_litres, notes)")
      .eq("branch_fuel_type_id", fuel.id);
    const tanks = ((data as any[]) ?? [])
      .map((r) => r.tanks)
      .filter(Boolean)
      .map((t: any) => ({
        label: (t.notes && String(t.notes).trim()) || t.fuel_name || `Tank ${String(t.id).slice(0, 6)}`,
        remaining: Number(t.current_level_litres ?? 0),
        capacity: t.capacity_litres != null ? Number(t.capacity_litres) : undefined,
      }));
    return { fuelName: fuel.name, litresDeducted: litres, tanks };
  };

  // Parse an admin-supplied datetime-local value into an ISO string, or undefined.
  const parseDateOverride = (v: string): string | undefined => {
    if (!v) return undefined;
    const d = new Date(v);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  };


  const handleCustomSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) { toast({ title: "Admin only", variant: "destructive" }); return; }
    const fuel = fuelTypes.find((f) => f.id === customFuel);
    const price = Number(customPrice);
    const litres = Number(customLitres);
    if (!fuel || !user || !(price > 0) || !(litres > 0)) {
      toast({ title: "Enter fuel, price and litres", variant: "destructive" }); return;
    }
    if (litres > Number(fuel.stock_level)) {
      toast({ title: "Insufficient stock", description: `Only ${Number(fuel.stock_level).toFixed(2)}L available.`, variant: "destructive" }); return;
    }
    if (!online) {
      queueOfflineSale(fuel, litres, Number((price * litres).toFixed(2)), customPayment, null);
      setCustomOpen(false);
      setCustomFuel(""); setCustomPrice(""); setCustomLitres(""); setCustomPhone(""); setCustomDateOverride("");
      return;
    }
    setCustomSubmitting(true);
    try {
      const legacyFuelId = await resolveLegacyFuelId(fuel);
      const total = Number((price * litres).toFixed(2));
      const insertPayload: any = {
        fuel_type_id: legacyFuelId,
        litres: Number(litres.toFixed(2)),
        total_amount: total,
        payment_method: customPayment,
        attendant_id: user.id,
        branch_id: selectedBranchId || null,
      };
      const backdate = isAdmin ? parseDateOverride(customDateOverride) : undefined;
      if (backdate) insertPayload.created_at = backdate;
      const { data: sale, error } = await supabase.from("sales").insert(insertPayload).select().single();
      if (error) throw error;
      await deductStock(fuel, litres, sale.id);
      const deduction = await fetchDeductionSnapshot(fuel, litres);

      toast({ title: "Custom sale recorded", description: `${litres.toFixed(2)}L @ KES ${price}/L = KES ${total.toLocaleString()}` });
      setReceipt({
        receiptNo: sale.id.slice(0, 8).toUpperCase(),
        date: new Date(sale.created_at ?? Date.now()),
        branchName: branches.find((b) => b.id === selectedBranchId)?.name,
        fuelName: fuel.name,
        pricePerLitre: price,
        litres,
        vatRate: Number(fuel.vat_rate ?? 16),
        totalAmount: total,
        paymentMethod: customPayment,
        phone: undefined,
        deduction,
      });
      setReceiptOpen(true);
      setCustomOpen(false);
      setCustomFuel(""); setCustomPrice(""); setCustomLitres(""); setCustomPhone(""); setCustomDateOverride("");
      await loadSales();
      await refreshFuels();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setCustomSubmitting(false);
    }
  };

  // Save a sale locally while offline: queued for sync + instant printable receipt.
  const queueOfflineSale = (
    fuel: FuelType,
    litres: number,
    total: number,
    payment: string,
    pumpId: string | null,
  ) => {
    if (!user) return;
    const localId = (crypto as any)?.randomUUID ? crypto.randomUUID() : `off-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const capturedAt = new Date().toISOString();
    const branchName = branches.find((b) => b.id === selectedBranchId)?.name;
    enqueueSale({
      id: localId,
      capturedAt,
      branchId: selectedBranchId || null,
      branchName,
      pumpId,
      fuel: {
        id: fuel.id,
        name: fuel.name,
        pricePerLitre: Number(fuel.price_per_litre),
        vatRate: Number(fuel.vat_rate ?? 16),
        legacy: useLegacyFuel,
      },
      litres: Number(litres.toFixed(2)),
      totalAmount: Number(total.toFixed(2)),
      paymentMethod: payment,
      attendantId: user.id,
    });
    toast({
      title: "Saved offline",
      description: "This sale is queued and will upload automatically once you are back online.",
    });
    setReceipt({
      receiptNo: localId.slice(0, 8).toUpperCase(),
      date: new Date(capturedAt),
      branchName,
      fuelName: fuel.name,
      pricePerLitre: Number(fuel.price_per_litre),
      litres: Number(litres.toFixed(2)),
      vatRate: Number(fuel.vat_rate ?? 16),
      totalAmount: Number(total.toFixed(2)),
      paymentMethod: payment,
      offlinePending: true,
    });
    setReceiptOpen(true);
    setAmount(""); setPhone(""); setSelectedPump(""); setSaleDateOverride("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFuel || !amount || !user) return;
    if (attendantHasNoBranch) {
      toast({ title: "No branch assigned", description: "Ask an admin to assign you to a branch before recording sales.", variant: "destructive" });
      return;
    }
    if (pumps.length > 0 && !selectedPump) {
      toast({ title: "Select a pump first", variant: "destructive" });
      return;
    }
    if (selectedFuelData && Number(selectedFuelData.stock_level) <= 0) {
      toast({ title: "Out of stock", description: `${selectedFuelData.name} is depleted. Top up before selling.`, variant: "destructive" });
      return;
    }
    if (selectedFuelData && litresCalc > Number(selectedFuelData.stock_level)) {
      toast({ title: "Insufficient stock", description: `Only ${Number(selectedFuelData.stock_level).toFixed(2)}L available.`, variant: "destructive" });
      return;
    }
    // Offline: save the sale on this laptop, print the receipt now, upload later.
    if (!online && selectedFuelData) {
      queueOfflineSale(selectedFuelData, litresCalc, totalAmount, paymentMethod, selectedPump || null);
      return;
    }

    setIsSubmitting(true);

    try {
      const insertData: any = {
        fuel_type_id: selectedFuel,
        litres: Number(litresCalc.toFixed(2)),
        total_amount: totalAmount,
        payment_method: paymentMethod,
        attendant_id: user.id,
        branch_id: selectedBranchId || null,
        pump_id: selectedPump || null,
      };
      const backdate = isAdmin ? parseDateOverride(saleDateOverride) : undefined;
      if (backdate) insertData.created_at = backdate;

      if (!useLegacyFuel && selectedFuelData) {
        const fname = selectedFuelData.name;
        const { data: legacyMatch } = await supabase
          .from("fuel_types")
          .select("id")
          .eq("name", fname)
          .maybeSingle();
        if (legacyMatch?.id) {
          insertData.fuel_type_id = legacyMatch.id;
        } else {
          const { data: created, error: createErr } = await supabase
            .from("fuel_types")
            .insert({
              name: fname,
              price_per_litre: selectedFuelData.price_per_litre,
              stock_level: 0,
              vat_rate: selectedFuelData.vat_rate ?? 16,
            } as any)
            .select("id")
            .single();
          if (createErr) throw createErr;
          insertData.fuel_type_id = created.id;
        }
      }

      const { data: sale, error } = await supabase.from("sales").insert(insertData).select().single();
      if (error) throw error;

      // Deduct stock atomically via RPC. Pass the sale id as an idempotency
      // key so a retried submit can never double-deduct tanks.
      let deduction = undefined as any;
      if (selectedFuelData) {
        await deductStock(selectedFuelData, litresCalc, sale.id);
        deduction = await fetchDeductionSnapshot(selectedFuelData, litresCalc);
      }

      toast({ title: "Sale recorded!", description: `${litresCalc.toFixed(2)}L of ${selectedFuelData?.name} — KES ${totalAmount.toLocaleString()}` });

      const branchName = branches.find((b) => b.id === selectedBranchId)?.name;
      setReceipt({
        receiptNo: sale.id.slice(0, 8).toUpperCase(),
        date: new Date(sale.created_at ?? Date.now()),
        branchName,
        fuelName: selectedFuelData?.name ?? "",
        pricePerLitre: Number(selectedFuelData?.price_per_litre ?? 0),
        litres: litresCalc,
        vatRate: Number(selectedFuelData?.vat_rate ?? 16),
        totalAmount,
        paymentMethod,
        phone: undefined,
        deduction,
      });
      setReceiptOpen(true);

      setAmount(""); setPhone(""); setSelectedPump(""); setSaleDateOverride("");

      await loadSales();

      await refreshFuels();
    } catch (error: any) {
      const msg = String(error?.message ?? "");
      // The connection dropped mid-save: fall back to the offline queue.
      if (selectedFuelData && /failed to fetch|load failed|network|offline/i.test(msg)) {
        queueOfflineSale(selectedFuelData, litresCalc, totalAmount, paymentMethod, selectedPump || null);
      } else {
        toast({ title: "Error", description: error.message, variant: "destructive" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">Record Sale</h1>
          <BranchBadge />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {branches.length > 0 && !isAttendant && (
            <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
              <SelectTrigger className="w-[200px]">
                <Building2 className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isAdmin && (
            <Dialog open={customOpen} onOpenChange={setCustomOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="border-accent text-accent hover:bg-accent/10">
                  <Sparkles className="h-4 w-4 mr-2" /> Custom Sale
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Custom Sale (Admin)</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCustomSale} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Fuel Product</Label>
                    <Select value={customFuel} onValueChange={setCustomFuel}>
                      <SelectTrigger><SelectValue placeholder="Select fuel" /></SelectTrigger>
                      <SelectContent>
                        {fuelTypes.map((f) => (
                          <SelectItem key={f.id} value={f.id} disabled={Number(f.stock_level) <= 0}>
                            {f.name} · {Number(f.stock_level).toFixed(0)}L live in tanks (KES {f.price_per_litre}/L)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Custom Price / L</Label>
                      <Input type="number" step="0.01" min="0.01" value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)} required placeholder="e.g. 180.00" />
                    </div>
                    <div className="space-y-2">
                      <Label>Litres</Label>
                      <Input type="number" step="0.01" min="0.01" value={customLitres}
                        onChange={(e) => setCustomLitres(e.target.value)} required placeholder="e.g. 20" />
                    </div>
                  </div>
                  {Number(customPrice) > 0 && Number(customLitres) > 0 && (
                    <div className="p-2 rounded bg-muted text-xs flex justify-between">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-mono font-bold">KES {(Number(customPrice) * Number(customLitres)).toLocaleString()}</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <Select value={customPayment} onValueChange={setCustomPayment}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="mpesa">M-Pesa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      Sale Date <span className="text-[10px] text-accent font-normal">(admin backdate)</span>
                    </Label>
                    <Input
                      type="datetime-local"
                      value={customDateOverride}
                      onChange={(e) => setCustomDateOverride(e.target.value)}
                      max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                    />
                    <p className="text-[11px] text-muted-foreground">Leave empty to use current time.</p>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setCustomOpen(false)} disabled={customSubmitting}>Cancel</Button>
                    <Button type="submit" className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={customSubmitting}>
                      {customSubmitting ? "Recording..." : "Record Custom Sale"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {!online && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm flex items-start gap-2">
          <CloudOff className="h-4 w-4 mt-0.5 text-warning shrink-0" />
          <div>
            <p className="font-medium text-warning">You are offline — sales are saved on this laptop</p>
            <p className="text-xs text-muted-foreground">
              Receipts still print and download. Everything uploads automatically when the connection returns
              {syncCounts.pending > 0 ? ` (${syncCounts.pending} waiting).` : "."}
            </p>
          </div>
        </div>
      )}

      {attendantHasNoBranch && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive p-3 text-sm">
          You are not assigned to any branch. Sales are disabled until an admin assigns you.
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">New Sale</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Pump *</Label>
                <Select value={selectedPump} onValueChange={setSelectedPump} disabled={!selectedBranchId || pumps.length === 0}>
                  <SelectTrigger><SelectValue placeholder={pumps.length === 0 ? "No pumps configured" : "Select pump"} /></SelectTrigger>
                  <SelectContent>
                    {pumps.map((p) => (
                      <SelectItem key={p.id} value={p.id} disabled={p.status === "offline" || p.status === "error"}>
                        {p.code}{p.label ? ` — ${p.label}` : ""}{p.status !== "active" && p.status !== "idle" ? ` (${p.status})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Fuel Type</Label>
                <Select value={selectedFuel} onValueChange={setSelectedFuel}>
                  <SelectTrigger className="justify-between">
                    <SelectValue placeholder="Select fuel" />
                    {selectedFuelData && (
                      <span className={`ml-2 text-xs font-mono px-1.5 py-0.5 rounded shrink-0 ${Number(selectedFuelData.stock_level) <= 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
                        {Number(selectedFuelData.stock_level).toFixed(0)}L live
                      </span>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {fuelTypes.map((f) => {
                      const depleted = Number(f.stock_level) <= 0;
                      return (
                        <SelectItem key={f.id} value={f.id} disabled={depleted}>
                          {f.name} — KES {f.price_per_litre}/L {depleted ? "(OUT)" : `· ${Number(f.stock_level).toFixed(0)}L live in tanks`}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>


              <div className="space-y-2">
                <Label>Amount (KES)</Label>
                <Input type="number" step="0.01" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="Enter amount in KES" />
              </div>

              {litresCalc > 0 && selectedFuelData && (
                <div className="p-2 rounded bg-muted text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Litres</span><span className="font-mono font-semibold">{litresCalc.toFixed(2)} L</span></div>
                  {(() => {
                    const vr = Number(selectedFuelData.vat_rate ?? 16);
                    const sub = totalAmount / (1 + vr / 100);
                    const vat = totalAmount - sub;
                    return (<>
                      <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">KES {sub.toFixed(2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">VAT ({vr}%)</span><span className="font-mono">KES {vat.toFixed(2)}</span></div>
                      <div className="flex justify-between border-t pt-1"><span className="font-medium">Total</span><span className="font-mono font-bold">KES {totalAmount.toFixed(2)}</span></div>
                    </>);
                  })()}
                </div>
              )}

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="mpesa">M-Pesa</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    Sale Date <span className="text-[10px] text-accent font-normal">(admin only — backdate)</span>
                  </Label>
                  <Input
                    type="datetime-local"
                    value={saleDateOverride}
                    onChange={(e) => setSaleDateOverride(e.target.value)}
                    max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                  />
                  <p className="text-[11px] text-muted-foreground">Leave empty to record with the current time.</p>
                </div>
              )}




              <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={isSubmitting || attendantHasNoBranch || !selectedFuel || !amount || (branches.length > 0 && !selectedBranchId) || (pumps.length > 0 && !selectedPump) || (selectedFuelData && Number(selectedFuelData.stock_level) <= 0)}>
                {isSubmitting ? "Processing..." : "Record Sale"}
              </Button>

            </form>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Recent Sales</CardTitle>
              <DateRangePicker value={dateRange} onChange={setDateRange} className="w-[240px]" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Search fuel, amount, litres, payment…"
                value={saleSearch}
                onChange={(e) => setSaleSearch(e.target.value)}
                className="w-full sm:w-[240px]"
              />
              <Select value={saleFuelFilter} onValueChange={setSaleFuelFilter}>
                <SelectTrigger className="w-full sm:w-[170px]"><SelectValue placeholder="Fuel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All fuels</SelectItem>
                  {saleFuelOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={salePaymentFilter} onValueChange={setSalePaymentFilter}>
                <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Payment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All payments</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                </SelectContent>
              </Select>
              <Select value={saleStatusFilter} onValueChange={setSaleStatusFilter}>
                <SelectTrigger className="w-full sm:w-[190px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="reversible">Reversible only</SelectItem>
                  <SelectItem value="pending">Awaiting approval</SelectItem>
                  <SelectItem value="reversed">Reversed</SelectItem>
                </SelectContent>
              </Select>
              {(saleSearch || saleFuelFilter !== "all" || salePaymentFilter !== "all" || saleStatusFilter !== "all") && (
                <Button variant="ghost" size="sm" onClick={() => { setSaleSearch(""); setSaleFuelFilter("all"); setSalePaymentFilter("all"); setSaleStatusFilter("all"); }}>
                  Clear
                </Button>
              )}
              <span className="text-xs text-muted-foreground self-center">{filteredSales.length} of {sales.length}</span>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Fuel</th>
                    <th className="py-2 pr-4">Litres</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Payment</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSales.map((s: any) => {
                    const revStatus = pendingReversals[s.id];
                    const reversed = !!s.reversed_at;
                    return (
                    <tr key={s.id} onClick={() => reprintSale(s)} className={`border-b border-border last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${reversed ? "opacity-60" : ""}`} title="Click to reprint receipt">
                      <td className="py-2.5 pr-4 text-muted-foreground">{format(new Date(s.created_at), "MMM d, HH:mm")}</td>
                      <td className="py-2.5 pr-4 font-medium">{s.fuel_types?.name}</td>
                      <td className="py-2.5 pr-4 font-mono">{s.litres}</td>
                      <td className={`py-2.5 pr-4 font-mono font-semibold ${reversed ? "line-through" : ""}`}>KES {Number(s.total_amount).toLocaleString()}</td>
                      <td className="py-2.5 pr-4">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.payment_method === "mpesa" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                          {s.payment_method.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                        {reversed ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive">REVERSED</span>
                        ) : revStatus === "pending" ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-warning/10 text-warning">AWAITING APPROVAL</span>
                        ) : revStatus === "rejected" ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">REJECTED</span>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10"
                            onClick={() => { setReverseSale(s); setReverseReason(""); }}>
                            <Undo2 className="h-3.5 w-3.5 mr-1" /> Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredSales.length === 0 && <p className="text-center text-muted-foreground py-8">{sales.length === 0 ? "No sales in this range" : "No sales match your search or filters"}</p>}
            </div>
            {filteredSales.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Rows per page</span>
                  <Select value={String(salePageSize)} onValueChange={(v) => setSalePageSize(Number(v))}>
                    <SelectTrigger className="h-8 w-[80px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {(currentSalePage - 1) * salePageSize + 1}–{Math.min(currentSalePage * salePageSize, filteredSales.length)} of {filteredSales.length}
                  </span>
                  <Button size="sm" variant="outline" disabled={currentSalePage <= 1} onClick={() => setSalePage(currentSalePage - 1)}>Prev</Button>
                  <span className="text-xs font-mono">{currentSalePage}/{totalSalePages}</span>
                  <Button size="sm" variant="outline" disabled={currentSalePage >= totalSalePages} onClick={() => setSalePage(currentSalePage + 1)}>Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <SaleReceipt open={receiptOpen} onOpenChange={setReceiptOpen} data={receipt} />

      {reverseSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !reverseSubmitting && setReverseSale(null)}>
          <div className="bg-card border rounded-lg p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold">Request sale reversal</h3>
              <p className="text-xs text-muted-foreground">
                {reverseSale.fuel_types?.name} · {Number(reverseSale.litres).toFixed(2)} L · KES {Number(reverseSale.total_amount).toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                An admin must approve this. Once approved, the litres are returned to the product and its tanks.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="reverse-reason">Reason</Label>
              <Input id="reverse-reason" value={reverseReason} autoFocus
                placeholder="e.g. wrong litres entered"
                onChange={(e) => setReverseReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReverseSale(null)} disabled={reverseSubmitting}>Cancel</Button>
              <Button variant="destructive" onClick={submitReversal} disabled={reverseSubmitting}>
                {reverseSubmitting ? "Submitting..." : "Submit request"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
