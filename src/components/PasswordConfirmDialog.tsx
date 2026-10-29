import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** When true, only admins may confirm. */
  requireAdmin?: boolean;
  onConfirmed: () => Promise<void> | void;
}

export function PasswordConfirmDialog({
  open, onOpenChange, title = "Confirm your password",
  description = "For security, please re-enter your password to proceed.",
  confirmLabel = "Confirm", destructive = false, requireAdmin = false,
  onConfirmed,
}: Props) {
  const { user, hasRole } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!user?.email) { toast.error("Not signed in"); return; }
    if (requireAdmin && !hasRole("admin")) {
      toast.error("Admin privileges required");
      return;
    }
    if (!password) { toast.error("Enter your password"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
      if (error) { toast.error("Password incorrect"); return; }
      await onConfirmed();
      setPassword("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { onOpenChange(v); if (!v) setPassword(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className={`h-5 w-5 ${destructive ? "text-destructive" : "text-accent"}`} />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-pw">Password</Label>
          <Input id="confirm-pw" type="password" value={password} autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          {requireAdmin && (
            <p className="text-xs text-muted-foreground">Admin authentication required.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={submit} disabled={busy}>
            {busy ? "Verifying..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
