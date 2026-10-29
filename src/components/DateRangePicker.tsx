import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
  align?: "start" | "center" | "end";
}

export function DateRangePicker({ value, onChange, className, align = "end" }: DateRangePickerProps) {
  const [fromOpen, setFromOpen] = React.useState(false);
  const [toOpen, setToOpen] = React.useState(false);

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
  };

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {/* From */}
      <Popover open={fromOpen} onOpenChange={setFromOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 justify-start text-left font-normal",
              !value?.from && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            <span className="text-xs mr-1 text-muted-foreground">From:</span>
            {value?.from ? format(value.from, "MMM d, yyyy") : <span>Pick start</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            mode="single"
            selected={value?.from}
            onSelect={(d) => {
              if (!d) return;
              onChange({ from: d, to: value?.to && value.to < d ? undefined : value?.to });
              setFromOpen(false);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

      {/* To */}
      <Popover open={toOpen} onOpenChange={setToOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-9 justify-start text-left font-normal",
              !value?.to && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            <span className="text-xs mr-1 text-muted-foreground">To:</span>
            {value?.to ? format(value.to, "MMM d, yyyy") : <span>Pick end</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            mode="single"
            selected={value?.to}
            defaultMonth={value?.to ?? value?.from}
            disabled={value?.from ? { before: value.from } : undefined}
            onSelect={(d) => {
              if (!d) return;
              onChange({ from: value?.from, to: d });
              setToOpen(false);
            }}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

      {(value?.from || value?.to) && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={clear}
          title="Clear date range"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
