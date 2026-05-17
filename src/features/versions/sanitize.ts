import DOMPurify from "dompurify";

const ALLOWED_DIFF_TAGS = ["ins", "del"];

export function sanitizeChapterHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ALLOWED_DIFF_TAGS,
    ADD_ATTR: ["class"],
  });
}
