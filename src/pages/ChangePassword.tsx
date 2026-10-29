import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";

export default function ChangePassword() {
  const { user, signOut, refreshProfile } = useAuth();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (pw !== confirm) { toast.error("Passwords do not match"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      if (user?.id) {
        await supabase.from("profiles").update({
          must_change_password: false,
          id_number_used_as_password: false,
        }).eq("user_id", user.id);
      }
      toast.success("Password updated");
      await refreshProfile();
    } catch (err: any) {
      toast.error(err.message ?? "Failed to update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <ShieldAlert className="h-10 w-10 mx-auto text-accent" />
          <CardTitle>Set a new password</CardTitle>
          <p className="text-sm text-muted-foreground">
            Your account is using a temporary password. Please choose a new password before continuing.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Updating..." : "Update password"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()} disabled={busy}>
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
