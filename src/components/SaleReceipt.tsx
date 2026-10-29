import { useRef, useState } from "react";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Download, Receipt as ReceiptIcon, Droplet, ChevronDown, ChevronRight } from "lucide-react";

export interface DeductionTank {
  label: string;         // tank code / label
  remaining: number;     // current level after this sale (L)
  capacity?: number;     // tank capacity (L)
}
export interface ReceiptDeduction {
  fuelName: string;
  litresDeducted: number;
  tanks: DeductionTank[];
}

export interface ReceiptData {
  receiptNo: string;
  date: Date;
  branchName?: string;
  attendantName?: string;
  fuelName: string;
  pricePerLitre: number;
  litres: number;
  vatRate: number; // %
  totalAmount: number; // VAT-inclusive
  paymentMethod: string;
  phone?: string;
  deduction?: ReceiptDeduction;
  /** Recorded while the laptop was offline and not yet uploaded. */
  offlinePending?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: ReceiptData | null;
}

export default function SaleReceipt({ open, onOpenChange, data }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [showDeduction, setShowDeduction] = useState(false);
  if (!data) return null;

  const vatFraction = data.vatRate / 100;
  const subtotal = data.totalAmount / (1 + vatFraction);
  const vat = data.totalAmount - subtotal;

  const handlePrint = () => {
    const node = printRef.current;
    if (!node) return;
    const win = window.open("", "_blank", "width=400,height=600");
    if (!win) return;
    win.document.write(`<html><head><title>Receipt ${data.receiptNo}</title>
      <style>
        body{font-family:'Courier New',monospace;padding:12px;color:#000;}
        h1{font-size:16px;margin:0 0 4px;text-align:center;}
        .row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0;}
        .sep{border-top:1px dashed #000;margin:6px 0;}
        .center{text-align:center;font-size:11px;}
        .bold{font-weight:bold;}
      </style></head><body>${node.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 200);
  };

  const handleDownload = () => {
    const doc = new jsPDF({ unit: "mm", format: [80, 160] });
    let y = 8;
    doc.setFont("courier", "bold").setFontSize(11);
    doc.text("FUEL SALE RECEIPT", 40, y, { align: "center" }); y += 5;
    if (data.branchName) { doc.setFontSize(9).setFont("courier", "normal"); doc.text(data.branchName, 40, y, { align: "center" }); y += 4; }
    doc.setFontSize(8);
    doc.text(`Receipt: ${data.receiptNo}`, 40, y, { align: "center" }); y += 4;
    doc.text(format(data.date, "yyyy-MM-dd HH:mm:ss"), 40, y, { align: "center" }); y += 4;
    if (data.offlinePending) {
      doc.setFont("courier", "bold");
      doc.text("*** OFFLINE - PENDING SYNC ***", 40, y, { align: "center" }); y += 4;
      doc.setFont("courier", "normal");
    }
    y += 1;
    doc.line(4, y, 76, y); y += 4;

    const row = (l: string, r: string, bold = false) => {
      doc.setFont("courier", bold ? "bold" : "normal");
      doc.text(l, 5, y); doc.text(r, 75, y, { align: "right" }); y += 4;
    };
    row("Fuel:", data.fuelName);
    row("Price/L:", `KES ${data.pricePerLitre.toFixed(2)}`);
    row("Litres:", `${data.litres.toFixed(2)} L`);
    y += 1; doc.line(4, y, 76, y); y += 4;
    row("Subtotal:", `KES ${subtotal.toFixed(2)}`);
    row(`VAT (${data.vatRate}%):`, `KES ${vat.toFixed(2)}`);
    row("TOTAL:", `KES ${data.totalAmount.toFixed(2)}`, true);
    y += 1; doc.line(4, y, 76, y); y += 4;
    row("Payment:", data.paymentMethod.toUpperCase());
    if (data.phone) row("Phone:", data.phone);
    if (data.attendantName) row("Attendant:", data.attendantName);
    y += 3;
    doc.setFont("courier", "normal").setFontSize(7);
    doc.text("Thank you. Drive safely!", 40, y, { align: "center" });
    doc.save(`receipt-${data.receiptNo}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ReceiptIcon className="h-4 w-4" />Sale Receipt</DialogTitle>
        </DialogHeader>

        <div ref={printRef} className="bg-background border border-dashed border-border rounded p-4 font-mono text-xs">
          <h1 className="text-center font-bold text-sm mb-1">FUEL SALE RECEIPT</h1>
          {data.branchName && <p className="center text-center text-[11px] text-muted-foreground">{data.branchName}</p>}
          <p className="center text-center text-[10px] text-muted-foreground">Receipt: {data.receiptNo}</p>
          <p className="center text-center text-[10px] text-muted-foreground mb-2">{format(data.date, "yyyy-MM-dd HH:mm:ss")}</p>
          {data.offlinePending && (
            <p className="center text-center text-[10px] bold font-bold mb-2">*** OFFLINE — PENDING SYNC ***</p>
          )}
          <div className="sep border-t border-dashed border-border my-2" />
          <div className="row flex justify-between"><span>Fuel:</span><span>{data.fuelName}</span></div>
          <div className="row flex justify-between"><span>Price/L:</span><span>KES {data.pricePerLitre.toFixed(2)}</span></div>
          <div className="row flex justify-between"><span>Litres:</span><span>{data.litres.toFixed(2)} L</span></div>
          <div className="sep border-t border-dashed border-border my-2" />
          <div className="row flex justify-between"><span>Subtotal:</span><span>KES {subtotal.toFixed(2)}</span></div>
          <div className="row flex justify-between"><span>VAT ({data.vatRate}%):</span><span>KES {vat.toFixed(2)}</span></div>
          <div className="row flex justify-between font-bold bold"><span>TOTAL:</span><span>KES {data.totalAmount.toFixed(2)}</span></div>
          <div className="sep border-t border-dashed border-border my-2" />
          <div className="row flex justify-between"><span>Payment:</span><span>{data.paymentMethod.toUpperCase()}</span></div>
          {data.phone && <div className="row flex justify-between"><span>Phone:</span><span>{data.phone}</span></div>}
          {data.attendantName && <div className="row flex justify-between"><span>Attendant:</span><span>{data.attendantName}</span></div>}
          <p className="center text-center text-[10px] mt-3">Thank you. Drive safely!</p>
        </div>

        {data.deduction && (
          <div className="rounded-md border border-border bg-muted/30">
            <button
              type="button"
              onClick={() => setShowDeduction((s) => !s)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2 font-medium">
                <Droplet className="h-4 w-4 text-accent" />
                View fuel deduction
              </span>
              {showDeduction ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {showDeduction && (
              <div className="px-3 pb-3 space-y-2 text-xs">
                <div className="flex justify-between border-t pt-2">
                  <span className="text-muted-foreground">Product</span>
                  <span className="font-medium">{data.deduction.fuelName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Litres deducted</span>
                  <span className="font-mono font-semibold text-accent">{data.deduction.litresDeducted.toFixed(2)} L</span>
                </div>
                <div className="pt-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Tank levels after sale</p>
                  {data.deduction.tanks.length === 0 ? (
                    <p className="text-muted-foreground italic">No tanks linked to this product.</p>
                  ) : (
                    <div className="space-y-1">
                      {data.deduction.tanks.map((t, i) => {
                        const pct = t.capacity && t.capacity > 0 ? Math.min(100, (t.remaining / t.capacity) * 100) : null;
                        return (
                          <div key={i} className="space-y-0.5">
                            <div className="flex justify-between">
                              <span className="font-mono">{t.label}</span>
                              <span className="font-mono font-semibold">
                                {t.remaining.toFixed(2)} L{t.capacity ? ` / ${t.capacity.toFixed(0)} L` : ""}
                              </span>
                            </div>
                            {pct != null && (
                              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className={`h-full ${pct < 15 ? "bg-destructive" : pct < 35 ? "bg-warning" : "bg-accent"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={handlePrint}><Printer className="h-4 w-4 mr-2" />Print</Button>
          <Button onClick={handleDownload} className="bg-accent text-accent-foreground hover:bg-accent/90"><Download className="h-4 w-4 mr-2" />PDF</Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
