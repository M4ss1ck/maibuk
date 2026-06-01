const TAG_PALETTE = ["#60a5fa", "#c084fc", "#4ade80", "#fbbf24", "#f87171", "#38bdf8"];

export function tagColor(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  const hash = Array.from(normalized).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}
