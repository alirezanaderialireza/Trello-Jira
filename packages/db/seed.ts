import { db } from "./src";
import { boards } from "./src/schema";

async function seed() {
  console.log("🌱 Seeding database...");

  try {
    await db.insert(boards).values({
      id: "123e4567-e89b-12d3-a456-426614174000",

      tenantId: "00000000-0000-0000-0000-000000000001",

      title: "Trello OS Test Board",

      revision: 1,
      aclVersion: 1,

      createdAt: new Date(),
      updatedAt: new Date(),

      archivedAt: null,
      deletedAt: null,
    });

    console.log("✅ Board Created Successfully!");
  } catch (error) {
    console.error("❌ Error creating board:", error);
  }

  process.exit(0);
}

seed();