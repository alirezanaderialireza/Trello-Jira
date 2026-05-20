import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to workspaces — user picks workspace then board.
  redirect("/workspaces");
}