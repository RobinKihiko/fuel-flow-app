import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { PasswordConfirmDialog } from "@/components/PasswordConfirmDialog";

type ConfirmFn = (opts: {
  title?: string;
  description?: string;
  confirmLabel?: string;
  requireAdmin?: boolean;
  action: () => Promise<void> | void;
}) => void;

const Ctx = createContext<{ confirmDelete: ConfirmFn } | undefined>(undefined);

export function ConfirmDeleteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Parameters<ConfirmFn>[0] | null>(null);

  const confirmDelete: ConfirmFn = useCallback((o) => {
    setOpts(o);
    setOpen(true);
  }, []);

  return (
    <Ctx.Provider value={{ confirmDelete }}>
      {children}
      <PasswordConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={opts?.title ?? "Confirm deletion"}
        description={opts?.description ?? "This action is permanent. Re-enter your password to continue."}
        confirmLabel={opts?.confirmLabel ?? "Delete"}
        destructive
        requireAdmin={opts?.requireAdmin ?? true}
        onConfirmed={async () => { if (opts) await opts.action(); }}
      />
    </Ctx.Provider>
  );
}

export function useConfirmDelete() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConfirmDelete must be used within ConfirmDeleteProvider");
  return v.confirmDelete;
}
