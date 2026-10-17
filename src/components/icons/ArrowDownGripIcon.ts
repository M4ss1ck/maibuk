import { createLucideIcon } from "lucide-react";

// The Custom Sort's icon: the down arrow of Lucide's ArrowDownAZ, so it reads
// as a Sort beside A to Z and Z to A, with grip dots where the letters sit,
// for the order the author drags Notes into.
export const ArrowDownGripIcon = createLucideIcon("arrow-down-grip", [
  ["path", { d: "m3 16 4 4 4-4", key: "arrow-head" }],
  ["path", { d: "M7 20V4", key: "arrow-shaft" }],
  ["circle", { cx: "15", cy: "6", r: "1", key: "grip-1" }],
  ["circle", { cx: "20", cy: "6", r: "1", key: "grip-2" }],
  ["circle", { cx: "15", cy: "12", r: "1", key: "grip-3" }],
  ["circle", { cx: "20", cy: "12", r: "1", key: "grip-4" }],
  ["circle", { cx: "15", cy: "18", r: "1", key: "grip-5" }],
  ["circle", { cx: "20", cy: "18", r: "1", key: "grip-6" }],
]);
