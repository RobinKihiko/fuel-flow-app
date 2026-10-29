import { useEffect, useState } from "react";
import { format, startOfDay, endOfDay } from "date-fns";
import { DollarSign, Fuel, ShoppingCart, Smartphone, Building2, Clock, Droplet, ChevronRight, AlertTriangle } from "lucide-react";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import StatCard from "@/components/StatCard";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";


interface RecentSale {
  id: string;
  litres: number;
  total_amount: number;
  payment_method: string;
  created_at: string;
  fuel_types: { name: string } | null;
  branch_id: string | null;
}

interface Branch { id: string; name: string; }
interface BranchStats { branch_id: string; name: string; totalSales: number; mpesaIncome: number; salesCount: number; }
interface TankRow { id: string; branch_id: string; fuel_name: string; capacity_litres: number; current_level_litres: number; low_stock_threshold: number; }
interface BranchTankSummary { branch_id: string; name: string; tanks: TankRow[]; totalLevel: number; totalCapacity: number; lowCount: number; }
interface FuelDetail { tank: TankRow; branchName: string; soldLitres: number; soldAmount: number; receivedLitres: number; openingStock: number | null; updatedAt: Date | null; }


export default function Dashboard() {
  const { hasRole } = useAuth();
  const today = new Date();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: today, to: today });
  const [now, setNow] = useState(new Date());
  const [totalSales, setTotalSales] = useState(0);
  const [mpesaIncome, setMpesaIncome] = useState(0);
  const [cashIncome, setCashIncome] = useState(0);
  const [cashCount, setCashCount] = useState(0);
  const [mpesaCount, setMpesaCount] = useState(0);

  const [totalExpenses, setTotalExpenses] = useState(0);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [fuelStock, setFuelStock] = useState<{ name: string; stock_level: number }[]>([]);
  const [branchStats, setBranchStats] = useState<BranchStats[]>([]);
  const [allTanks, setAllTanks] = useState<TankRow[]>([]);
  const [tankBranchOpen, setTankBranchOpen] = useState<BranchTankSummary | null>(null);
  const [fuelDetail, setFuelDetail] = useState<FuelDetail | null>(null);
  const [fuelDetailLoading, setFuelDetailLoading] = useState(false);
  const [hoursBack, setHoursBack] = useState(0);
  const [rewind, setRewind] = useState<Record<string, { sold: number; received: number }>>({});

  const openFuelDetail = async (tank: TankRow, branchName: string, silent = false) => {
    if (!silent) {
      setFuelDetail({ tank, branchName, soldLitres: 0, soldAmount: 0, receivedLitres: 0, openingStock: null, updatedAt: null });
      setFuelDetailLoading(true);
    }
    const fromIso = startOfDay(new Date()).toISOString();
    const toIso = endOfDay(new Date()).toISOString();
    const todayDate = format(new Date(), "yyyy-MM-dd");

    const [{ data: fuelIds }, { data: topups }, { data: freshTank }, { data: dailyRow }] = await Promise.all([
      supabase.from("fuel_types").select("id").eq("name", tank.fuel_name),
      supabase.from("fuel_topups").select("litres").eq("tank_id", tank.id).gte("created_at", fromIso).lte("created_at", toIso),
      supabase.from("tanks").select("id, branch_id, fuel_name, capacity_litres, current_level_litres, low_stock_threshold").eq("id", tank.id).maybeSingle(),
      supabase.from("daily_fuel_stock").select("opening_stock").eq("fuel_name", tank.fuel_name).eq("stock_date", todayDate).eq("branch_id", tank.branch_id).maybeSingle(),
    ]);

    let soldLitres = 0;
    let soldAmount = 0;
    const ids = (fuelIds ?? []).map((f: any) => f.id);
    if (ids.length) {
      let q = supabase
        .from("sales")
        .select("litres, total_amount")
        .in("fuel_type_id", ids)
        .is("reversed_at", null)
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      if (tank.branch_id) q = q.eq("branch_id", tank.branch_id);
      const { data: sold } = await q;
      soldLitres = (sold ?? []).reduce((s: number, r: any) => s + Number(r.litres), 0);
      soldAmount = (sold ?? []).reduce((s: number, r: any) => s + Number(r.total_amount), 0);
    }
    const receivedLitres = (topups ?? []).reduce((s: number, r: any) => s + Number(r.litres), 0);
    const liveTank = (freshTank as TankRow | null) ?? tank;
    const openingStock = dailyRow?.opening_stock != null
      ? Number(dailyRow.opening_stock)
      : Number(liveTank.current_level_litres) + soldLitres - receivedLitres;

    setFuelDetail((prev) =>
      prev && prev.tank.id === tank.id
        ? { ...prev, tank: liveTank, soldLitres, soldAmount, receivedLitres, openingStock, updatedAt: new Date() }
        : prev
    );
    setFuelDetailLoading(false);
  };

  // Auto-refresh the open fuel popup every 15s
  useEffect(() => {
    if (!fuelDetail) return;
    const tank = fuelDetail.tank;
    const branchName = fuelDetail.branchName;
    const i = setInterval(() => { openFuelDetail(tank, branchName, true); }, 15000);
    return () => clearInterval(i);
  }, [fuelDetail?.tank.id]);




  // Real-time clock
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    supabase.from("branches").select("id, name").eq("is_active", true).then(({ data }) => {
      setBranches((data as Branch[]) ?? []);
    });
  }, []);

  // Tanks: load + realtime
  const loadTanks = async () => {
    const { data } = await supabase.from("tanks").select("id, branch_id, fuel_name, capacity_litres, current_level_litres, low_stock_threshold");
    setAllTanks((data as TankRow[]) ?? []);
  };
  useEffect(() => {
    loadTanks();
    const channel = supabase
      .channel("dashboard-tanks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tanks" }, () => loadTanks())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Rewind: reconstruct tank levels as at (now - hoursBack)
  useEffect(() => {
    if (hoursBack === 0 || allTanks.length === 0) { setRewind({}); return; }
    let cancelled = false;
    (async () => {
      const cutoff = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
      const [{ data: fuels }, { data: topups }] = await Promise.all([
        supabase.from("fuel_types").select("id, name"),
        supabase.from("fuel_topups").select("tank_id, litres").gte("created_at", cutoff),
      ]);
      const { data: sales } = await supabase
        .from("sales")
        .select("fuel_type_id, branch_id, litres")
        .is("reversed_at", null)
        .gte("created_at", cutoff);
      if (cancelled) return;
      const nameById: Record<string, string> = {};
      (fuels ?? []).forEach((f: any) => { nameById[f.id] = f.name; });
      const map: Record<string, { sold: number; received: number }> = {};
      allTanks.forEach((t) => { map[t.id] = { sold: 0, received: 0 }; });
      (topups ?? []).forEach((r: any) => {
        if (r.tank_id && map[r.tank_id]) map[r.tank_id].received += Number(r.litres);
      });
      (sales ?? []).forEach((s: any) => {
        const name = nameById[s.fuel_type_id];
        const tank = allTanks.find((t) => t.fuel_name === name && (!s.branch_id || t.branch_id === s.branch_id));
        if (tank) map[tank.id].sold += Number(s.litres);
      });
      setRewind(map);
    })();
    return () => { cancelled = true; };
  }, [hoursBack, allTanks]);


  useEffect(() => {
    const fetchData = async () => {
      const from = dateRange?.from ?? today;
      const to = dateRange?.to ?? from;
      const fromIso = startOfDay(from).toISOString();
      const toIso = endOfDay(to).toISOString();
      const fromDate = format(startOfDay(from), "yyyy-MM-dd");
      const toDate = format(endOfDay(to), "yyyy-MM-dd");

      let salesQuery = supabase.from("sales").select("total_amount, payment_method, branch_id").gte("created_at", fromIso).lte("created_at", toIso).is("reversed_at", null);
      if (selectedBranch !== "all") salesQuery = salesQuery.eq("branch_id", selectedBranch);

      const { data: sales } = await salesQuery;
      const total = sales?.reduce((s, r) => s + Number(r.total_amount), 0) ?? 0;
      const mpesa = sales?.filter((s) => s.payment_method === "mpesa").reduce((s, r) => s + Number(r.total_amount), 0) ?? 0;
      const cash = sales?.filter((s) => s.payment_method !== "mpesa").reduce((s, r) => s + Number(r.total_amount), 0) ?? 0;
      setTotalSales(total);
      setMpesaIncome(mpesa);
      setCashIncome(cash);
      setCashCount(sales?.filter((s) => s.payment_method !== "mpesa").length ?? 0);
      setMpesaCount(sales?.filter((s) => s.payment_method === "mpesa").length ?? 0);


      const { data: expenses } = await supabase.from("expenses").select("amount").gte("date", fromDate).lte("date", toDate);
      setTotalExpenses(expenses?.reduce((s, r) => s + Number(r.amount), 0) ?? 0);

      let recentQuery = supabase.from("sales").select("id, litres, total_amount, payment_method, created_at, branch_id, fuel_types(name)").gte("created_at", fromIso).lte("created_at", toIso).is("reversed_at", null).order("created_at", { ascending: false }).limit(20);
      if (selectedBranch !== "all") recentQuery = recentQuery.eq("branch_id", selectedBranch);
      const { data: recent } = await recentQuery;
      setRecentSales((recent as unknown as RecentSale[]) ?? []);

      if (selectedBranch !== "all") {
        const { data: fuels } = await supabase.from("branch_fuel_types").select("name, stock_level").eq("branch_id", selectedBranch);
        setFuelStock(fuels ?? []);
      } else {
        const { data: fuels } = await supabase.from("fuel_types").select("name, stock_level");
        setFuelStock(fuels ?? []);
      }

      if (hasRole("admin") && branches.length > 0) {
        const { data: allSales } = await supabase.from("sales").select("total_amount, payment_method, branch_id").gte("created_at", fromIso).lte("created_at", toIso).is("reversed_at", null);
        const statsMap: Record<string, BranchStats> = {};
        branches.forEach((b) => {
          statsMap[b.id] = { branch_id: b.id, name: b.name, totalSales: 0, mpesaIncome: 0, salesCount: 0 };
        });
        allSales?.forEach((s) => {
          if (s.branch_id && statsMap[s.branch_id]) {
            statsMap[s.branch_id].totalSales += Number(s.total_amount);
            statsMap[s.branch_id].salesCount += 1;
            if (s.payment_method === "mpesa") statsMap[s.branch_id].mpesaIncome += Number(s.total_amount);
          }
        });
        setBranchStats(Object.values(statsMap));
      }
    };

    fetchData();

    // Re-fetch instantly when sales change (incl. approved reversals)
    const channel = supabase
      .channel("dashboard-sales")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedBranch, branches, dateRange]);

  const profit = totalSales - totalExpenses;
  const rangeLabel = dateRange?.from
    ? dateRange.to && format(dateRange.from, "yyyy-MM-dd") !== format(dateRange.to, "yyyy-MM-dd")
      ? `${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}`
      : format(dateRange.from, "MMM d, yyyy")
    : "All time";

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm flex items-center gap-2 flex-wrap">
            <span>Overview · {rangeLabel}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-accent/10 text-accent text-xs font-mono">
              <Clock className="h-3 w-3" /> {format(now, "EEE, MMM d · HH:mm:ss")}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker value={dateRange} onChange={setDateRange} className="w-[240px]" />
          {branches.length > 0 && (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="w-[180px]">
                <Building2 className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Sales" value={`KES ${totalSales.toLocaleString()}`} icon={<ShoppingCart className="h-5 w-5" />} />
        <StatCard title="M-Pesa" value={`KES ${mpesaIncome.toLocaleString()}`} icon={<Smartphone className="h-5 w-5" />} />
        <StatCard title="Expenses" value={`KES ${totalExpenses.toLocaleString()}`} icon={<DollarSign className="h-5 w-5" />} />
        {hasRole("admin") && (
          <StatCard title="Profit" value={`KES ${profit.toLocaleString()}`} subtitle={profit >= 0 ? "Positive" : "Negative"} icon={<Fuel className="h-5 w-5" />} />
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payment Breakdown — {rangeLabel}</CardTitle>
          <p className="text-xs text-muted-foreground">Reversed sales are excluded</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">Cash</p>
              <p className="text-lg font-bold font-mono">KES {cashIncome.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{cashCount} sales · {totalSales > 0 ? Math.round((cashIncome / totalSales) * 100) : 0}%</p>
            </div>
            <div className="p-3 rounded-lg border border-border">
              <p className="text-xs text-muted-foreground">M-Pesa</p>
              <p className="text-lg font-bold font-mono">KES {mpesaIncome.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{mpesaCount} sales · {totalSales > 0 ? Math.round((mpesaIncome / totalSales) * 100) : 0}%</p>
            </div>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="bg-primary" style={{ width: `${totalSales > 0 ? (cashIncome / totalSales) * 100 : 0}%` }} />
            <div className="bg-accent" style={{ width: `${totalSales > 0 ? (mpesaIncome / totalSales) * 100 : 0}%` }} />
          </div>
        </CardContent>
      </Card>



      {hasRole("admin") && branchStats.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Branch Comparison — {rangeLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {branchStats.map((bs) => (
                <div key={bs.branch_id} className="p-3 rounded-lg border border-border space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">{bs.name}</p>
                  <p className="text-lg font-bold font-mono">KES {bs.totalSales.toLocaleString()}</p>
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    <span>{bs.salesCount} sales</span>
                    <span>·</span>
                    <span>M-Pesa: KES {bs.mpesaIncome.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="order-2 md:order-1">
          <CardHeader>
            <CardTitle className="text-base">Sales · {rangeLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentSales.length === 0 && <p className="text-sm text-muted-foreground">No sales in this range</p>}
            {recentSales.map((sale) => (
              <div key={sale.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{sale.fuel_types?.name}</p>
                  <p className="text-xs text-muted-foreground">{sale.litres}L · {sale.payment_method.toUpperCase()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-mono font-semibold">KES {Number(sale.total_amount).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{format(new Date(sale.created_at), "MMM d, HH:mm")}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="order-1 md:order-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Droplet className="h-4 w-4 text-accent" /> Tank Levels by Fuel Product</CardTitle>
              {hoursBack === 0 ? (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-success/10 text-success font-medium">Live</span>
              ) : (
                <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">Past view</span>
              )}
            </div>
            <div className="pt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {hoursBack === 0 ? "Showing levels right now" : `Showing levels as at ${format(new Date(Date.now() - hoursBack * 3600 * 1000), "MMM d, HH:mm")}`}
                </span>
                {hoursBack > 0 && (
                  <button onClick={() => setHoursBack(0)} className="text-accent hover:underline">Back to live</button>
                )}
              </div>
              <Slider
                value={[72 - hoursBack]}
                min={0}
                max={72}
                step={1}
                onValueChange={(v) => setHoursBack(72 - v[0])}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>3 days ago</span>
                <span>Now</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const branchList = branches.length ? branches : [{ id: "unassigned", name: "Unassigned" }];
              const visible = branchList.filter((b) => selectedBranch === "all" || b.id === selectedBranch);
              const groups = visible
                .map((b) => ({
                  branch: b,
                  tanks: allTanks.filter((t) => (b.id === "unassigned" ? !t.branch_id : t.branch_id === b.id)),
                }))
                .filter((g) => g.tanks.length > 0);

              if (groups.length === 0) return <p className="text-sm text-muted-foreground">No tanks configured yet.</p>;

              return groups.map((g) => (
                <div key={g.branch.id} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.branch.name}</p>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {g.tanks.map((t) => {
                      const adj = rewind[t.id];
                      const level = adj
                        ? Math.max(0, Number(t.current_level_litres) + adj.sold - adj.received)
                        : Number(t.current_level_litres);
                      const cap = Number(t.capacity_litres);
                      const pct = cap > 0 ? Math.min(100, (level / cap) * 100) : 0;
                      const low = t.low_stock_threshold > 0 && level <= Number(t.low_stock_threshold);
                      return (
                        <button
                          key={t.id}
                          onClick={() => openFuelDetail(t, g.branch.name)}
                          className="w-full text-left p-3 hover:bg-accent/5 transition-colors space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm flex items-center gap-2">
                              {t.fuel_name}
                              {low && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" /> low
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{level.toLocaleString()} / {cap.toLocaleString()} L</span>
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${low ? "bg-destructive" : pct < 50 ? "bg-amber-500" : "bg-accent"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!fuelDetail} onOpenChange={(o) => !o && setFuelDetail(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Droplet className="h-5 w-5 text-accent" /> {fuelDetail?.tank.fuel_name} — {fuelDetail?.branchName}
            </DialogTitle>
          </DialogHeader>
          {fuelDetail && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg border border-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-muted-foreground">Current tank level</span>
                  <span className="font-mono text-sm font-semibold">
                    {Number(fuelDetail.tank.current_level_litres).toLocaleString()} / {Number(fuelDetail.tank.capacity_litres).toLocaleString()} L
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${fuelDetail.tank.capacity_litres > 0 ? Math.min(100, (Number(fuelDetail.tank.current_level_litres) / Number(fuelDetail.tank.capacity_litres)) * 100) : 0}%` }}
                  />
                </div>
              </div>

              {fuelDetailLoading ? (
                <p className="text-sm text-muted-foreground text-center py-6">Loading today's activity…</p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  <div className="p-3 rounded-lg border border-border flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Opening stock (today)</span>
                    <span className="font-mono font-semibold">
                      {fuelDetail.openingStock != null ? `${fuelDetail.openingStock.toLocaleString(undefined, { maximumFractionDigits: 2 })} L` : "—"}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg border border-border flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Litres sold (today)</span>
                    <span className="font-mono font-semibold">{fuelDetail.soldLitres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</span>
                  </div>
                  <div className="p-3 rounded-lg border border-border flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Amount sold (today)</span>
                    <span className="font-mono font-semibold text-accent">KES {fuelDetail.soldAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="p-3 rounded-lg border border-border flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Litres received (today)</span>
                    <span className="font-mono font-semibold text-success">+{fuelDetail.receivedLitres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Auto-refreshes every 15s · Last updated {fuelDetail.updatedAt ? format(fuelDetail.updatedAt, "HH:mm:ss") : "—"}
                </p>
                <button
                  onClick={() => openFuelDetail(fuelDetail.tank, fuelDetail.branchName, true)}
                  className="text-[11px] text-accent hover:underline"
                >
                  Refresh now
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


