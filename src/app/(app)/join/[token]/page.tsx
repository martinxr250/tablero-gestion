"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Alert, Button, Card, Spinner } from "@/components/ui/primitives";
import { api, ApiError } from "@/lib/api";

type Lookup = { boardId: string; boardName: string; orgName: string; role: "viewer" | "commenter" | "editor"; archived: boolean; currentRole: string | null };
const ROLE_TEXT = { viewer: "solo ver", commenter: "comentar", editor: "editar" } as const;

export default function JoinBoardPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["join", token], queryFn: () => api<Lookup>(`/share/join/${token}`), retry: false });
  const join = useMutation({
    mutationFn: () => api<{ boardId: string }>(`/share/join/${token}`, { method: "POST" }),
    onSuccess: async ({ boardId }) => {
      await qc.invalidateQueries();
      router.replace(`/b/${boardId}`);
    },
  });
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card className="space-y-4 p-6 text-center">
        <Link2 className="mx-auto h-10 w-10 text-primary" />
        {q.isLoading && <Spinner className="mx-auto" />}
        {q.error && <Alert>{q.error instanceof ApiError && q.error.status === 404 ? "Este enlace no está disponible: puede que lo hayan desactivado o reemplazado." : (q.error as Error).message}</Alert>}
        {q.data && (
          <>
            <h1 className="text-xl font-semibold">Unirte a “{q.data.boardName}”</h1>
            <p className="text-sm text-muted-foreground">
              Tablero de {q.data.orgName}. Vas a poder <strong>{ROLE_TEXT[q.data.role]}</strong>.
            </p>
            {q.data.archived ? (
              <Alert>El tablero está archivado y no admite nuevos miembros.</Alert>
            ) : q.data.currentRole ? (
              <Button className="w-full" onClick={() => router.replace(`/b/${q.data!.boardId}`)}>
                Ya tenés acceso: abrir tablero
              </Button>
            ) : (
              <Button className="w-full" loading={join.isPending} onClick={() => join.mutate()}>
                Unirme al tablero
              </Button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
