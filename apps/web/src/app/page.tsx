import { redirect } from "next/navigation";

export default function Home() {
  // Redirect to board list — the user picks their board from there.
  redirect("/boards");
}