const TAG_PALETTE = [
  "#60a5fa",
  "#c084fc",
  "#4ade80",
  "#fbbf24",
  "#f87171",
  "#38bdf8",
  "#a78bfa",
  "#fb923c",
  "#2dd4bf",
  "#e879f9",
  "#facc15",
  "#34d399",
  "#f472b6",
  "#818cf8",
];

export function tagColor(tag: string): string {
  const normalized = tag.trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) >>> 0;
  }
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}
