"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useOrg } from "@/components/shell/org-context";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api";

export default function NewOrgPage() {
  const [name, setName] = useState("");
  const router = useRouter();
  const qc = useQueryClient();
  const { setOrgId } = useOrg();
  const create = useMutation({
    mutationFn: () => api<{ id: string }>("/orgs", { method: "POST", body: { name } }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      setOrgId(id);
      router.push(`/o/${id}`);
    },
  });
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <PageHeader title="Nueva organización" subtitle="Una organización agrupa a tu equipo, sus espacios de trabajo y tableros. Sus datos quedan aislados del resto." />
      <Card className="p-6">
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Nombre" htmlFor="org-name">
            <Input id="org-name" autoFocus required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Estudio Norte" />
          </Field>
          <Button type="submit" className="w-full" loading={create.isPending} disabled={!name.trim()}>
            Crear organización
          </Button>
        </form>
      </Card>
    </div>
  );
}
