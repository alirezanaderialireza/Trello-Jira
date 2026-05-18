"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateCardForm({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async () => {
    if (!title.trim() || loading) return;

    try {
      setLoading(true);
      await onCreate(title); // ارسال به سرور
      setTitle("");
      
      // 🔥 این خط جادویی باعث میشه سرور داده‌های جدید رو بگیره و صفحه رو آپدیت کنه
      router.refresh(); 

    } catch (err: any) {
      // 👈 استفاده از DomainError
      if (err.name === "TRPCError" && err.message.includes("DomainError")) {
          alert("Error: " + err.message);
      } else {
          alert(err.message || "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={loading}
        placeholder="Enter card title..."
        style={{ 
          padding: "12px 16px", 
          border: "1px solid #d2d2d7", 
          borderRadius: "10px",
          fontSize: "15px",
          width: "300px",
          outline: "none",
          backgroundColor: "#ffffff",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.02)"
        }}
      />
      <button 
        onClick={handleSubmit} 
        disabled={loading}
        style={{ 
          padding: "12px 24px", 
          cursor: loading ? "not-allowed" : "pointer",
          backgroundColor: loading ? "#a1a1aa" : "#0A2540", // Navy accent
          color: "#ffffff",
          border: "none",
          borderRadius: "10px",
          fontWeight: 500,
          fontSize: "15px",
          boxShadow: "0 2px 6px rgba(10, 37, 64, 0.15)",
          transition: "all 0.2s ease"
        }}
      >
        {loading ? "Creating..." : "Create Card"}
      </button>
    </div>
  );
}