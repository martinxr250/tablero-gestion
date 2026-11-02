import type { Metadata } from "next";
import { MyWork } from "@/components/work/my-work";

export const metadata: Metadata = { title: "Mi trabajo" };

export default function WorkPage() {
  return <MyWork />;
}
