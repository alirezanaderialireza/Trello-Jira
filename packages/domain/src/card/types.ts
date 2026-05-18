export interface Card {
  id: string;
  tenantId: string;
  boardId: string;    // 🌟 اضافه شد
  listId: string;
  title: string;
  description: string | null;
  position: string;
  revision: number;   // 🌟 اضافه شد (برای OCC Lock)
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // 🌟 اضافه شد (برای Soft Delete)
}