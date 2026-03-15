/**
 * Parse a SQL dump into individual statements, correctly handling semicolons
 * inside single-quoted and double-quoted strings.
 * Strips SQL line comments (--) that appear outside quoted strings.
 */
export function parseSqlStatements(sqlContent: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent[i];
    const next = sqlContent[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inSingleQuote) {
      current += char;
      if (char === "'") {
        if (next === "'") {
          current += char;
          i++;
          continue;
        }
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === '"') {
        if (next === '"') {
          current += char;
          i++;
          continue;
        }
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }

    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
    } else {
      current += char;
    }
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}
