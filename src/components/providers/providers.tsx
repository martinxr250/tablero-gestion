"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";

export function Providers({ nonce, children }: { nonce?: string; children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
            refetchOnWindowFocus: true,
          },
        },
        queryCache: new QueryCache(),
        mutationCache: new MutationCache({
          // Toda mutación fallida se informa al usuario (sin errores silenciosos).
          onError: (err, _v, _c, mutation) => {
            if (mutation.options.meta?.silent) return;
            toast.error(err instanceof Error ? err.message : "Ocurrió un error");
          },
        }),
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem nonce={nonce} disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-right" closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
