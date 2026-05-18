export interface List {
  id: string;
  tenantId: string;
  boardId: string;
  title: string;
  position: string;
  revision: number;   // 🌟 اضافه شد
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; 
  archivedAt: Date | null; // 🌟 اضافه شد (برای Board Archived Guard)
}