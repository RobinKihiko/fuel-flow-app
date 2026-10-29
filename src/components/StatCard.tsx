import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: ReactNode;
  trend?: "up" | "down";
  className?: string;
}

export default function StatCard({ title, value, subtitle, icon, className }: StatCardProps) {
  return (
    <Card className={cn("border-border", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold font-mono">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
