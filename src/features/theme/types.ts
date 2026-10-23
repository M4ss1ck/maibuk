/** What the first frame paints, recorded before the app loads. */
export type BootTheme = {
  v: 1;
  mode: "light" | "dark" | "system";
  vars: Record<string, string>;
};
