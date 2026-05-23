// apps/web/src/infrastructure/platform/crdtEngine.ts
// Conflict-free replicated data type engine for collaborative text editing.
// Implements a simplified RGA (Replicated Growable Array) for card descriptions/comments.

import { telemetry } from "@/lib/telemetry/logEvent";

export interface CrdtChar { readonly id: string; readonly value: string; readonly afterId: string | null; readonly deleted: boolean; readonly timestamp: number; readonly actorId: string; }
export interface CrdtDocument { readonly id: string; chars: CrdtChar[]; version: number; }
export type CrdtOp = { type: "insert"; char: CrdtChar } | { type: "delete"; charId: string; actorId: string; timestamp: number };

export class CrdtEngine {
  private documents = new Map<string, CrdtDocument>();

  getOrCreate(docId: string): CrdtDocument {
    let doc = this.documents.get(docId);
    if (!doc) { doc = { id: docId, chars: [], version: 0 }; this.documents.set(docId, doc); }
    return doc;
  }

  getText(docId: string): string {
    const doc = this.documents.get(docId);
    if (!doc) return "";
    return this._linearize(doc).map((c) => c.value).join("");
  }

  applyOp(docId: string, op: CrdtOp): void {
    const doc = this.getOrCreate(docId);
    if (op.type === "insert") {
      // Idempotent: skip if char already exists
      if (doc.chars.some((c) => c.id === op.char.id)) return;
      // Insert after the referenced char
      const afterIdx = op.char.afterId === null ? -1 : doc.chars.findIndex((c) => c.id === op.char.afterId);
      const insertAt = afterIdx + 1;
      doc.chars.splice(insertAt, 0, op.char);
      doc.version++;
    } else {
      const char = doc.chars.find((c) => c.id === op.charId);
      if (!char || char.deleted) return; // idempotent
      (char as any).deleted = true;
      doc.version++;
    }
  }

  applyOps(docId: string, ops: readonly CrdtOp[]): void {
    for (const op of ops) this.applyOp(docId, op);
  }

  insertAt(docId: string, index: number, value: string, actorId: string): CrdtOp {
    const doc = this.getOrCreate(docId);
    const linear = this._linearize(doc);
    const afterChar = index > 0 ? linear[index - 1] : null;
    const char: CrdtChar = { id: crypto.randomUUID(), value, afterId: afterChar?.id ?? null, deleted: false, timestamp: Date.now(), actorId };
    this.applyOp(docId, { type: "insert", char });
    return { type: "insert", char };
  }

  deleteAt(docId: string, index: number, actorId: string): CrdtOp | null {
    const doc = this.documents.get(docId);
    if (!doc) return null;
    const linear = this._linearize(doc);
    const char = linear[index];
    if (!char) return null;
    const op: CrdtOp = { type: "delete", charId: char.id, actorId, timestamp: Date.now() };
    this.applyOp(docId, op);
    return op;
  }

  removeDocument(docId: string): void { this.documents.delete(docId); }

  private _linearize(doc: CrdtDocument): CrdtChar[] {
    // Simple linearization: filter deleted, preserve insertion order
    return doc.chars.filter((c) => !c.deleted);
  }
}

export const crdtEngine = new CrdtEngine();
