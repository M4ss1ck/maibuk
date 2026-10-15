/**
 * The shape both host-owned Plugin documents share (ADR 0019, ADR 0021): the
 * fixed sandbox bootstrap and the Frame's document are each an iframe whose
 * only sandbox token is `allow-scripts` (opaque origin, never
 * `allow-same-origin`) holding one CSP meta tag and one inline host script.
 * These helpers keep the iframe attributes and the document head in one place
 * so the bootstrap and the Frame cannot drift apart.
 */

/** Creates the iframe both documents live in: `allow-scripts` and nothing else. */
export function createSandboxElement(doc: Document): HTMLIFrameElement {
  const element = doc.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts");
  return element;
}

/** The one `srcdoc` shape: a CSP meta tag and a body, nothing else. */
export function hostDocument(csp: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
</head>
<body>
${body}
</body>
</html>
`;
}
