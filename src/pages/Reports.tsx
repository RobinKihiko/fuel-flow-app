import { Fragment, useEffect, useMemo, useState } from "react";
import { format, startOfDay, endOfDay, subDays, eachDayOfInterval } from "date-fns";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DateRangePicker } from "@/components/DateRangePicker";
import { FileDown, FileSpreadsheet, Receipt, Users, ChevronRight, ArrowLeft, Fuel, TrendingUp, ChevronDown, Download, CalendarDays, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  exportSalesPDF, exportSalesExcel, exportVatPDF, exportVatExcel,
  type SalesRow, type VatRow,
} from "@/lib/exporters";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import SaleReversalsPanel from "@/components/SaleReversalsPanel";

interface AttendantPerf {
  attendant_id: string;
  name: string;
  salesCount: number;
  totalAmount: number;
  cashAmount: number;
  mpesaAmount: number;
  totalLitres: number;
  pumps: { id: string; code: string; label: string | null }[];
}
interface AttendantSale {
  id: string;
  created_at: string;
  litres: number;
  total_amount: number;
  payment_method: string;
  fuel: string;
  pump: string;
  branch: string;
}

interface ProfitRow {
  id: string;
  name: string;
  branch: string;
  currentStock: number;
  topupLitres: number;
  sellingPrice: number;
  buyingPrice: number | null;
  projectedProfit: number;
}

interface DailyFuelRow {
  date: string;          // yyyy-MM-dd
  opening: number;
  topups: number;
  salesLitres: number;
  salesRevenue: number;
  closing: number;
  corrected?: boolean;   // true if admin has recorded an override in daily_fuel_stock
  locked?: boolean;      // true if admin has finalized the day
}
interface FuelDailySeries {
  id: string;
  name: string;
  branch: string;
  branchId: string;
  fuelName: string;
  sellingPrice: number;
  days: DailyFuelRow[];
}

