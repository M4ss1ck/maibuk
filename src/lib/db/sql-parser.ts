interface SqlScan {
  statements: string[];
  lineComments: string[];
}

/**
 * Walk a SQL dump once, splitting statements on semicolons outside quoted
 * strings and collecting the `--` line comments that sit outside them.
 */
function scanSql(sqlContent: string): SqlScan {
  const statements: string[] = [];
  const lineComments: string[] = [];
  let current = "";
  let comment = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < sqlContent.length; i++) {
    const char = sqlContent[i];
    const next = sqlContent[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        lineComments.push(comment.trim());
        comment = "";
      } else {
        comment += char;
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

  if (inLineComment) lineComments.push(comment.trim());
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return { statements, lineComments };
}

/**
 * Parse a SQL dump into individual statements, correctly handling semicolons
 * inside single-quoted and double-quoted strings.
 * Strips SQL line comments (--) that appear outside quoted strings.
 */
export function parseSqlStatements(sqlContent: string): string[] {
  return scanSql(sqlContent).statements;
}

/**
 * The text of every `--` line comment outside quoted strings, without the
 * leading dashes. Dump section headers are these comments, so a value that
 * merely contains "-- Canvases" is never mistaken for one.
 */
export function parseSqlLineComments(sqlContent: string): string[] {
  return scanSql(sqlContent).lineComments;
}
