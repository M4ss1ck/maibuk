/**
 * Converts plain text into simple editor HTML for "paste as-is": blank lines
 * become paragraph breaks and single newlines become hard breaks. Mirrors the
 * editor's default plain-text paste behaviour and is shared by every editor that
 * offers the Markdown paste prompt.
 */
export function plainTextToEditorHtml(text: string): string {
  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