export default function Reports() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const today = new Date();
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: subDays(today, 6), to: today });
  const [dailySales, setDailySales] = useState<{ date: string; total: number }[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState({ cash: 0, mpesa: 0 });
  const [salesRows, setSalesRows] = useState<SalesRow[]>([]);
  const [vatRows, setVatRows] = useState<VatRow[]>([]);
  const [profitRows, setProfitRows] = useState<ProfitRow[]>([]);
  const [expandedProfit, setExpandedProfit] = useState<string | null>(null);
  const [expensesTotal, setExpensesTotal] = useState(0);

  const [fuelDailySeries, setFuelDailySeries] = useState<FuelDailySeries[]>([]);
  const [fuelFilter, setFuelFilter] = useState<string>("all");
  const [expandedDailyFuel, setExpandedDailyFuel] = useState<string | null>(null);

  // Admin-only stock correction dialog
  const [correction, setCorrection] = useState<{ series: FuelDailySeries; day: DailyFuelRow } | null>(null);
  const [correctionForm, setCorrectionForm] = useState({ opening: "", closing: "", topups: "", salesLitres: "", salesRevenue: "" });
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [attendants, setAttendants] = useState<AttendantPerf[]>([]);
  const [selectedAttendant, setSelectedAttendant] = useState<AttendantPerf | null>(null);
  const [attendantSales, setAttendantSales] = useState<AttendantSale[]>([]);

  useEffect(() => {
    const fetchReports = async () => {
      const from = dateRange?.from ?? subDays(today, 6);
      const to = dateRange?.to ?? from;
      const fromIso = startOfDay(from).toISOString();
      const toIso = endOfDay(to).toISOString();

      const { data: sales } = await supabase
        .from("sales")
        .select("id, total_amount, payment_method, litres, attendant_id, pump_id, created_at, fuel_types(name, price_per_litre, vat_rate), branches(name), pumps(id, code, label)")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .is("reversed_at", null)
        .order("created_at", { ascending: false });

      if (!sales) { setDailySales([]); setSalesRows([]); setVatRows([]); setAttendants([]); return; }

      const dailyMap: Record<string, number> = {};
      let cashTotal = 0, mpesaTotal = 0;
      const vatMap: Record<string, VatRow> = {};
      const rows: SalesRow[] = [];
      const attMap: Record<string, AttendantPerf & { _pumpIds: Set<string>; _pumps: Map<string, any> }> = {};

      sales.forEach((s: any) => {
        const day = s.created_at.split("T")[0];
        const total = Number(s.total_amount);
        dailyMap[day] = (dailyMap[day] || 0) + total;
        if (s.payment_method === "cash") cashTotal += total; else mpesaTotal += total;

        const fuel = s.fuel_types?.name ?? "Unknown";
        const rate = Number(s.fuel_types?.vat_rate ?? 16);
        const sub = total / (1 + rate / 100);
        const vat = total - sub;

        rows.push({
          date: format(new Date(s.created_at), "yyyy-MM-dd HH:mm"),
          branch: s.branches?.name ?? "—",
          fuel,
          litres: Number(s.litres),
          pricePerLitre: Number(s.fuel_types?.price_per_litre ?? 0),
          vatRate: rate, subtotal: sub, vat, total,
          payment: s.payment_method,
        });

        const key = `${fuel}-${rate}`;
        if (!vatMap[key]) vatMap[key] = { fuel, rate, salesCount: 0, subtotal: 0, vat: 0, total: 0 };
        vatMap[key].salesCount++;
        vatMap[key].subtotal += sub;
        vatMap[key].vat += vat;
        vatMap[key].total += total;

        const aid = s.attendant_id ?? "unknown";
        if (!attMap[aid]) {
          attMap[aid] = {
            attendant_id: aid, name: "", salesCount: 0, totalAmount: 0,
            cashAmount: 0, mpesaAmount: 0, totalLitres: 0,
            pumps: [], _pumpIds: new Set(), _pumps: new Map(),
          };
        }
        attMap[aid].salesCount++;
        attMap[aid].totalAmount += total;
        if (s.payment_method === "mpesa") attMap[aid].mpesaAmount += total;
        else attMap[aid].cashAmount += total;
        attMap[aid].totalLitres += Number(s.litres);
        if (s.pumps && !attMap[aid]._pumpIds.has(s.pumps.id)) {
          attMap[aid]._pumpIds.add(s.pumps.id);
          attMap[aid]._pumps.set(s.pumps.id, { id: s.pumps.id, code: s.pumps.code, label: s.pumps.label });
        }
      });

      // Resolve attendant names
      const attIds = Object.keys(attMap).filter((id) => id !== "unknown");
      if (attIds.length) {
        const { data: names } = await supabase.rpc("get_profile_names", { _ids: attIds });
        const nameMap = Object.fromEntries((names ?? []).map((n: any) => [n.user_id, n.full_name]));
        attIds.forEach((id) => { attMap[id].name = nameMap[id] || "Unknown user"; });
      }

      const attList: AttendantPerf[] = Object.values(attMap)
        .map((a) => ({ ...a, pumps: Array.from(a._pumps.values()) }))
        .sort((a, b) => b.totalAmount - a.totalAmount);

      setDailySales(Object.entries(dailyMap).sort().map(([date, total]) => ({ date: date.slice(5), total })));
      setPaymentBreakdown({ cash: cashTotal, mpesa: mpesaTotal });
      setSalesRows(rows);
      setVatRows(Object.values(vatMap));
      setAttendants(attList);
    };
    fetchReports();
  }, [dateRange]);

  // Projected profit per fuel product
  useEffect(() => {
    const fetchProfit = async () => {
      const from = dateRange?.from ?? subDays(today, 6);
      const to = dateRange?.to ?? from;
      const fromIso = startOfDay(from).toISOString();
      const toIso = endOfDay(to).toISOString();

      const { data: bft } = await supabase
        .from("branch_fuel_types")
        .select("id, name, price_per_litre, stock_level, branch_id, branches(name)");
      if (!bft) { setProfitRows([]); return; }

      const { data: topups } = await supabase
        .from("fuel_topups")
        .select("branch_fuel_type_id, litres")
        .gte("created_at", fromIso)
        .lte("created_at", toIso);
      const topupMap: Record<string, number> = {};
      (topups ?? []).forEach((t: any) => {
        topupMap[t.branch_fuel_type_id] = (topupMap[t.branch_fuel_type_id] || 0) + Number(t.litres);
      });

      // Buying price from fuel_topups via tank (matched by branch + fuel name)
      const { data: deliveries } = await supabase
        .from("fuel_topups")
        .select("litres, cost_per_litre, tanks(branch_id, fuel_name)");
      const buyMap: Record<string, { litres: number; cost: number }> = {};
      (deliveries ?? []).forEach((d: any) => {
        if (!d.tanks || d.cost_per_litre == null) return;
        const key = `${d.tanks.branch_id}__${d.tanks.fuel_name}`;
        if (!buyMap[key]) buyMap[key] = { litres: 0, cost: 0 };
        buyMap[key].litres += Number(d.litres);
        buyMap[key].cost += Number(d.litres) * Number(d.cost_per_litre);
      });

      const rows: ProfitRow[] = (bft as any[]).map((b) => {
        const key = `${b.branch_id}__${b.name}`;
        const bm = buyMap[key];
        const buyingPrice = bm && bm.litres > 0 ? bm.cost / bm.litres : null;
        const sellingPrice = Number(b.price_per_litre);
        const currentStock = Number(b.stock_level);
        const topupLitres = topupMap[b.id] || 0;
        const qty = currentStock + topupLitres;
        const projectedProfit = buyingPrice != null ? (sellingPrice - buyingPrice) * qty : 0;
        return {
          id: b.id, name: b.name, branch: b.branches?.name ?? "—",
          currentStock, topupLitres, sellingPrice, buyingPrice, projectedProfit,
        };
      }).sort((a, b) => b.projectedProfit - a.projectedProfit);
      setProfitRows(rows);

      const { data: exps } = await supabase
        .from("expenses")
        .select("amount")
        .gte("date", format(from, "yyyy-MM-dd"))
        .lte("date", format(to, "yyyy-MM-dd"));
      setExpensesTotal((exps ?? []).reduce((a: number, e: any) => a + Number(e.amount), 0));
    };
    fetchProfit();
  }, [dateRange]);

  // Daily opening/closing stock + sales + top-ups per fuel product
  useEffect(() => {
    const fetchDaily = async () => {
      const from = dateRange?.from ?? subDays(today, 6);
      const to = dateRange?.to ?? from;
      const anchor = endOfDay(new Date()); // current_stock corresponds to "now"

      const { data: bft } = await supabase
        .from("branch_fuel_types")
        .select("id, name, price_per_litre, stock_level, branch_id, branches(name)");
      if (!bft || bft.length === 0) { setFuelDailySeries([]); return; }

      // Live tank-level anchor: sum current_level_litres of tanks linked to each fuel product.
      // Falls back to branch_fuel_types.stock_level if no tanks are linked.
      const bftIds = (bft as any[]).map((b) => b.id);
      const { data: links } = await supabase
        .from("branch_fuel_type_tanks")
        .select("branch_fuel_type_id, tanks(current_level_litres)")
        .in("branch_fuel_type_id", bftIds);
      const liveByBft: Record<string, number> = {};
      (links ?? []).forEach((l: any) => {
        if (!l.tanks) return;
        liveByBft[l.branch_fuel_type_id] =
          (liveByBft[l.branch_fuel_type_id] || 0) + Number(l.tanks.current_level_litres || 0);
      });

      // Sales joined to fuel name; we'll match by (branch_id, fuel_name) → branch_fuel_type
      const { data: salesAll } = await supabase
        .from("sales")
        .select("created_at, litres, total_amount, branch_id, fuel_types(name)")
        .gte("created_at", startOfDay(from).toISOString())
        .lte("created_at", anchor.toISOString())
        .is("reversed_at", null);


      const { data: topupsAll } = await supabase
        .from("fuel_topups")
        .select("created_at, litres, branch_fuel_type_id")
        .gte("created_at", startOfDay(from).toISOString())
        .lte("created_at", anchor.toISOString());

      const days = eachDayOfInterval({ start: from, end: to }).map((d) => format(d, "yyyy-MM-dd"));
      const anchorKey = format(anchor, "yyyy-MM-dd");
      const allDays = Array.from(new Set([...days, anchorKey])).sort(); // ensure anchor included

      const series: FuelDailySeries[] = (bft as any[]).map((b) => {
        // Aggregate sales (litres + revenue) per day for this fuel
        const salesByDay: Record<string, { l: number; r: number }> = {};
        (salesAll ?? []).forEach((s: any) => {
          if (s.branch_id !== b.branch_id) return;
          if ((s.fuel_types?.name ?? "") !== b.name) return;
          const d = s.created_at.slice(0, 10);
          (salesByDay[d] ||= { l: 0, r: 0 });
          salesByDay[d].l += Number(s.litres);
          salesByDay[d].r += Number(s.total_amount);
        });
        const topupsByDay: Record<string, number> = {};
        (topupsAll ?? []).forEach((t: any) => {
          if (t.branch_fuel_type_id !== b.id) return;
          const d = t.created_at.slice(0, 10);
          topupsByDay[d] = (topupsByDay[d] || 0) + Number(t.litres);
        });

        // Walk back from anchor day. closing(anchor) = live tank total (or stock_level fallback)
        // closing(D-1) = closing(D) - topups(D) + sales(D)
        const closingByDay: Record<string, number> = {};
        let runningClose = liveByBft[b.id] ?? Number(b.stock_level);
        const sortedDesc = [...allDays].sort().reverse();
        for (const d of sortedDesc) {
          if (d === anchorKey || d > anchorKey) {
            closingByDay[d] = runningClose;
          } else {
            // shift one day back from previous (which is d+1)
            const next = sortedDesc[sortedDesc.indexOf(d) - 1];
            const nextClose = closingByDay[next] ?? runningClose;
            const nextDay = next;
            const t = topupsByDay[nextDay] || 0;
            const sl = (salesByDay[nextDay]?.l) || 0;
            runningClose = nextClose - t + sl;
            closingByDay[d] = runningClose;
          }
        }

        const dayRows: DailyFuelRow[] = days.map((d) => {
          const closing = closingByDay[d] ?? 0;
          const topups = topupsByDay[d] || 0;
          const sl = salesByDay[d]?.l || 0;
          const sr = salesByDay[d]?.r || 0;
          const opening = closing - topups + sl; // opening + topups - sales = closing
          return { date: d, opening, topups, salesLitres: sl, salesRevenue: sr, closing };
        });

        return {
          id: b.id,
          name: b.name,
          branch: b.branches?.name ?? "—",
          branchId: b.branch_id,
          fuelName: b.name,
          sellingPrice: Number(b.price_per_litre),
          days: dayRows,
        };
      }).sort((a, b) => a.name.localeCompare(b.name));

      // Merge in admin-recorded corrections from daily_fuel_stock (source-of-truth override)
      const { data: overrides } = await supabase
        .from("daily_fuel_stock")
        .select("branch_fuel_type_id, stock_date, opening_stock, closing_stock, topups_litres, sold_litres, revenue, locked")
        .gte("stock_date", format(from, "yyyy-MM-dd"))
        .lte("stock_date", format(to, "yyyy-MM-dd"));
      const ovMap: Record<string, any> = {};
      (overrides ?? []).forEach((o: any) => {
        ovMap[`${o.branch_fuel_type_id}__${o.stock_date}`] = o;
      });
      const withOverrides = series.map((f) => ({
        ...f,
        days: f.days.map((d) => {
          const ov = ovMap[`${f.id}__${d.date}`];
          if (!ov) return d;
          return {
            ...d,
            opening: ov.opening_stock != null ? Number(ov.opening_stock) : d.opening,
            closing: ov.closing_stock != null ? Number(ov.closing_stock) : d.closing,
            topups: ov.topups_litres != null ? Number(ov.topups_litres) : d.topups,
            salesLitres: ov.sold_litres != null ? Number(ov.sold_litres) : d.salesLitres,
            salesRevenue: ov.revenue != null ? Number(ov.revenue) : d.salesRevenue,
            corrected: true,
            locked: !!ov.locked,
          };
        }),
      }));

      setFuelDailySeries(withOverrides);
    };
    fetchDaily();
  }, [dateRange, refreshTick]);


  const openCorrection = (series: FuelDailySeries, day: DailyFuelRow) => {
    setCorrection({ series, day });
    setCorrectionForm({
      opening: day.opening.toFixed(2),
      closing: day.closing.toFixed(2),
      topups: day.topups.toFixed(2),
      salesLitres: day.salesLitres.toFixed(2),
      salesRevenue: day.salesRevenue.toFixed(2),
    });
  };

  const saveCorrection = async () => {
    if (!correction) return;
    setSavingCorrection(true);
    try {
      const { series, day } = correction;
      const payload = {
        branch_id: series.branchId,
        branch_fuel_type_id: series.id,
        fuel_name: series.fuelName,
        stock_date: day.date,
        opening_stock: Number(correctionForm.opening),
        closing_stock: Number(correctionForm.closing),
        topups_litres: Number(correctionForm.topups),
        sold_litres: Number(correctionForm.salesLitres),
        revenue: Number(correctionForm.salesRevenue),
      };
      const { error } = await supabase
        .from("daily_fuel_stock")
        .upsert(payload as any, { onConflict: "branch_fuel_type_id,stock_date" });
      if (error) throw error;
      setCorrection(null);
      setRefreshTick((n) => n + 1);
    } catch (e: any) {
      alert(e.message || "Failed to save correction");
    } finally {
      setSavingCorrection(false);
    }
  };

  // Each day is finalized and locked automatically at midnight (Africa/Nairobi)
  // by a scheduled database job — no manual action required.




  useEffect(() => {
    if (!selectedAttendant) return;
    const from = dateRange?.from ?? subDays(today, 6);
    const to = dateRange?.to ?? from;
    if (selectedAttendant.attendant_id === "unknown") { setAttendantSales([]); return; }
    setAttendantSales([]);
    supabase
      .from("sales")
      .select("id, created_at, litres, total_amount, payment_method, fuel_types(name), branches(name), pumps(code, label)")
      .eq("attendant_id", selectedAttendant.attendant_id)
      .is("reversed_at", null)
      .gte("created_at", startOfDay(from).toISOString())
      .lte("created_at", endOfDay(to).toISOString())
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setAttendantSales(((data as any[]) ?? []).map((s) => ({
          id: s.id,
          created_at: s.created_at,
          litres: Number(s.litres),
          total_amount: Number(s.total_amount),
          payment_method: s.payment_method,
          fuel: s.fuel_types?.name ?? "—",
          pump: s.pumps ? `${s.pumps.code}${s.pumps.label ? ` (${s.pumps.label})` : ""}` : "—",
          branch: s.branches?.name ?? "—",
        })));
      });
  }, [selectedAttendant, dateRange]);

  const rangeLabel = dateRange?.from
    ? dateRange.to && format(dateRange.from, "yyyy-MM-dd") !== format(dateRange.to, "yyyy-MM-dd")
      ? `${format(dateRange.from, "MMM d, yyyy")} – ${format(dateRange.to, "MMM d, yyyy")}`
      : format(dateRange.from, "MMM d, yyyy")
    : "";

  const totalVat = vatRows.reduce((a, r) => a + r.vat, 0);
  const totalSubtotal = vatRows.reduce((a, r) => a + r.subtotal, 0);

  // If drill-down: show attendant detail view
  if (selectedAttendant) {
    // Per-fuel breakdown for this attendant
    const fuelMap: Record<string, { fuel: string; litres: number; revenue: number; salesCount: number }> = {};
    attendantSales.forEach((s) => {
      if (!fuelMap[s.fuel]) fuelMap[s.fuel] = { fuel: s.fuel, litres: 0, revenue: 0, salesCount: 0 };
      fuelMap[s.fuel].litres += s.litres;
      fuelMap[s.fuel].revenue += s.total_amount;
      fuelMap[s.fuel].salesCount += 1;
    });
    const fuelBreakdown = Object.values(fuelMap).sort((a, b) => b.revenue - a.revenue);

    const exportAttendantPdf = () => {
      const doc = new jsPDF();
      doc.setFontSize(14).text(`Attendant Report — ${selectedAttendant.name}`, 14, 14);
      doc.setFontSize(10).text(rangeLabel, 14, 21);
      doc.setFontSize(10).text(`Sales: ${selectedAttendant.salesCount}  ·  Revenue: KES ${selectedAttendant.totalAmount.toLocaleString()}  ·  Litres: ${selectedAttendant.totalLitres.toFixed(2)}`, 14, 28);
      autoTable(doc, {
        startY: 34,
        head: [["Fuel", "Sales", "Litres", "Revenue (KES)"]],
        body: fuelBreakdown.map((f) => [f.fuel, f.salesCount, f.litres.toFixed(2), f.revenue.toFixed(2)]),
        foot: [["Totals", fuelBreakdown.reduce((a, f) => a + f.salesCount, 0),
          fuelBreakdown.reduce((a, f) => a + f.litres, 0).toFixed(2),
          fuelBreakdown.reduce((a, f) => a + f.revenue, 0).toFixed(2)]],
        headStyles: { fillColor: [30, 41, 59] },
        footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
      });
      autoTable(doc, {
        head: [["Time", "Branch", "Pump", "Fuel", "Litres", "Amount", "Payment"]],
        body: attendantSales.map((s) => [
          format(new Date(s.created_at), "MMM d HH:mm"), s.branch, s.pump, s.fuel,
          s.litres.toFixed(2), s.total_amount.toFixed(2), s.payment_method.toUpperCase(),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
      });
      doc.save(`attendant-${selectedAttendant.name.replace(/\s+/g, "_")}-${format(new Date(), "yyyyMMdd-HHmm")}.pdf`);
    };

    const exportAttendantExcel = async () => {
      const wb = new ExcelJS.Workbook();
      const summary = wb.addWorksheet("Summary");
      summary.addRow(["Attendant", selectedAttendant.name]);
      summary.addRow(["Period", rangeLabel]);
      summary.addRow(["Sales", selectedAttendant.salesCount]);
      summary.addRow(["Revenue (KES)", selectedAttendant.totalAmount]);
      summary.addRow(["Litres dispensed", selectedAttendant.totalLitres]);

      const byFuel = wb.addWorksheet("By Fuel");
      byFuel.columns = [
        { header: "Fuel", key: "fuel" },
        { header: "Sales", key: "salesCount" },
        { header: "Litres", key: "litres" },
        { header: "Revenue (KES)", key: "revenue" },
      ];
      fuelBreakdown.forEach((f) => byFuel.addRow(f));

      const detail = wb.addWorksheet("Sales");
      detail.columns = [
        { header: "Time", key: "time" }, { header: "Branch", key: "branch" },
        { header: "Pump", key: "pump" }, { header: "Fuel", key: "fuel" },
        { header: "Litres", key: "litres" }, { header: "Amount (KES)", key: "amount" },
        { header: "Payment", key: "payment" },
      ];
      attendantSales.forEach((s) => detail.addRow({
        time: format(new Date(s.created_at), "yyyy-MM-dd HH:mm"),
        branch: s.branch, pump: s.pump, fuel: s.fuel,
        litres: s.litres, amount: s.total_amount, payment: s.payment_method.toUpperCase(),
      }));

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `attendant-${selectedAttendant.name.replace(/\s+/g, "_")}-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    };

    return (
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setSelectedAttendant(null)} className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Reports
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportAttendantPdf} disabled={attendantSales.length === 0}>
              <FileDown className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={exportAttendantExcel} disabled={attendantSales.length === 0}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold">{selectedAttendant.name}</h1>
          <p className="text-sm text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Sales</p><p className="text-2xl font-bold font-mono">{selectedAttendant.salesCount}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Revenue</p><p className="text-2xl font-bold font-mono text-accent">KES {selectedAttendant.totalAmount.toLocaleString()}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-xs text-muted-foreground">Litres dispensed</p><p className="text-2xl font-bold font-mono">{selectedAttendant.totalLitres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Fuel className="h-4 w-4" /> Breakdown by Fuel Product</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Fuel</th>
                  <th className="py-2 pr-4 text-right">Sales</th>
                  <th className="py-2 pr-4 text-right">Litres sold</th>
                  <th className="py-2 text-right">Revenue</th>
                </tr></thead>
                <tbody>
                  {fuelBreakdown.map((f) => (
                    <tr key={f.fuel} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 font-medium">{f.fuel}</td>
                      <td className="py-2.5 pr-4 text-right font-mono">{f.salesCount}</td>
                      <td className="py-2.5 pr-4 text-right font-mono">{f.litres.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="py-2.5 text-right font-mono font-semibold text-accent">KES {f.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {fuelBreakdown.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No sales</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Fuel className="h-4 w-4" /> Assigned Pumps Used</CardTitle></CardHeader>
          <CardContent>
            {selectedAttendant.pumps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pump assigned on these sales.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selectedAttendant.pumps.map((p) => (
                  <span key={p.id} className="px-3 py-1 rounded-md border bg-muted/30 text-sm font-mono">
                    {p.code}{p.label ? ` · ${p.label}` : ""}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">All Sales</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-2">Time</th><th className="py-2 pr-2">Branch</th><th className="py-2 pr-2">Pump</th>
                  <th className="py-2 pr-2">Fuel</th><th className="py-2 pr-2 text-right">Litres</th>
                  <th className="py-2 pr-2 text-right">Amount</th><th className="py-2">Payment</th>
                </tr></thead>
                <tbody>
                  {attendantSales.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-2 text-muted-foreground">{format(new Date(s.created_at), "MMM d, HH:mm")}</td>
                      <td className="py-2 pr-2">{s.branch}</td>
                      <td className="py-2 pr-2 font-mono">{s.pump}</td>
                      <td className="py-2 pr-2">{s.fuel}</td>
                      <td className="py-2 pr-2 text-right font-mono">{s.litres.toFixed(2)}</td>
                      <td className="py-2 pr-2 text-right font-mono font-semibold">KES {s.total_amount.toLocaleString()}</td>
                      <td className="py-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${s.payment_method === "mpesa" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{s.payment_method.toUpperCase()}</span></td>
                    </tr>
                  ))}
                  {attendantSales.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">No sales</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const grossProfit = profitRows.reduce((a, r) => a + (r.buyingPrice != null ? r.projectedProfit : 0), 0);
  const netProfit = grossProfit - expensesTotal;

  // Compute filtered daily fuel data (for exports + display)
  const filteredFuelSeries = fuelFilter === "all"
    ? fuelDailySeries
    : fuelDailySeries.filter((f) => f.id === fuelFilter);

  // Discrepancy validation (admin-only): flag impossible stock movements
  const discrepancies = fuelDailySeries.flatMap((f) => {
    const issues: { fuel: string; branch: string; date: string; type: string; detail: string }[] = [];
    f.days.forEach((d, i) => {
      const computedClose = d.opening + d.topups - d.salesLitres;
      if (Math.abs(computedClose - d.closing) > 0.01) {
        issues.push({ fuel: f.name, branch: f.branch, date: d.date,
          type: "Stock imbalance",
          detail: `Opening ${d.opening.toFixed(2)} + Top-ups ${d.topups.toFixed(2)} − Sold ${d.salesLitres.toFixed(2)} ≠ Closing ${d.closing.toFixed(2)}` });
      }
      if (d.opening < -0.01 || d.closing < -0.01) {
        issues.push({ fuel: f.name, branch: f.branch, date: d.date,
          type: "Negative stock",
          detail: `Opening ${d.opening.toFixed(2)}L · Closing ${d.closing.toFixed(2)}L — sales exceed available fuel` });
      }
      if (d.salesLitres > d.opening + d.topups + 0.01) {
        issues.push({ fuel: f.name, branch: f.branch, date: d.date,
          type: "Oversold",
          detail: `Sold ${d.salesLitres.toFixed(2)}L but only ${(d.opening + d.topups).toFixed(2)}L was available` });
      }
      if (i > 0) {
        const prev = f.days[i - 1];
        if (Math.abs(prev.closing - d.opening) > 0.01) {
          issues.push({ fuel: f.name, branch: f.branch, date: d.date,
            type: "Opening drift",
            detail: `Opening ${d.opening.toFixed(2)}L doesn't match previous closing ${prev.closing.toFixed(2)}L` });
        }
      }
    });
    return issues;
  });

  const exportDailyFuelPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14).text("Daily Fuel Stock & Sales", 14, 14);
    doc.setFontSize(10).text(rangeLabel, 14, 21);
    let y = 26;
    filteredFuelSeries.forEach((f) => {
      doc.setFontSize(11).text(`${f.name} — ${f.branch}`, 14, y); y += 4;
      autoTable(doc, {
        startY: y,
        head: [["Date", "Opening (L)", "Top-ups (L)", "Sold (L)", "Revenue (KES)", "Closing (L)"]],
        body: f.days.map((d) => [
          format(new Date(d.date), "yyyy-MM-dd"),
          d.opening.toFixed(2), d.topups.toFixed(2), d.salesLitres.toFixed(2),
          d.salesRevenue.toFixed(2), d.closing.toFixed(2),
        ]),
        foot: [[
          "Totals", "",
          f.days.reduce((a, d) => a + d.topups, 0).toFixed(2),
          f.days.reduce((a, d) => a + d.salesLitres, 0).toFixed(2),
          f.days.reduce((a, d) => a + d.salesRevenue, 0).toFixed(2),
          "",
        ]],
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59] },
        footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
      if (y > 180) { doc.addPage(); y = 20; }
    });
    doc.save(`daily-fuel-stock-${format(new Date(), "yyyyMMdd-HHmm")}.pdf`);
  };

  const exportDailyFuelExcel = async () => {
    const wb = new ExcelJS.Workbook();
    filteredFuelSeries.forEach((f) => {
      const sheetName = `${f.name} - ${f.branch}`.slice(0, 31).replace(/[\\\/\?\*\[\]:]/g, "_");
      const ws = wb.addWorksheet(sheetName);
      ws.columns = [
        { header: "Date", key: "date", width: 14 },
        { header: "Opening (L)", key: "opening", width: 14 },
        { header: "Top-ups (L)", key: "topups", width: 14 },
        { header: "Sold (L)", key: "sold", width: 14 },
        { header: "Revenue (KES)", key: "revenue", width: 16 },
        { header: "Closing (L)", key: "closing", width: 14 },
      ];
      f.days.forEach((d) => ws.addRow({
        date: d.date, opening: d.opening, topups: d.topups,
        sold: d.salesLitres, revenue: d.salesRevenue, closing: d.closing,
      }));
      ws.addRow({
        date: "Totals",
        topups: f.days.reduce((a, d) => a + d.topups, 0),
        sold: f.days.reduce((a, d) => a + d.salesLitres, 0),
        revenue: f.days.reduce((a, d) => a + d.salesRevenue, 0),
      });
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `daily-fuel-stock-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };


  return (
    <div className="p-4 md:p-8 space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-muted-foreground">{rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            Days finalize automatically at midnight
          </span>
          <DateRangePicker value={dateRange} onChange={setDateRange} className="w-[240px]" />
        </div>
      </div>

      {/* Attendant Performance — surfaced at top of the report */}
      <Card className="border-l-4 border-l-fuel-petrol bg-fuel-petrol/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Attendant Performance</CardTitle>
          <p className="text-xs text-muted-foreground">Click any attendant to view all their sales and assigned pumps. Revenue is split by payment method.</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4">Attendant</th>
                  <th className="py-2 pr-4 text-right">Sales</th>
                  <th className="py-2 pr-4 text-right">Litres</th>
                  <th className="py-2 pr-4 text-right">Cash</th>
                  <th className="py-2 pr-4 text-right">M-Pesa</th>
                  <th className="py-2 pr-4 text-right">Total Revenue</th>
                  <th className="py-2 pr-4">Pumps</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {attendants.map((a) => (
                  <tr
                    key={a.attendant_id}
                    onClick={() => setSelectedAttendant(a)}
                    className="border-b border-border last:border-0 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <td className="py-3 pr-4 font-medium">{a.name || "Unknown"}</td>
                    <td className="py-3 pr-4 text-right font-mono">{a.salesCount}</td>
                    <td className="py-3 pr-4 text-right font-mono">{a.totalLitres.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="py-3 pr-4 text-right font-mono">KES {a.cashAmount.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right font-mono text-success">KES {a.mpesaAmount.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right font-mono font-semibold text-accent">KES {a.totalAmount.toLocaleString()}</td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">{a.pumps.map((p) => p.code).join(", ") || "—"}</td>
                    <td className="py-3 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
                {attendants.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No attendant sales in this range</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Sale reversal requests — anyone can request, admins approve */}
      <SaleReversalsPanel onChanged={() => setRefreshTick((n) => n + 1)} />


      {/* Daily Fuel Stock & Sales */}
      <Card className="border-l-4 border-l-accent bg-accent/5">
        <CardHeader className="flex flex-row items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> Daily Fuel Stock & Sales
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Opening stock, top-ups, sales (litres & revenue) and closing stock per day. Closing stock of one day is the opening stock of the next.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={fuelFilter} onValueChange={setFuelFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Filter by fuel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All fuel products</SelectItem>
                {fuelDailySeries.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name} · {f.branch}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportDailyFuelPDF} disabled={filteredFuelSeries.length === 0}>
              <FileDown className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={exportDailyFuelExcel} disabled={filteredFuelSeries.length === 0}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {filteredFuelSeries.map((f) => {
            const totalSalesL = f.days.reduce((a, d) => a + d.salesLitres, 0);
            const totalRevenue = f.days.reduce((a, d) => a + d.salesRevenue, 0);
            const totalTopups = f.days.reduce((a, d) => a + d.topups, 0);
            const open = expandedDailyFuel === f.id;
            return (
              <div key={f.id} className="border rounded-lg overflow-hidden">
                <div
                  className="flex flex-wrap items-center justify-between gap-3 p-3 bg-muted/30 cursor-pointer hover:bg-muted/50"
                  onClick={() => setExpandedDailyFuel(open ? null : f.id)}
                >
                  <div className="flex items-center gap-2">
                    <Fuel className="h-4 w-4 text-accent" />
                    <span className="font-semibold">{f.name}</span>
                    <span className="text-xs text-muted-foreground">· {f.branch}</span>
                  </div>
                  <div className="flex gap-4 text-xs font-mono">
                    <span>Top-ups: <b>{totalTopups.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</b></span>
                    <span>Sold: <b>{totalSalesL.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</b></span>
                    <span className="text-accent">Revenue: <b>KES {totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></span>
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                </div>
              </div>
            );
          })}
          {fuelDailySeries.length === 0 && (
            <p className="text-center text-muted-foreground py-6 text-sm">No fuel products</p>
          )}
        </CardContent>
      </Card>

      {/* Daily stock popup for a fuel product */}
      {(() => {
        const f = fuelDailySeries.find((x) => x.id === expandedDailyFuel);
        if (!f) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setExpandedDailyFuel(null)}>
            <div className="bg-card border rounded-lg w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold flex items-center gap-2"><Fuel className="h-4 w-4 text-accent" /> {f.name}</h3>
                  <p className="text-xs text-muted-foreground">{f.branch} · daily opening, top-ups, sales and closing stock</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setExpandedDailyFuel(null)}>Close</Button>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3 text-right">Opening (L)</th>
                      <th className="py-2 px-3 text-right">Top-ups (L)</th>
                      <th className="py-2 px-3 text-right">Sold (L)</th>
                      <th className="py-2 px-3 text-right">Revenue (KES)</th>
                      <th className="py-2 px-3 text-right">Closing (L)</th>
                      {isAdmin && <th className="py-2 px-3 text-right">Fix</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {f.days.map((d) => (
                      <tr key={d.date} className={`border-b last:border-0 ${d.locked ? "bg-muted/30" : ""}`}>
                        <td className="py-2 px-3 font-medium">
                          {format(new Date(d.date), "EEE, MMM d")}
                          {d.locked && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-primary/10 text-primary">locked</span>}
                          {d.corrected && !d.locked && <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600">corrected</span>}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{d.opening.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="py-2 px-3 text-right font-mono text-success">{d.topups ? `+${d.topups.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}</td>
                        <td className="py-2 px-3 text-right font-mono">{d.salesLitres.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="py-2 px-3 text-right font-mono text-accent font-semibold">{d.salesRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="py-2 px-3 text-right font-mono font-semibold">{d.closing.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        {isAdmin && (
                          <td className="py-2 px-3 text-right">
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openCorrection(f, d)}
                              title={d.locked ? "Day is locked — editing requires admin unlock" : "Correct daily stock"}>
                              {d.locked ? "Locked" : "Edit"}
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {f.days.length === 0 && (
                      <tr><td colSpan={isAdmin ? 7 : 6} className="py-6 text-center text-muted-foreground">No days in range</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}


      {/* Admin-only: Stock Discrepancy Alerts */}
      {isAdmin && (
        <Card className={discrepancies.length > 0 ? "border-destructive/40" : ""}>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className={`h-4 w-4 ${discrepancies.length > 0 ? "text-destructive" : "text-accent"}`} />
              Stock Discrepancy Alerts
              {discrepancies.length > 0 && (
                <span className="text-xs font-normal px-2 py-0.5 rounded bg-destructive/10 text-destructive">
                  {discrepancies.length} issue{discrepancies.length !== 1 ? "s" : ""}
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Automated check that daily opening + top-ups − sales = closing for each fuel product, and that opening matches the previous day's closing.
            </p>
          </CardHeader>
          <CardContent>
            {discrepancies.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                ✓ All fuel products reconcile correctly for the selected period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Fuel · Branch</th>
                      <th className="py-2 pr-4">Issue</th>
                      <th className="py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discrepancies.map((d, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono">{format(new Date(d.date), "MMM d, yyyy")}</td>
                        <td className="py-2 pr-4">{d.fuel} <span className="text-muted-foreground text-xs">· {d.branch}</span></td>
                        <td className="py-2 pr-4">
                          <span className="px-2 py-0.5 rounded text-xs bg-destructive/10 text-destructive font-medium">{d.type}</span>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">{d.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}






      <div className="grid md:grid-cols-2 gap-6">
        <Card className="border-l-4 border-l-success bg-success/5">
          <CardHeader><CardTitle className="text-base">Payment Breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm">Cash</span>
              <span className="font-mono font-semibold">KES {paymentBreakdown.cash.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm">M-Pesa</span>
              <span className="font-mono font-semibold text-success">KES {paymentBreakdown.mpesa.toLocaleString()}</span>
            </div>
            <div className="border-t pt-2 flex justify-between items-center">
              <span className="text-sm font-medium">Total</span>
              <span className="font-mono font-bold">KES {(paymentBreakdown.cash + paymentBreakdown.mpesa).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-fuel-diesel bg-fuel-diesel/5">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Receipt className="h-4 w-4" /> Sales Export</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{salesRows.length} sale(s) in range</p>
            </div>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={!salesRows.length}
              onClick={() => exportSalesPDF(salesRows, rangeLabel)}>
              <FileDown className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90" disabled={!salesRows.length}
              onClick={() => exportSalesExcel(salesRows)}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-l-4 border-l-warning bg-warning/5">
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">VAT Report</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Subtotal: KES {totalSubtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} · VAT collected: <span className="text-accent font-semibold">KES {totalVat.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={!vatRows.length}
              onClick={() => exportVatPDF(vatRows, rangeLabel)}>
              <FileDown className="h-4 w-4 mr-2" /> PDF
            </Button>
            <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90" disabled={!vatRows.length}
              onClick={() => exportVatExcel(vatRows)}>
              <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4">Fuel</th>
                  <th className="py-2 pr-4">VAT %</th>
                  <th className="py-2 pr-4 text-right">Sales</th>
                  <th className="py-2 pr-4 text-right">Subtotal</th>
                  <th className="py-2 pr-4 text-right">VAT</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {vatRows.map((r) => (
                  <tr key={`${r.fuel}-${r.rate}`} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4 font-medium">{r.fuel}</td>
                    <td className="py-2.5 pr-4">{r.rate}%</td>
                    <td className="py-2.5 pr-4 text-right font-mono">{r.salesCount}</td>
                    <td className="py-2.5 pr-4 text-right font-mono">{r.subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-accent font-semibold">{r.vat.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-2.5 text-right font-mono font-semibold">{r.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vatRows.length === 0 && <p className="text-center text-muted-foreground py-8">No VAT data in this range</p>}
          </div>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-fuel-kerosene bg-fuel-kerosene/5">
        <CardHeader><CardTitle className="text-base">Daily Sales</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip formatter={(v: number) => `KES ${v.toLocaleString()}`} />
                <Bar dataKey="total" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Projected Profit (moved to bottom) */}
      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="border-l-4 border-l-fuel-petrol bg-fuel-petrol/10"><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Projected Gross Profit</p>
          <p className={`text-2xl font-bold font-mono ${grossProfit >= 0 ? "text-fuel-petrol" : "text-destructive"}`}>KES {grossProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground mt-1">Sum across all fuel products</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-destructive bg-destructive/5"><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Expenses in Period</p>
          <p className="text-2xl font-bold font-mono text-destructive">KES {expensesTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground mt-1">{rangeLabel}</p>
        </CardContent></Card>
        <Card className="border-l-4 border-l-accent bg-accent/10"><CardContent className="pt-6">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Projected Net Profit</p>
          <p className={`text-2xl font-bold font-mono ${netProfit >= 0 ? "text-accent" : "text-destructive"}`}>KES {netProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="text-xs text-muted-foreground mt-1">Gross − expenses</p>
        </CardContent></Card>
      </div>

      <Card className="border-l-4 border-l-primary bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Projected Profit</CardTitle>
          <p className="text-xs text-muted-foreground">
            Based on current stock + top-ups in range × (selling − buying price). Click a fuel for the full breakdown.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4">Fuel</th>
                  <th className="py-2 pr-4">Branch</th>
                  <th className="py-2 pr-4 text-right">Qty (L)</th>
                  <th className="py-2 pr-4 text-right">Selling</th>
                  <th className="py-2 pr-4 text-right">Projected Profit</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {profitRows.map((r) => {
                  const open = expandedProfit === r.id;
                  const qty = r.currentStock + r.topupLitres;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        key={r.id}
                        className="border-b border-border cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedProfit(open ? null : r.id)}
                      >
                        <td className="py-2.5 pr-4 font-medium">{r.name}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{r.branch}</td>
                        <td className="py-2.5 pr-4 text-right font-mono">{qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="py-2.5 pr-4 text-right font-mono">KES {r.sellingPrice.toLocaleString()}</td>
                        <td className={`py-2.5 pr-4 text-right font-mono font-semibold ${r.projectedProfit >= 0 ? "text-accent" : "text-destructive"}`}>
                          {r.buyingPrice == null ? "—" : `KES ${r.projectedProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </td>
                        <td className="py-2.5 text-muted-foreground">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${r.id}-d`} className="border-b border-border bg-muted/30">
                          <td colSpan={6} className="p-4">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Breakdown — {r.name} · {r.branch}</p>
                            <table className="w-full text-sm border rounded">
                              <thead>
                                <tr className="border-b bg-background/50 text-left text-muted-foreground">
                                  <th className="py-2 px-3">Metric</th>
                                  <th className="py-2 px-3 text-right">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b">
                                  <td className="py-2 px-3">Selling price</td>
                                  <td className="py-2 px-3 text-right font-mono">KES {r.sellingPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} / L</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-2 px-3">Buying price (avg from deliveries)</td>
                                  <td className="py-2 px-3 text-right font-mono">{r.buyingPrice == null ? "No deliveries logged" : `KES ${r.buyingPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} / L`}</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-2 px-3">Margin per litre</td>
                                  <td className={`py-2 px-3 text-right font-mono ${r.buyingPrice != null && r.sellingPrice - r.buyingPrice >= 0 ? "text-accent" : "text-destructive"}`}>
                                    {r.buyingPrice == null ? "—" : `KES ${(r.sellingPrice - r.buyingPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                  </td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-2 px-3">Current stock</td>
                                  <td className="py-2 px-3 text-right font-mono">{r.currentStock.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-2 px-3">Top-ups in period</td>
                                  <td className="py-2 px-3 text-right font-mono">{r.topupLitres.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</td>
                                </tr>
                                <tr className="border-b">
                                  <td className="py-2 px-3">Total quantity</td>
                                  <td className="py-2 px-3 text-right font-mono font-semibold">{qty.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</td>
                                </tr>
                                <tr className="bg-muted/40">
                                  <td className="py-2 px-3 font-medium">
                                    Formula: (Selling − Buying) × Quantity
                                    <div className="font-mono text-xs text-muted-foreground mt-0.5">
                                      ({r.sellingPrice.toFixed(2)} − {r.buyingPrice == null ? "?" : r.buyingPrice.toFixed(2)}) × {qty.toFixed(2)}
                                    </div>
                                  </td>
                                  <td className={`py-2 px-3 text-right font-mono font-bold ${r.projectedProfit >= 0 ? "text-accent" : "text-destructive"}`}>
                                    {r.buyingPrice == null ? "—" : `KES ${r.projectedProfit.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {profitRows.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">No fuel products</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Admin: correct daily fuel stock (audit trail records who changed what) */}
      {isAdmin && correction && (
        <CorrectionDialog
          correction={correction}
          form={correctionForm}
          setForm={setCorrectionForm}
          saving={savingCorrection}
          onCancel={() => setCorrection(null)}
          onSave={saveCorrection}
        />
      )}
    </div>
  );
}

function CorrectionDialog({
  correction, form, setForm, saving, onCancel, onSave,
}: {
  correction: { series: FuelDailySeries; day: DailyFuelRow };
  form: { opening: string; closing: string; topups: string; salesLitres: string; salesRevenue: string };
  setForm: (f: any) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { series, day } = correction;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="bg-card border rounded-lg p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="text-lg font-semibold">Correct daily stock</h3>
          <p className="text-xs text-muted-foreground">
            {series.name} · {series.branch} · {format(new Date(day.date), "EEE, MMM d yyyy")}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Changes are recorded in the audit log with your user, timestamp and before/after values.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([
            ["opening", "Opening (L)"],
            ["closing", "Closing (L)"],
            ["topups", "Top-ups (L)"],
            ["salesLitres", "Sold (L)"],
            ["salesRevenue", "Revenue (KES)"],
          ] as const).map(([k, label]) => (
            <label key={k} className="text-xs space-y-1">
              <span className="text-muted-foreground">{label}</span>
              <input
                type="number" step="0.01"
                className="w-full border rounded px-2 py-1.5 bg-background font-mono"
                value={(form as any)[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="text-[11px] text-muted-foreground p-2 rounded bg-muted/40">
          Expected balance: Opening + Top-ups − Sold ={" "}
          <b>{(Number(form.opening) + Number(form.topups) - Number(form.salesLitres)).toFixed(2)}</b> L (should equal Closing).
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} disabled={saving} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {saving ? "Saving..." : "Save correction"}
          </Button>
        </div>
      </div>
    </div>
  );
}

