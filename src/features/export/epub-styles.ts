/**
 * Default CSS styles for EPUB content.
 * These styles ensure proper typography and formatting in e-readers.
 */
export const EPUB_STYLES = `
/* Base typography */
body {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.6;
  margin: 1em;
  text-align: justify;
}

/* Headings */
h1, h2, h3, h4, h5, h6 {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: bold;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  text-align: left;
}

h1 {
  font-size: 1.8em;
  text-align: center;
  margin-top: 2em;
}

h2 {
  font-size: 1.4em;
}

h3 {
  font-size: 1.2em;
}

/* Paragraphs */
p {
  margin: 0;
  text-indent: 1.5em;
}

p:first-of-type,
h1 + p,
h2 + p,
h3 + p,
hr + p,
.scene-break + p {
  text-indent: 0;
}

/* Scene breaks */
hr.scene-break {
  border: none;
  text-align: center;
  margin: 2em 0;
}

hr.scene-break::before {
  content: "* * *";
  display: block;
  letter-spacing: 0.5em;
}

/* Footnotes / Endnotes */
.footnote-ref {
  font-size: 0.75em;
  vertical-align: super;
  text-decoration: none;
  color: inherit;
}

.endnotes {
  margin-top: 3em;
  border-top: 1px solid #ccc;
  padding-top: 1em;
}

.endnotes h2 {
  font-size: 1.2em;
  margin-bottom: 1em;
}

.endnote {
  font-size: 0.9em;
  margin-bottom: 0.5em;
  text-indent: 0;
}

.endnote-number {
  font-weight: bold;
  margin-right: 0.5em;
}

/* Links */
a {
  color: inherit;
  text-decoration: underline;
}

/* Lists */
ul, ol {
  margin: 1em 0;
  padding-left: 2em;
}

li {
  margin-bottom: 0.25em;
}

/* Blockquotes */
blockquote {
  margin: 1em 2em;
  font-style: italic;
}

/* Tables */
table {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}

th, td {
  border: 1px solid #ccc;
  padding: 0.5em;
  text-align: left;
}

th {
  background-color: #f5f5f5;
  font-weight: bold;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}

/* Cover image - no margins, fit to page */
img.cover-image,
.cover img {
  margin: 0;
  padding: 0;
  max-width: 100%;
  height: auto;
}

figure {
  margin: 1em 0;
  text-align: center;
}

figcaption {
  font-size: 0.9em;
  font-style: italic;
  margin-top: 0.5em;
}

/* Text formatting */
strong, b {
  font-weight: bold;
}

em, i {
  font-style: italic;
}

u {
  text-decoration: underline;
}

sub {
  font-size: 0.75em;
  vertical-align: sub;
}

sup {
  font-size: 0.75em;
  vertical-align: super;
}

/* Highlights - converted to simple emphasis for e-readers */
mark {
  background-color: #ffff00;
  padding: 0 0.1em;
}

/* Code */
code {
  font-family: "Courier New", Courier, monospace;
  font-size: 0.9em;
  background-color: #f5f5f5;
  padding: 0.1em 0.2em;
}

pre {
  font-family: "Courier New", Courier, monospace;
  font-size: 0.9em;
  background-color: #f5f5f5;
  padding: 1em;
  overflow-x: auto;
  white-space: pre-wrap;
}
`;
