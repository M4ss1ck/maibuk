export type VersionTrigger =
  | "manual"
  | "auto-idle"
  | "close"
  | "pre-sync"
  | "pre-restore";

// List-item shape — deliberately excludes the heavy `snapshot` field.
export interface BookVersion {
  id: string;
  bookId: string;
  name: string | null;
  wordCount: number;
  checksum: string;
  triggerType: VersionTrigger;
  createdAt: Date;
  syncedAt: Date | null;
}

export interface CreateVersionInput {
  bookId: string;
  name?: string;
  triggerType: VersionTrigger;
}

export interface RestoreOptions {
  // localized name for the auto-created pre-restore version; UI supplies it
  preRestoreName?: string;
}
