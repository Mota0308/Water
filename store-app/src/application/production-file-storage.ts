import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type FileStorage = {
  save(input: {
    projectId: string;
    fileName: string;
    contentType: string;
    data: Buffer;
  }): Promise<{ storageKey: string; size: number }>;
  read(storageKey: string): Promise<Buffer>;
};

export function createLocalFileStorage(rootDir: string): FileStorage {
  return {
    async save(input) {
      const dir = path.join(rootDir, "production", input.projectId);
      await mkdir(dir, { recursive: true });
      const safeName = input.fileName.replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_");
      const storageKey = path
        .join("production", input.projectId, `${randomUUID()}-${safeName}`)
        .replace(/\\/g, "/");
      const fullPath = path.join(rootDir, storageKey);
      await writeFile(fullPath, input.data);
      return { storageKey, size: input.data.length };
    },
    async read(storageKey) {
      return readFile(path.join(rootDir, storageKey));
    },
  };
}
