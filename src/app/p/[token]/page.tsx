import type { Metadata } from "next";
import { PublicBoard } from "@/components/board/public-board";

export const metadata: Metadata = { title: "Tablero compartido", robots: { index: false, follow: false } };

export default async function PublicBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicBoard token={token} />;
}
