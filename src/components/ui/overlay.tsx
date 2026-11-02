"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog as UiDialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover as UiPopover, PopoverContent as UiPopoverContent, PopoverTrigger as UiPopoverTrigger } from "@/components/ui/popover";
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <UiDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("max-h-[90vh] gap-5 overflow-y-auto rounded-3xl p-6 scroll-thin", wide ? "sm:max-w-4xl" : "sm:max-w-md", className)}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
          <DialogDescription className={description ? undefined : "sr-only"}>
            {description ?? (typeof title === "string" ? title : "Diálogo")}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </UiDialog>
  );
}

export const Menu = DropdownMenu;
export const MenuTrigger = DropdownMenuTrigger;
export function MenuContent({ className, align = "end", ...props }: ComponentProps<typeof DropdownMenuContent>) {
  return <DropdownMenuContent align={align} className={cn("min-w-48 rounded-xl", className)} {...props} />;
}
export function MenuItem({ danger, ...props }: ComponentProps<typeof DropdownMenuItem> & { danger?: boolean }) {
  return <DropdownMenuItem variant={danger ? "destructive" : "default"} {...props} />;
}
export const MenuSeparator = DropdownMenuSeparator;
export const MenuLabel = ({ children }: { children: ReactNode }) => <DropdownMenuLabel>{children}</DropdownMenuLabel>;

export const Popover = UiPopover;
export const PopoverTrigger = UiPopoverTrigger;
export function PopoverContent({ className, align = "start", ...props }: ComponentProps<typeof UiPopoverContent>) {
  return <UiPopoverContent align={align} className={cn("w-72 rounded-2xl", className)} {...props} />;
}

export function Tabs({ value, onValueChange, tabs, children }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: string }[]; children: ReactNode }) {
  return (
    <UiTabs value={value} onValueChange={onValueChange} className="gap-5">
      <TabsList aria-label="Secciones" className="h-auto w-fit max-w-full flex-wrap gap-1.5 rounded-full border bg-card p-1.5 group-data-horizontal/tabs:h-auto">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="h-9 flex-none rounded-full px-4 py-0 text-sm after:hidden data-[state=active]:border-transparent data-[state=active]:bg-foreground data-[state=active]:text-background data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-foreground"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </UiTabs>
  );
}
export const TabPanel = TabsContent;
