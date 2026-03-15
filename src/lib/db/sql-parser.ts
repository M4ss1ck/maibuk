/**
 * Parse a SQL dump into individual statements, correctly handling semicolons
 * inside single-quoted and double-quoted strings (including escaped quotes).
 * Strips SQL comments (lines starting with --).
 */
export function parseSqlStatements(sqlContent: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent[i];

    if ((char === "'" || char === '"') && sqlContent[i - 1] !== "\\") {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar) {
        if (char === "'" && sqlContent[i + 1] === "'") {
          current += char;
          i++;
          current += sqlContent[i];
          continue;
        }
        inString = false;
        stringChar = "";
      }
    }

    if (char === ";" && !inString) {
      const trimmed = current.trim();
      const clean = trimmed
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      if (clean.length > 0) statements.push(clean);
      current = "";
    } else {
      current += char;
    }
  }

  const trimmed = current.trim();
  if (trimmed.length > 0 && !trimmed.startsWith("--")) {
    const clean = trimmed
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();
    if (clean.length > 0) statements.push(clean);
  }

  return statements;
}
