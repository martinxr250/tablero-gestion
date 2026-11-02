"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert, Button, Card, Spinner } from "@/components/ui/primitives";
import { api } from "@/lib/api";

type Lookup = { orgName: string; target: string; scope: string; role: string; inviterName: string | null; emailMatches: boolean };

function InviteContent() {
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();
  const qc = useQueryClient();
  const lookup = useQuery({ queryKey: ["invite", token], queryFn: () => api<Lookup>("/invitations/lookup", { method: "POST", body: { token } }), enabled: !!token, retry: false });
  const accept = useMutation({
    mutationFn: () => api<{ orgId: string; workspaceId: string | null; boardId: string | null }>("/invitations/accept", { method: "POST", body: { token } }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace(r.boardId ? `/b/${r.boardId}` : r.workspaceId ? `/w/${r.workspaceId}` : `/o/${r.orgId}`);
    },
  });
  const scope = { org: "la organización", workspace: "el espacio de trabajo", board: "el tablero" }[lookup.data?.scope ?? "org"];
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="space-y-4 p-6 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-primary" />
        {!token && <Alert>El enlace de invitación no es válido.</Alert>}
        {lookup.isLoading && <Spinner className="mx-auto" />}
        {lookup.error && <Alert>{(lookup.error as Error).message}</Alert>}
        {lookup.data && (
          <>
            <h1 className="text-xl font-semibold">Te invitaron a {scope} “{lookup.data.target}”</h1>
            <p className="text-sm text-muted-foreground">
              {lookup.data.inviterName ?? "Alguien"} te invitó a {lookup.data.orgName} con rol <strong>{lookup.data.role}</strong>.
            </p>
            {lookup.data.emailMatches ? (
              <Button className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
                Aceptar invitación
              </Button>
            ) : (
              <Alert>Esta invitación es para otro correo. Cerrá sesión e ingresá con la cuenta invitada.</Alert>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteContent />
    </Suspense>
  );
}
