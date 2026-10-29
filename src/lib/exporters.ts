import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function writeSheet(wb: ExcelJS.Workbook, name: string, rows: Record<string, any>[]) {
  const ws = wb.addWorksheet(name);
  if (rows.length === 0) return ws;
  const headers = Object.keys(rows[0]);
  ws.columns = headers.map((h) => ({ header: h, key: h }));
  rows.forEach((r) => ws.addRow(r));
  return ws;
}
import { format } from "date-fns";

export interface SalesRow {
  date: string;
  branch: string;
  fuel: string;
  litres: number;
  pricePerLitre: number;
  vatRate: number;
  subtotal: number;
  vat: number;
  total: number;
  payment: string;
}

export function exportSalesPDF(rows: SalesRow[], rangeLabel: string) {
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14).text("Sales Report", 14, 14);
  doc.setFontSize(10).text(rangeLabel, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [["Date", "Branch", "Fuel", "Litres", "Price/L", "Subtotal", "VAT", "Total", "Payment"]],
    body: rows.map((r) => [
      r.date, r.branch, r.fuel,
      r.litres.toFixed(2), r.pricePerLitre.toFixed(2),
      r.subtotal.toFixed(2), r.vat.toFixed(2), r.total.toFixed(2),
      r.payment.toUpperCase(),
    ]),
    foot: [[
      "", "", "Totals",
      sum(rows, "litres").toFixed(2), "",
      sum(rows, "subtotal").toFixed(2),
      sum(rows, "vat").toFixed(2),
      sum(rows, "total").toFixed(2),
      "",
    ]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 41, 59] },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
  });
  doc.save(`sales-${format(new Date(), "yyyyMMdd-HHmm")}.pdf`);
}

export async function exportSalesExcel(rows: SalesRow[]) {
  const wb = new ExcelJS.Workbook();
  writeSheet(wb, "Sales", rows.map((r) => ({
    Date: r.date, Branch: r.branch, Fuel: r.fuel,
    Litres: r.litres, "Price/L": r.pricePerLitre,
    "VAT %": r.vatRate, Subtotal: r.subtotal, VAT: r.vat,
    Total: r.total, Payment: r.payment.toUpperCase(),
  })));
  await downloadWorkbook(wb, `sales-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`);
}

export interface VatRow { fuel: string; rate: number; salesCount: number; subtotal: number; vat: number; total: number; }

export function exportVatPDF(rows: VatRow[], rangeLabel: string) {
  const doc = new jsPDF();
  doc.setFontSize(14).text("VAT Report", 14, 14);
  doc.setFontSize(10).text(rangeLabel, 14, 21);
  autoTable(doc, {
    startY: 26,
    head: [["Fuel", "VAT %", "Sales", "Subtotal (KES)", "VAT (KES)", "Total (KES)"]],
    body: rows.map((r) => [r.fuel, `${r.rate}%`, r.salesCount, r.subtotal.toFixed(2), r.vat.toFixed(2), r.total.toFixed(2)]),
    foot: [[
      "Totals", "", rows.reduce((a, r) => a + r.salesCount, 0),
      sum(rows, "subtotal").toFixed(2),
      sum(rows, "vat").toFixed(2),
      sum(rows, "total").toFixed(2),
    ]],
    headStyles: { fillColor: [30, 41, 59] },
    footStyles: { fillColor: [241, 245, 249], textColor: 20, fontStyle: "bold" },
  });
  doc.save(`vat-${format(new Date(), "yyyyMMdd-HHmm")}.pdf`);
}

export async function exportVatExcel(rows: VatRow[]) {
  const wb = new ExcelJS.Workbook();
  writeSheet(wb, "VAT", rows.map((r) => ({
    Fuel: r.fuel, "VAT %": r.rate, Sales: r.salesCount,
    Subtotal: r.subtotal, VAT: r.vat, Total: r.total,
  })));
  await downloadWorkbook(wb, `vat-${format(new Date(), "yyyyMMdd-HHmm")}.xlsx`);
}

function sum<T>(rows: T[], k: keyof T) {
  return rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
}
