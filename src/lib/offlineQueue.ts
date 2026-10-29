// Local-first queue for fuel sales recorded while the laptop is offline.
// Items live in localStorage so they survive a browser restart or power cut,
// and are uploaded automatically once the connection returns.

export type QueueStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";
export type ConflictKind = "price" | "stock";
export type Resolution = "merge" | "overwrite";

export interface QueuedFuel {
  id: string;
  name: string;
  pricePerLitre: number;
  vatRate: number;
  legacy: boolean;
}

export interface QueueConflict {
  kind: ConflictKind;
  message: string;
  offlineValue: number;
  serverValue: number;
  detectedAt: string;
}

export interface QueuedSale {
  id: string;                 // local id, also used as the sync idempotency key
  capturedAt: string;         // ISO time the sale actually happened (offline)
  branchId: string | null;
  branchName?: string;
  pumpId: string | null;
  fuel: QueuedFuel;
  litres: number;
  totalAmount: number;
  paymentMethod: string;
  attendantId: string;
  attendantName?: string;
  status: QueueStatus;
  attempts: number;
  lastError?: string;
  conflict?: QueueConflict;
  resolution?: Resolution;
  remoteSaleId?: string;
  syncedAt?: string;
}

const KEY = "psms.offline.sales.v1";
const EVENT = "psms-offline-queue-changed";

function safeParse(raw: string | null): QueuedSale[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedSale[]) : [];
  } catch {
    return [];
  }
}

export function getQueue(): QueuedSale[] {
  if (typeof window === "undefined") return [];
  return safeParse(localStorage.getItem(KEY));
}

function writeQueue(items: QueuedSale[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeQueue(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function enqueueSale(sale: Omit<QueuedSale, "status" | "attempts">): QueuedSale {
  const item: QueuedSale = { ...sale, status: "pending", attempts: 0 };
  writeQueue([item, ...getQueue()]);
  return item;
}

export function updateItem(id: string, patch: Partial<QueuedSale>) {
  writeQueue(getQueue().map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export function removeItem(id: string) {
  writeQueue(getQueue().filter((i) => i.id !== id));
}

export function clearSynced() {
  writeQueue(getQueue().filter((i) => i.status !== "synced"));
}

export function queueCounts(items: QueuedSale[]) {
  return {
    pending: items.filter((i) => i.status === "pending" || i.status === "syncing").length,
    conflict: items.filter((i) => i.status === "conflict").length,
    failed: items.filter((i) => i.status === "failed").length,
    synced: items.filter((i) => i.status === "synced").length,
    total: items.length,
  };
}
