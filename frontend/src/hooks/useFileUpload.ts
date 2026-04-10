import { useState, useCallback } from "react";
import { api } from "../api/client";

export interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
  documentId?: string;
}

/**
 * Hook to manage file uploads with progress tracking.
 */
export function useFileUpload() {
  const [uploads, setUploads] = useState<UploadingFile[]>([]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newUploads: UploadingFile[] = Array.from(files).map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      file,
      progress: 0,
      status: "pending" as const,
    }));
    setUploads((prev) => [...prev, ...newUploads]);
    return newUploads;
  }, []);

  const updateUpload = useCallback((id: string, patch: Partial<UploadingFile>) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    );
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const uploadToKb = useCallback(
    async (kbId: string, fileIds?: string[]) => {
      const targets = uploads.filter(
        (u) =>
          (fileIds ? fileIds.includes(u.id) : u.status === "pending") &&
          u.status !== "done",
      );
      const results: string[] = [];
      for (const target of targets) {
        updateUpload(target.id, { status: "uploading", progress: 10 });
        try {
          const result = await api.uploadDocument(kbId, target.file);
          updateUpload(target.id, {
            status: "done",
            progress: 100,
            documentId: result.documentId,
          });
          results.push(result.documentId);
        } catch (err) {
          updateUpload(target.id, {
            status: "error",
            error: String(err),
          });
        }
      }
      return results;
    },
    [uploads, updateUpload],
  );

  const clearDone = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== "done"));
  }, []);

  const selectFiles = useCallback(
    (accept?: string, multiple = true) => {
      return new Promise<FileList | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        if (accept) input.accept = accept;
        input.onchange = () => {
          const files = input.files;
          if (files && files.length > 0) {
            addFiles(files);
            resolve(files);
          } else {
            resolve(null);
          }
        };
        input.click();
      });
    },
    [addFiles],
  );

  return {
    uploads,
    addFiles,
    selectFiles,
    uploadToKb,
    removeUpload,
    clearDone,
    hasPending: uploads.some((u) => u.status === "pending" || u.status === "uploading"),
  };
}
