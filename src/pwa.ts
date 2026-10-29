// Single guarded service-worker registration wrapper.
const SW_URL = "/sw.js";

function isBlockedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  if (typeof window === "undefined") return true;
  if (window.parent && window.parent !== window) return true;
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  const zones = ["lovableproject.com", "lovableproject-dev.com", "beta.lovable.dev"];
  if (zones.some((z) => host === z || host.endsWith("." + z))) return true;
  if (new URLSearchParams(window.location.search).has("sw")) {
    if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  }
  return false;
}

async function unregisterApp() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs
      .filter((r) => (r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "").endsWith(SW_URL))
      .map((r) => r.unregister()),
  );
}

export function registerPWA() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (isBlockedContext()) {
    void unregisterApp();
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch(() => undefined);
  });
}
