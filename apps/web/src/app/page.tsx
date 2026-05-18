import { redirect } from "next/navigation";

export default function Home() {
  // در آینده این آیدی از دیتابیس یا سشن کاربر خوانده می‌شود
  const defaultBoardId = "0bf1afb6-79d6-4b6a-b940-876c83ba898a"; 
  
  // هدایت کاربر به محیط امن بورد
  redirect(`/board/${defaultBoardId}`);
}