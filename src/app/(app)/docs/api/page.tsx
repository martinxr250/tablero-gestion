"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type OpenApi = { paths: Record<string, Record<string, { summary: string; tags: string[]; security: unknown[] }>> };
const METHOD: Record<string, string> = {
  get: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  post: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  patch: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  put: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  delete: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
};

export default function ApiDocsPage() {
  const { data } = useQuery({ queryKey: ["openapi"], queryFn: () => api<OpenApi>("/openapi.json") });
  const groups = new Map<string, { method: string; path: string; summary: string; auth: boolean }[]>();
  for (const [path, ops] of Object.entries(data?.paths ?? {})) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = op.tags[0] ?? "Otros";
      groups.set(tag, [...(groups.get(tag) ?? []), { method, path, summary: op.summary, auth: op.security.length > 0 }]);
    }
  }
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <PageHeader
        title="API"
        subtitle={
          <>
            Base <code>/api/v1</code> · autenticación por cookie HttpOnly · especificación completa en{" "}
            <a className="text-primary underline" href="/api/v1/openapi.json">
              openapi.json
            </a>
          </>
        }
      />
      {!data && <Skeleton className="h-96" />}
      <div className="space-y-6">
        {[...groups].map(([tag, ops]) => (
          <Card key={tag} className="p-5">
            <h2 className="mb-3 font-semibold">{tag}</h2>
            <ul className="space-y-1.5">
              {ops.map((o) => (
                <li key={o.method + o.path} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge className={cn("w-16 justify-center uppercase", METHOD[o.method])}>{o.method}</Badge>
                  <code className="font-mono text-xs">{o.path}</code>
                  <span className="text-muted-foreground">— {o.summary}</span>
                  {!o.auth && <Badge className="bg-muted text-muted-foreground">pública</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
