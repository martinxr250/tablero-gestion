"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { BoardView } from "@/components/board/board-view";

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  return (
    <Suspense>
      <BoardView key={boardId} boardId={boardId} />
    </Suspense>
  );
}
