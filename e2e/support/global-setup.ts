import { writeSeedFiles } from "./seed/seeds";

export default async function globalSetup(): Promise<void> {
  await writeSeedFiles();
}
