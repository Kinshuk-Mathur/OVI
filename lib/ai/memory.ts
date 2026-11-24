/** Retrieval is a separate, permission-aware input to inference. V1 never searches a vault. */
export interface MemoryRecord {
  category: "personal" | "episodic" | "conversation" | "reflective";
  text: string;
  evidenceId: string;
}
export interface MemoryProvider {
  getRelevantMemories(request: { uid: string; query: string }): Promise<readonly MemoryRecord[]>;
}
export const memoryProvider: MemoryProvider = {
  async getRelevantMemories() {
    return [];
  },
};
