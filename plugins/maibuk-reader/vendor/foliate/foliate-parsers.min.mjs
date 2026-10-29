const Ie = (n, t) => n.map((e, s, r) => t(e, s, r) ? s : null).filter((e) => e != null), te = (n, t) => [-1, ...t, n.length].reduce(({ xs: e, a: s }, r) => ({ xs: e?.concat([n.slice(s + 1, r)]) ?? [], a: r }), {}).xs, Le = (n, t) => n.slice(0, -1).concat([n[n.length - 1].concat(t[0])]).concat(t.slice(1)), xt = /\d/, yt = /^epubcfi\((.*)\)$/, zt = (n) => n.replace(/[\^[\](),;=]/g, "^$&"), ee = (n) => yt.test(n) ? n : `epubcfi(${n})`, Re = (n) => n.match(yt)?.[1] ?? n, Ce = (n) => (...t) => `epubcfi(${n(...t.map((e) => e.match(yt)?.[1] ?? e))})`, ke = Ce((...n) => n.join("!")), Me = (n) => {
  const t = [];
  let e, s, r = "";
  const i = (a) => (t.push(a), e = null, r = ""), o = (a) => (r += a, s = !1);
  for (const a of Array.from(n.trim()).concat("")) {
    if (a === "^" && !s) {
      s = !0;
      continue;
    }
    if (e === "!") i(["!"]);
    else if (e === ",") i([","]);
    else if (e === "/" || e === ":")
      if (xt.test(a)) {
        o(a);
        continue;
      } else i([e, parseInt(r)]);
    else if (e === "~")
      if (xt.test(a) || a === ".") {
        o(a);
        continue;
      } else i(["~", parseFloat(r)]);
    else if (e === "@") {
      if (a === ":") {
        i(["@", parseFloat(r)]), e = "@";
        continue;
      }
      if (xt.test(a) || a === ".") {
        o(a);
        continue;
      } else i(["@", parseFloat(r)]);
    } else if (e === "[") {
      a === ";" && !s ? (i(["[", r]), e = ";") : a === "," && !s ? (i(["[", r]), e = "[") : a === "]" && !s ? i(["[", r]) : o(a);
      continue;
    } else if (e?.startsWith(";")) {
      a === "=" && !s ? (e = `;${r}`, r = "") : a === ";" && !s ? (i([e, r]), e = ";") : a === "]" && !s ? i([e, r]) : o(a);
      continue;
    }
    (a === "/" || a === ":" || a === "~" || a === "@" || a === "[" || a === "!" || a === ",") && (e = a);
  }
  return t;
}, ne = (n, t) => Ie(n, ([e]) => e === t), Be = (n) => {
  const t = [];
  let e;
  for (const [s, r] of n) {
    if (s === "/") t.push({ index: r });
    else {
      const i = t[t.length - 1];
      if (s === ":") i.offset = r;
      else if (s === "~") i.temporal = r;
      else if (s === "@") i.spatial = (i.spatial ?? []).concat(r);
      else if (s === ";s") i.side = r;
      else if (s === "[")
        if (e === "/" && r) i.id = r;
        else {
          i.text = (i.text ?? []).concat(r);
          continue;
        }
    }
    e = s;
  }
  return t;
}, _t = (n) => te(n, ne(n, "!")).map(Be), W = (n) => {
  const t = Me(Re(n)), e = ne(t, ",");
  if (!e.length) return _t(t);
  const [s, r, i] = te(t, e).map(_t);
  return { parent: s, start: r, end: i };
}, Oe = ({ index: n, id: t, offset: e, temporal: s, spatial: r, text: i, side: o }) => {
  const a = o ? `;s=${o}` : "";
  return `/${n}` + (t ? `[${zt(t)}${a}]` : "") + (e != null && n % 2 ? `:${e}` : "") + (s ? `~${s}` : "") + (r ? `@${r.join(":")}` : "") + (i || !t && o ? "[" + (i?.map(zt)?.join(",") ?? "") + a + "]" : "");
}, se = (n) => n.parent ? [n.parent, n.start, n.end].map(se).join(",") : n.map((t) => t.map(Oe).join("")).join("!"), rt = (n) => ee(se(n)), j = (n, t) => typeof n == "string" ? rt(j(W(n), t)) : n.parent ? Le(n.parent, n[t ? "end" : "start"]) : n, re = (n, t) => {
  typeof n == "string" && (n = W(n)), typeof t == "string" && (t = W(t)), n = j(n), t = j(t, !0);
  const e = n[n.length - 1], s = t[t.length - 1], r = [], i = [], o = [];
  let a = !0;
  const u = Math.max(e.length, s.length);
  for (let l = 0; l < u; l++) {
    const c = e[l], f = s[l];
    a &&= c?.index === f?.index && !c?.offset && !f?.offset, a ? r.push(c) : (c && i.push(c), f && o.push(f));
  }
  const h = n.slice(0, -1).concat([r]);
  return rt({ parent: h, start: [i], end: [o] });
}, Tt = (n, t) => {
  if (typeof n == "string" && (n = W(n)), typeof t == "string" && (t = W(t)), n.start || t.start) return Tt(j(n), j(t)) || Tt(j(n, !0), j(t, !0));
  for (let e = 0; e < Math.max(n.length, t.length); e++) {
    const s = n[e] ?? [], r = t[e] ?? [], i = Math.max(s.length, r.length) - 1;
    for (let o = 0; o <= i; o++) {
      const a = s[o], u = r[o];
      if (!a) return -1;
      if (!u || a.index > u.index) return 1;
      if (a.index < u.index) return -1;
      if (o === i) {
        if (a.offset > u.offset) return 1;
        if (a.offset < u.offset) return -1;
      }
    }
  }
  return 0;
}, It = ({ nodeType: n }) => n === 3 || n === 4, ht = ({ nodeType: n }) => n === 1, ie = (n, t) => {
  const e = Array.from(n.childNodes).filter((s) => It(s) || ht(s));
  return t ? e.map((s) => {
    const r = t(s);
    return r === NodeFilter.FILTER_REJECT ? null : r === NodeFilter.FILTER_SKIP ? ie(s, t) : s;
  }).flat().filter((s) => s) : e;
}, $t = (n, t) => {
  const e = ie(n, t).reduce((s, r) => {
    let i = s[s.length - 1];
    return i ? It(r) ? Array.isArray(i) ? i.push(r) : It(i) ? s[s.length - 1] = [i, r] : s.push(r) : ht(i) ? s.push(null, r) : s.push(r) : s.push(r), s;
  }, []);
  return ht(e[0]) && e.unshift("first"), ht(e[e.length - 1]) && e.push("last"), e.unshift("before"), e.push("after"), e;
}, Lt = (n, t, e) => {
  const { id: s } = t[t.length - 1];
  if (s) {
    const o = n.ownerDocument.getElementById(s);
    if (o) return { node: o, offset: 0 };
  }
  for (const { index: o } of t) {
    const a = n ? $t(n, e)[o] : null;
    if (a === "first") return { node: n.firstChild ?? n };
    if (a === "last") return { node: n.lastChild ?? n };
    if (a === "before") return { node: n, before: !0 };
    if (a === "after") return { node: n, after: !0 };
    n = a;
  }
  const { offset: r } = t[t.length - 1];
  if (!Array.isArray(n)) return { node: n, offset: r };
  let i = 0;
  for (const o of n) {
    const { length: a } = o.nodeValue;
    if (i + a >= r) return { node: o, offset: r - i };
    i += a;
  }
}, pt = (n, t, e) => {
  let { id: s, parentNode: r } = n;
  for (; e && r && r !== n.ownerDocument.documentElement && e(r) === NodeFilter.FILTER_SKIP; )
    r = r.parentNode;
  const i = $t(r, e), o = i.findIndex((h) => Array.isArray(h) ? h.some((l) => l === n) : h === n), a = i[o];
  if (Array.isArray(a)) {
    let h = 0;
    for (const l of a)
      if (l === n) {
        h += t;
        break;
      } else h += l.nodeValue.length;
    t = h;
  }
  const u = { id: s, index: o, offset: t };
  return (r !== n.ownerDocument.documentElement ? pt(r, null, e).concat(u) : [u]).filter((h) => h.index !== -1);
}, $e = (n, t) => {
  const { startContainer: e, startOffset: s, endContainer: r, endOffset: i } = n, o = pt(e, s, t);
  if (n.collapsed) return rt([o]);
  const a = pt(r, i, t);
  return re([o], [a]);
}, oe = (n, t, e) => {
  const s = j(t), r = j(t, !0), i = n.documentElement, o = Lt(i, s[0], e), a = Lt(i, r[0], e), u = n.createRange();
  return o.before ? u.setStartBefore(o.node) : o.after ? u.setStartAfter(o.node) : u.setStart(o.node, o.offset), a.before ? u.setEndBefore(a.node) : a.after ? u.setEndAfter(a.node) : u.setEnd(a.node, a.offset), u;
}, ae = (n) => {
  const t = [], { parentNode: e } = n[0], s = pt(e);
  for (const [r, i] of $t(e).entries()) {
    const o = n[t.length];
    i === o && t.push(rt([s.concat({ id: o.id, index: r })]));
  }
  return t;
}, Rt = (n, t) => Lt(n.documentElement, j(t)).node, ce = {
  fromIndex: (n) => ee(`/6/${(n + 1) * 2}`),
  toIndex: (n) => n?.at(-1).index / 2 - 1
}, Ne = (n) => {
  const [t] = W(n), e = t.shift();
  return t.shift(), rt([[{ index: 6 }, e], t]);
}, Ue = ({ spine_index: n, start_cfi: t, end_cfi: e }) => {
  const s = ce.fromIndex(n) + "!";
  return re(s + t.slice(2), s + e.slice(2));
}, os = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  collapse: j,
  compare: Tt,
  fake: ce,
  fromCalibreHighlight: Ue,
  fromCalibrePos: Ne,
  fromElements: ae,
  fromRange: $e,
  isCFI: yt,
  joinIndir: ke,
  parse: W,
  toElement: Rt,
  toRange: oe
}, Symbol.toStringTag, { value: "Module" })), I = {
  CONTAINER: "urn:oasis:names:tc:opendocument:xmlns:container",
  XHTML: "http://www.w3.org/1999/xhtml",
  OPF: "http://www.idpf.org/2007/opf",
  EPUB: "http://www.idpf.org/2007/ops",
  DC: "http://purl.org/dc/elements/1.1/",
  ENC: "http://www.w3.org/2001/04/xmlenc#",
  NCX: "http://www.daisy.org/z3986/2005/ncx/",
  XLINK: "http://www.w3.org/1999/xlink",
  SMIL: "http://www.w3.org/ns/SMIL"
}, R = {
  XML: "application/xml",
  NCX: "application/x-dtbncx+xml",
  XHTML: "application/xhtml+xml",
  HTML: "text/html",
  CSS: "text/css",
  SVG: "image/svg+xml",
  JS: /\/(x-)?(javascript|ecmascript)/
}, K = {
  a11y: "http://www.idpf.org/epub/vocab/package/a11y/#",
  dcterms: "http://purl.org/dc/terms/",
  marc: "http://id.loc.gov/vocabulary/",
  media: "http://www.idpf.org/epub/vocab/overlays/#",
  onix: "http://www.editeur.org/ONIX/book/codelists/current.html#",
  rendition: "http://www.idpf.org/vocab/rendition/#",
  schema: "http://schema.org/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  msv: "http://www.idpf.org/epub/vocab/structure/magazine/#",
  prism: "http://www.prismstandard.org/specifications/3.0/PRISM_CV_Spec_3.0.htm#"
}, De = {
  art: "artist",
  aut: "author",
  clr: "colorist",
  edt: "editor",
  ill: "illustrator",
  nrt: "narrator",
  trl: "translator",
  pbl: "publisher"
}, Fe = {
  "02": "isbn",
  "06": "doi",
  15: "isbn",
  26: "doi",
  34: "issn"
}, Ct = (n) => n.toLowerCase().replace(/[-:](.)/g, (t, e) => e.toUpperCase()), He = (n) => n ? n.replace(/[\t\n\f\r ]+/g, " ").replace(/^[\t\n\f\r ]+/, "").replace(/[\t\n\f\r ]+$/, "") : "", Pe = (n, t, e) => e ? (s) => s.getAttribute(n)?.split(/\s/)?.includes(t) : typeof t == "function" ? (s) => t(s.getAttribute(n)) : (s) => s.getAttribute(n) === t, ft = (...n) => (t) => t ? Object.fromEntries(n.map((e) => [Ct(e), t.getAttribute(e)])) : null, _ = (n) => He(n?.textContent), it = (n, t) => {
  const e = n.lookupNamespaceURI(null) === t || n.lookupPrefix(t), s = e ? (r, i) => (o) => o.namespaceURI === t && o.localName === i : (r, i) => (o) => o.localName === i;
  return {
    $: (r, i) => [...r.children].find(s(r, i)),
    $$: (r, i) => [...r.children].filter(s(r, i)),
    $$$: e ? (r, i) => [...r.getElementsByTagNameNS(t, i)] : (r, i) => [...r.getElementsByTagName(i)]
  };
}, J = (n, t) => {
  try {
    if (t.includes(":")) return new URL(n, t);
    const e = "https://invalid.invalid/", s = new URL(n, e + t);
    return s.search = "", decodeURI(s.href.replace(e, ""));
  } catch (e) {
    return console.warn(e), n;
  }
}, le = (n) => /^(?!blob)\w+:/i.test(n), Xe = (n, t) => {
  if (!n) return t;
  const e = n.replace(/\/$/, "").split("/"), s = t.replace(/\/$/, "").split("/"), r = (e.length > s.length ? e : s).findIndex((i, o) => e[o] !== s[o]);
  return r < 0 ? "" : Array(e.length - r).fill("..").concat(s.slice(r)).join("/");
}, je = (n) => n.slice(0, n.lastIndexOf("/") + 1), nt = async (n, t, e) => {
  const s = [];
  n.replace(t, (...i) => (s.push(i), null));
  const r = [];
  for (const i of s) r.push(await e(...i));
  return n.replace(t, () => r.shift());
}, ze = (n) => n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), kt = (n) => {
  for (const [e, s] of Object.entries(n))
    s == null ? delete n[e] : Array.isArray(s) ? (n[e] = s.filter((r) => r).map((r) => typeof r == "object" && !Array.isArray(r) ? kt(r) : r), n[e].length ? n[e].length === 1 && (n[e] = n[e][0]) : delete n[e]) : typeof s == "object" && (n[e] = kt(s), Object.keys(s).length || delete n[e]);
  const t = Object.keys(n);
  return t.length === 1 && t[0] === "name" ? n[t[0]] : n;
}, _e = (n) => {
  const t = new Map(Object.entries(K)), e = n.documentElement.getAttributeNS(I.EPUB, "prefix") || n.documentElement.getAttribute("prefix");
  if (e) for (const [, s, r] of e.matchAll(/(.+): +(.+)[ \t\r\n]*/g)) t.set(s, r);
  return t;
}, qt = (n, t) => {
  if (!n) return null;
  const [e, s] = n.split(":"), r = s ? e : null, i = s || e, o = t.get(r);
  return o ? o + i : null;
}, qe = (n) => {
  const { $: t } = it(n, I.OPF), e = t(n.documentElement, "metadata"), s = Object.groupBy(e.children, (m) => m.namespaceURI === I.DC ? "dc" : m.namespaceURI === I.OPF && m.localName === "meta" ? m.hasAttribute("name") ? "legacyMeta" : "meta" : ""), r = e.getAttribute("xml:lang") ?? n.documentElement.getAttribute("xml:lang") ?? "und", i = _e(n), o = (m) => {
    const w = m.getAttribute("property"), A = m.getAttribute("scheme");
    return {
      property: qt(w, i) ?? w,
      scheme: qt(A, i) ?? A,
      lang: m.getAttribute("xml:lang"),
      value: _(m),
      props: u(m),
      // `opf:` attributes from EPUB 2 & EPUB 3.1 (removed in EPUB 3.2)
      attrs: Object.fromEntries(Array.from(m.attributes).filter((x) => x.namespaceURI === I.OPF).map((x) => [x.localName, x.value]))
    };
  }, a = Map.groupBy(s.meta ?? [], (m) => m.getAttribute("refines")), u = (m) => {
    const w = a.get(m ? "#" + m.getAttribute("id") : null);
    return w ? Object.groupBy(w.map(o), (A) => A.property) : null;
  }, h = Object.fromEntries(Object.entries(Object.groupBy(s.dc, (m) => m.localName)).map(([m, w]) => [m, w.map(o)])), l = u() ?? {}, c = Object.fromEntries(s.legacyMeta?.map((m) => [m.getAttribute("name"), m.getAttribute("content")]) ?? []), f = (m) => m?.[0]?.value, d = (m, w) => f(m?.props?.[w]), p = (m) => {
    if (!m) return null;
    const w = m.props?.["alternate-script"] ?? [], A = m.attrs["alt-rep"];
    if (!w.length && (!m.lang || m.lang === r) && !A) return m.value;
    const x = { [m.lang ?? r]: m.value };
    A && (x[m.attrs["alt-rep-lang"]] = A);
    for (const M of w) x[M.lang] ??= M.value;
    return x;
  }, g = (m) => m ? {
    name: p(m),
    sortAs: p(m.props?.["file-as"]?.[0]) ?? m.attrs["file-as"],
    role: m.props?.role?.filter((w) => w.scheme === K.marc + "relators")?.map((w) => w.value) ?? [m.attrs.role],
    code: d(m, "term") ?? m.attrs.term,
    scheme: d(m, "authority") ?? m.attrs.authority
  } : null, y = (m) => ({
    name: p(m),
    // NOTE: webpub requires number but EPUB allows values like "2.2.1"
    position: f(m.props?.["group-position"])
  }), b = (m) => {
    const { value: w } = m;
    if (/^urn:/i.test(w)) return w;
    if (/^doi:/i.test(w)) return `urn:${w}`;
    const A = m.props?.["identifier-type"];
    if (!A) {
      const x = m.attrs.scheme;
      return x ? /^(doi|isbn|uuid)$/i.test(x) ? `urn:${x}:${w}` : { scheme: x, value: w } : w;
    }
    if (A.scheme === K.onix + "codelist5") {
      const x = Fe[A.value];
      if (x) return `urn:${x}:${w}`;
    }
    return w;
  }, v = Object.groupBy(
    l["belongs-to-collection"] ?? [],
    (m) => d(m, "collection-type") === "series" ? "series" : "collection"
  ), S = h.title?.find((m) => d(m, "title-type") === "main") ?? h.title?.[0], E = {
    identifier: ue(n),
    title: p(S),
    sortAs: p(S?.props?.["file-as"]?.[0]) ?? S?.attrs?.["file-as"] ?? c?.["calibre:title_sort"],
    subtitle: h.title?.find((m) => d(m, "title-type") === "subtitle")?.value,
    language: h.language?.map((m) => m.value),
    description: f(h.description),
    publisher: h.publisher?.map(g),
    published: h.date?.find((m) => m.attrs.event === "publication")?.value ?? f(h.date),
    modified: f(l[K.dcterms + "modified"]) ?? h.date?.find((m) => m.attrs.event === "modification")?.value,
    subject: h.subject?.map(g),
    belongsTo: {
      collection: v.collection?.map(y),
      series: v.series?.map(y) ?? c?.["calibre:series"] ? {
        name: c?.["calibre:series"],
        position: parseFloat(c?.["calibre:series_index"])
      } : null
    },
    altIdentifier: h.identifier?.map(b),
    source: h.source?.map(b),
    // NOTE: not in webpub schema
    rights: f(h.rights),
    // NOTE: not in webpub schema
    pageBreakSource: f(l.pageBreakSource)
    // NOTE: not in webpub schema
  }, L = (m) => (w) => {
    const A = new Set(w.role?.map((x) => De[x] ?? m));
    return [A.size ? A : [m], w];
  };
  for (const [m, w] of [].concat(
    h.creator?.map(g)?.map(L("author")) ?? [],
    h.contributor?.map(g)?.map(L("contributor")) ?? []
  ))
    for (const A of m)
      E[A] ? E[A].push(w) : E[A] = [w];
  kt(E), E.altIdentifier === E.identifier && delete E.altIdentifier;
  const U = {}, D = {};
  for (const [m, w] of Object.entries(l))
    m.startsWith(K.rendition) ? U[Ct(m.replace(K.rendition, ""))] = f(w) : m.startsWith(K.media) && (D[Ct(m.replace(K.media, ""))] = f(w));
  return D.duration && (D.duration = Mt(D.duration)), { metadata: E, rendition: U, media: D };
}, Ge = (n, t = (e) => e) => {
  const { $: e, $$: s, $$$: r } = it(n, I.XHTML), i = (p) => p ? decodeURI(t(p)) : null, o = (p) => (g) => {
    const y = e(g, "a") ?? e(g, "span"), b = e(g, "ol"), v = i(y?.getAttribute("href")), E = { label: _(y) || y?.getAttribute("title"), href: v, subitems: a(b) };
    return p && (E.type = y?.getAttributeNS(I.EPUB, "type")?.split(/\s/)), E;
  }, a = (p, g) => p ? s(p, "li").map(o(g)) : null, u = (p, g) => a(e(p, "ol"), g), h = r(n, "nav");
  let l = null, c = null, f = null, d = [];
  for (const p of h) {
    const g = p.getAttributeNS(I.EPUB, "type")?.split(/\s/) ?? [];
    g.includes("toc") ? l ??= u(p) : g.includes("page-list") ? c ??= u(p) : g.includes("landmarks") ? f ??= u(p, !0) : d.push({
      label: _(p.firstElementChild),
      type: g,
      list: u(p)
    });
  }
  return { toc: l, pageList: c, landmarks: f, others: d };
}, Ve = (n, t = (e) => e) => {
  const { $: e, $$: s } = it(n, I.NCX), r = (u) => u ? decodeURI(t(u)) : null, i = (u) => {
    const h = e(u, "navLabel"), l = e(u, "content"), c = _(h), f = r(l.getAttribute("src"));
    if (u.localName === "navPoint") {
      const d = s(u, "navPoint");
      return { label: c, href: f, subitems: d.length ? d.map(i) : null };
    }
    return { label: c, href: f };
  }, o = (u, h) => s(u, h).map(i), a = (u, h) => {
    const l = e(n.documentElement, u);
    return l ? o(l, h) : null;
  };
  return {
    toc: a("navMap", "navPoint"),
    pageList: a("pageList", "pageTarget"),
    others: s(n.documentElement, "navList").map((u) => ({
      label: _(e(u, "navLabel")),
      list: o(u, "navTarget")
    }))
  };
}, Mt = (n) => {
  if (!n) return;
  const t = n.split(":").map((o) => parseFloat(o));
  if (t.length === 3) {
    const [o, a, u] = t;
    return o * 60 * 60 + a * 60 + u;
  }
  if (t.length === 2) {
    const [o, a] = t;
    return o * 60 + a;
  }
  const [e, s] = n.split(/(?=[^\d.])/);
  return parseFloat(e) * (s === "h" ? 3600 : s === "min" ? 60 : s === "ms" ? 1e-3 : 1);
};
class Ke extends EventTarget {
  #t;
  #n;
  #e;
  #r;
  #i;
  #s;
  #o = 1;
  #a = 1;
  #h;
  constructor(t, e) {
    super(), this.book = t, this.loadXML = e;
  }
  async #d(t) {
    if (this.#n === t) return;
    const e = await this.loadXML(t.href), s = (o) => o ? J(o, t.href) : null, { $: r, $$$: i } = it(e, I.SMIL);
    this.#r = -1, this.#i = -1, this.#t = i(e, "par").reduce((o, a) => {
      const u = s(r(a, "text")?.getAttribute("src")), h = r(a, "audio");
      if (!u || !h) return o;
      const l = s(h.getAttribute("src")), c = Mt(h.getAttribute("clipBegin")), f = Mt(h.getAttribute("clipEnd")), d = o.at(-1);
      return d?.src === l ? d.items.push({ text: u, begin: c, end: f }) : o.push({ src: l, items: [{ text: u, begin: c, end: f }] }), o;
    }, []), this.#n = t;
  }
  get #c() {
    return this.#t[this.#r];
  }
  get #l() {
    return this.#c?.items?.[this.#i];
  }
  #u(t) {
    console.error(t), this.dispatchEvent(new CustomEvent("error", { detail: t }));
  }
  #p() {
    this.dispatchEvent(new CustomEvent("highlight", { detail: this.#l }));
  }
  #g() {
    this.dispatchEvent(new CustomEvent("unhighlight", { detail: this.#l }));
  }
  async #f(t, e) {
    this.#m(), this.#r = t, this.#i = e;
    const s = this.#c?.src;
    if (!s || !this.#l) return this.start(this.#e + 1);
    const r = URL.createObjectURL(await this.book.loadBlob(s)), i = new Audio(r);
    this.#s = i, i.volume = this.#o, i.playbackRate = this.#a, i.addEventListener("timeupdate", () => {
      if (i.paused) return;
      const o = i.currentTime, { items: a } = this.#c;
      if (o > this.#l?.end && (this.#g(), this.#i === a.length - 1)) {
        this.#f(this.#r + 1, 0).catch((h) => this.#u(h));
        return;
      }
      const u = this.#i;
      for (; a[this.#i + 1]?.begin <= o; ) this.#i++;
      this.#i !== u && this.#p();
    }), i.addEventListener("error", () => this.#u(new Error(`Failed to load ${s}`))), i.addEventListener("playing", () => this.#p()), i.addEventListener("ended", () => {
      this.#g(), URL.revokeObjectURL(r), this.#s = null, this.#f(t + 1, 0).catch((o) => this.#u(o));
    }), this.#h === "paused" ? (this.#p(), i.currentTime = this.#l.begin ?? 0) : i.addEventListener("canplaythrough", () => {
      i.currentTime = this.#l.begin ?? 0, this.#h = "playing", i.play().catch((o) => this.#u(o));
    }, { once: !0 });
  }
  async start(t, e = () => !0) {
    this.#s?.pause();
    const s = this.book.sections[t], r = s?.id;
    if (!r) return;
    const { mediaOverlay: i } = s;
    if (!i) return this.start(t + 1);
    this.#e = t, await this.#d(i);
    for (let o = 0; o < this.#t.length; o++) {
      const { items: a } = this.#t[o];
      for (let u = 0; u < a.length; u++)
        if (a[u].text.split("#")[0] === r && e(a[u], u, a))
          return this.#f(o, u).catch((h) => this.#u(h));
    }
  }
  pause() {
    this.#h = "paused", this.#s?.pause();
  }
  resume() {
    this.#h = "playing", this.#s?.play().catch((t) => this.#u(t));
  }
  #m() {
    this.#s && (this.#s.pause(), URL.revokeObjectURL(this.#s.src), this.#s = null, this.#g());
  }
  stop() {
    this.#h = "stopped", this.#m();
  }
  prev() {
    this.#i > 0 ? this.#f(this.#r, this.#i - 1) : this.#r > 0 ? this.#f(
      this.#r - 1,
      this.#t[this.#r - 1].items.length - 1
    ) : this.#e > 0 && this.start(this.#e - 1, (t, e, s) => e === s.length - 1);
  }
  next() {
    this.#f(this.#r, this.#i + 1);
  }
  setVolume(t) {
    this.#o = t, this.#s && (this.#s.volume = t);
  }
  setRate(t) {
    this.#a = t, this.#s && (this.#s.playbackRate = t);
  }
}
const We = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/, Ye = (n) => {
  for (const t of n.getElementsByTagNameNS(I.DC, "identifier")) {
    const [e] = _(t).split(":").slice(-1);
    if (We.test(e)) return e;
  }
  return "";
}, ue = (n) => _(
  n.getElementById(n.documentElement.getAttribute("unique-identifier")) ?? n.getElementsByTagNameNS(I.DC, "identifier")[0]
), Gt = async (n, t, e) => {
  const s = new Uint8Array(await e.slice(0, t).arrayBuffer());
  t = Math.min(t, s.length);
  for (var r = 0; r < t; r++) s[r] = s[r] ^ n[r % n.length];
  return new Blob([s, e.slice(t)], { type: e.type });
}, Ze = async (n) => {
  const t = new TextEncoder().encode(n), e = await globalThis.crypto.subtle.digest("SHA-1", t);
  return new Uint8Array(e);
}, Je = (n = Ze) => ({
  "http://www.idpf.org/2008/embedding": {
    key: (t) => n(ue(t).replaceAll(/[\u0020\u0009\u000d\u000a]/g, "")),
    decode: (t, e) => Gt(t, 1040, e)
  },
  "http://ns.adobe.com/pdf/enc#RC": {
    key: (t) => {
      const e = Ye(t).replaceAll("-", "");
      return Uint8Array.from({ length: 16 }, (s, r) => parseInt(e.slice(r * 2, r * 2 + 2), 16));
    },
    decode: (t, e) => Gt(t, 1024, e)
  }
});
class Qe {
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e;
  constructor(t) {
    this.#e = t;
  }
  async init(t, e) {
    if (!t) return;
    const s = Array.from(
      t.getElementsByTagNameNS(I.ENC, "EncryptedData"),
      (r) => ({
        algorithm: r.getElementsByTagNameNS(I.ENC, "EncryptionMethod")[0]?.getAttribute("Algorithm"),
        uri: r.getElementsByTagNameNS(I.ENC, "CipherReference")[0]?.getAttribute("URI")
      })
    );
    for (const { algorithm: r, uri: i } of s) {
      if (!this.#n.has(r)) {
        const o = this.#e[r];
        if (!o) {
          console.warn("Unknown encryption algorithm");
          continue;
        }
        const a = await o.key(e);
        this.#n.set(r, (u) => o.decode(a, u));
      }
      this.#t.set(i, r);
    }
  }
  getDecoder(t) {
    return this.#n.get(this.#t.get(t)) ?? ((e) => e);
  }
}
class tn {
  constructor({ opf: t, resolveHref: e }) {
    this.opf = t;
    const { $: s, $$: r, $$$: i } = it(t, I.OPF), o = s(t.documentElement, "manifest"), a = s(t.documentElement, "spine"), u = r(a, "itemref");
    this.manifest = r(o, "item").map(ft("href", "id", "media-type", "properties", "media-overlay")).map((l) => (l.href = e(l.href), l.properties = l.properties?.split(/\s/), l)), this.manifestById = new Map(this.manifest.map((l) => [l.id, l])), this.spine = u.map(ft("idref", "id", "linear", "properties")).map((l) => (l.properties = l.properties?.split(/\s/), l)), this.pageProgressionDirection = a.getAttribute("page-progression-direction"), this.navPath = this.getItemByProperty("nav")?.href, this.ncxPath = (this.getItemByID(a.getAttribute("toc")) ?? this.manifest.find((l) => l.mediaType === R.NCX))?.href;
    const h = s(t.documentElement, "guide");
    h && (this.guide = r(h, "reference").map(ft("type", "title", "href")).map(({ type: l, title: c, href: f }) => ({
      label: c,
      type: l.split(/\s/),
      href: e(f)
    }))), this.cover = this.getItemByProperty("cover-image") ?? this.getItemByID(i(t, "meta").find(Pe("name", "cover"))?.getAttribute("content")) ?? this.getItemByHref(this.guide?.find((l) => l.type.includes("cover"))?.href), this.cfis = ae(u);
  }
  getItemByID(t) {
    return this.manifestById.get(t);
  }
  getItemByHref(t) {
    return this.manifest.find((e) => e.href === t);
  }
  getItemByProperty(t) {
    return this.manifest.find((e) => e.properties?.includes(t));
  }
  resolveCFI(t) {
    const e = W(t), s = (e.parent ?? e).shift();
    let r = Rt(this.opf, s);
    r && r.nodeName !== "idref" && (s.at(-1).id = null, r = Rt(this.opf, s));
    const i = r?.getAttribute("idref");
    return { index: this.spine.findIndex((u) => u.idref === i), anchor: (u) => oe(u, e) };
  }
}
class en {
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e = /* @__PURE__ */ new Map();
  eventTarget = new EventTarget();
  constructor({ loadText: t, loadBlob: e, resources: s }) {
    this.loadText = t, this.loadBlob = e, this.manifest = s.manifest, this.assets = s.manifest;
  }
  async createURL(t, e, s, r) {
    if (!e) return "";
    const i = { data: e, type: s };
    Object.defineProperty(i, "name", { value: t });
    const o = new CustomEvent("data", { detail: i });
    this.eventTarget.dispatchEvent(o);
    const a = await o.detail.data, u = await o.detail.type, h = URL.createObjectURL(new Blob([a], { type: u }));
    if (this.#t.set(t, h), this.#e.set(t, 1), r) {
      const l = this.#n.get(r);
      l ? l.push(t) : this.#n.set(r, [t]);
    }
    return h;
  }
  ref(t, e) {
    const s = this.#n.get(e);
    return s?.includes(t) || (this.#e.set(t, this.#e.get(t) + 1), s ? s.push(t) : this.#n.set(e, [t])), this.#t.get(t);
  }
  unref(t) {
    if (!this.#e.has(t)) return;
    const e = this.#e.get(t) - 1;
    if (e < 1) {
      URL.revokeObjectURL(this.#t.get(t)), this.#t.delete(t), this.#e.delete(t);
      const s = this.#n.get(t);
      if (s) for (; s.length; ) this.unref(s.pop());
      this.#n.delete(t);
    } else this.#e.set(t, e);
  }
  // load manifest item, recursively loading all resources as needed
  async loadItem(t, e = []) {
    if (!t) return null;
    const { href: s, mediaType: r } = t, i = R.JS.test(t.mediaType), o = { type: r, isScript: i, allow: !0 }, a = new CustomEvent("load", { detail: o });
    if (this.eventTarget.dispatchEvent(a), !await a.detail.allow) return null;
    const h = e.at(-1);
    if (this.#t.has(s)) return this.ref(s, h);
    if ((i || [R.XHTML, R.HTML, R.CSS, R.SVG].includes(r)) && e.every((f) => f !== s)) return this.loadReplaced(t, e);
    const c = Promise.resolve().then(() => this.loadBlob(s));
    return this.createURL(s, c, r, h);
  }
  async loadHref(t, e, s = []) {
    if (le(t)) return t;
    const r = J(t, e), i = this.manifest.find((o) => o.href === r);
    return i ? this.loadItem(i, s.concat(e)) : t;
  }
  async loadReplaced(t, e = []) {
    const { href: s, mediaType: r } = t, i = e.at(-1);
    let o = "";
    try {
      o = await this.loadText(s);
    } catch (u) {
      return this.createURL(s, Promise.reject(u), r, i);
    }
    if (!o) return null;
    if ([R.XHTML, R.HTML, R.SVG].includes(r)) {
      let u = new DOMParser().parseFromString(o, r);
      if (r === R.XHTML && (u.querySelector("parsererror") || !u.documentElement?.namespaceURI) && (console.warn(u.querySelector("parsererror")?.innerText ?? "Invalid XHTML"), t.mediaType = R.HTML, u = new DOMParser().parseFromString(o, t.mediaType)), [R.XHTML, R.SVG].includes(t.mediaType)) {
        let c = u.firstChild;
        for (; c instanceof ProcessingInstruction; ) {
          if (c.data) {
            const f = await nt(
              c.data,
              /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i,
              (d, p, g, y) => this.loadHref(g, s, e).then((b) => `${p}${b}${y}`)
            );
            c.replaceWith(u.createProcessingInstruction(
              c.target,
              f
            ));
          }
          c = c.nextSibling;
        }
      }
      const h = async (c, f) => c.setAttribute(
        f,
        await this.loadHref(c.getAttribute(f), s, e)
      );
      for (const c of u.querySelectorAll("link[href]")) await h(c, "href");
      for (const c of u.querySelectorAll("[src]")) await h(c, "src");
      for (const c of u.querySelectorAll("[poster]")) await h(c, "poster");
      for (const c of u.querySelectorAll("object[data]")) await h(c, "data");
      for (const c of u.querySelectorAll("[*|href]:not([href])"))
        c.setAttributeNS(I.XLINK, "href", await this.loadHref(
          c.getAttributeNS(I.XLINK, "href"),
          s,
          e
        ));
      for (const c of u.querySelectorAll("[srcset]"))
        c.setAttribute("srcset", await nt(
          c.getAttribute("srcset"),
          /(\s*)(.+?)\s*((?:\s[\d.]+[wx])+\s*(?:,|$)|,\s+|$)/g,
          (f, d, p, g) => this.loadHref(p, s, e).then((y) => `${d}${y}${g}`)
        ));
      for (const c of u.querySelectorAll("style"))
        c.textContent && (c.textContent = await this.replaceCSS(c.textContent, s, e));
      for (const c of u.querySelectorAll("[style]"))
        c.setAttribute(
          "style",
          await this.replaceCSS(c.getAttribute("style"), s, e)
        );
      const l = new XMLSerializer().serializeToString(u);
      return this.createURL(s, l, t.mediaType, i);
    }
    const a = r === R.CSS ? await this.replaceCSS(o, s, e) : await this.replaceString(o, s, e);
    return this.createURL(s, a, r, i);
  }
  async replaceCSS(t, e, s = []) {
    const r = await nt(
      t,
      /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi,
      (i, o) => this.loadHref(o, e, s).then((a) => `url("${a}")`)
    );
    return nt(
      r,
      /@import\s*["']([^"'\n]*?)["']/gi,
      (i, o) => this.loadHref(o, e, s).then((a) => `@import "${a}"`)
    );
  }
  // find & replace all possible relative paths for all assets without parsing
  replaceString(t, e, s = []) {
    const r = /* @__PURE__ */ new Map(), i = this.assets.map((a) => {
      if (a.href === e) return;
      const u = Xe(je(e), a.href), h = encodeURI(u), l = "/" + a.href, c = encodeURI(l), f = /* @__PURE__ */ new Set([u, h, l, c]);
      for (const d of f) r.set(d, a);
      return Array.from(f);
    }).flat().filter((a) => a);
    if (!i.length) return t;
    const o = new RegExp(i.map(ze).join("|"), "g");
    return nt(t, o, async (a) => this.loadItem(
      r.get(a.replace(/^\//, "")),
      s.concat(e)
    ));
  }
  unloadItem(t) {
    this.unref(t?.href);
  }
  destroy() {
    for (const t of this.#t.values()) URL.revokeObjectURL(t);
  }
}
const nn = (n, t) => n.getElementById(t) ?? n.querySelector(`[name="${CSS.escape(t)}"]`), sn = (n) => {
  for (const t of n) {
    if (t === "page-spread-left" || t === "rendition:page-spread-left")
      return "left";
    if (t === "page-spread-right" || t === "rendition:page-spread-right")
      return "right";
    if (t === "rendition:page-spread-center") return "center";
  }
}, rn = (n) => n ? {
  fixedLayout: _(n.querySelector('option[name="fixed-layout"]')),
  openToSpread: _(n.querySelector('option[name="open-to-spread"]'))
} : null;
class as {
  parser = new DOMParser();
  #t;
  #n;
  constructor({ loadText: t, loadBlob: e, getSize: s, sha1: r }) {
    this.loadText = t, this.loadBlob = e, this.getSize = s, this.#n = new Qe(Je(r));
  }
  async #e(t) {
    const e = await this.loadText(t);
    if (!e) return null;
    const s = this.parser.parseFromString(e, R.XML);
    if (s.querySelector("parsererror"))
      throw new Error(`XML parsing error: ${t}
${s.querySelector("parsererror").innerText}`);
    return s;
  }
  async init() {
    const t = await this.#e("META-INF/container.xml");
    if (!t) throw new Error("Failed to load container file");
    const e = Array.from(
      t.getElementsByTagNameNS(I.CONTAINER, "rootfile"),
      ft("full-path", "media-type")
    ).filter((f) => f.mediaType === "application/oebps-package+xml");
    if (!e.length) throw new Error("No package document defined in container");
    const s = e[0].fullPath, r = await this.#e(s);
    if (!r) throw new Error("Failed to load package document");
    const i = await this.#e("META-INF/encryption.xml");
    await this.#n.init(i, r), this.resources = new tn({
      opf: r,
      resolveHref: (f) => J(f, s)
    }), this.#t = new en({
      loadText: this.loadText,
      loadBlob: (f) => Promise.resolve(this.loadBlob(f)).then(this.#n.getDecoder(f)),
      resources: this.resources
    }), this.transformTarget = this.#t.eventTarget, this.sections = this.resources.spine.map((f, d) => {
      const { idref: p, linear: g, properties: y = [] } = f, b = this.resources.getItemByID(p);
      return b ? {
        id: b.href,
        load: () => this.#t.loadItem(b),
        unload: () => this.#t.unloadItem(b),
        createDocument: () => this.loadDocument(b),
        size: this.getSize(b.href),
        cfi: this.resources.cfis[d],
        linear: g,
        pageSpread: sn(y),
        resolveHref: (v) => J(v, b.href),
        mediaOverlay: b.mediaOverlay ? this.resources.getItemByID(b.mediaOverlay) : null
      } : (console.warn(`Could not find item with ID "${p}" in manifest`), null);
    }).filter((f) => f);
    const { navPath: o, ncxPath: a } = this.resources;
    if (o) try {
      const f = (p) => J(p, o), d = Ge(await this.#e(o), f);
      this.toc = d.toc, this.pageList = d.pageList, this.landmarks = d.landmarks;
    } catch (f) {
      console.warn(f);
    }
    if (!this.toc && a) try {
      const f = (p) => J(p, a), d = Ve(await this.#e(a), f);
      this.toc = d.toc, this.pageList = d.pageList;
    } catch (f) {
      console.warn(f);
    }
    this.landmarks ??= this.resources.guide;
    const { metadata: u, rendition: h, media: l } = qe(r);
    this.metadata = u, this.rendition = h, this.media = l, this.dir = this.resources.pageProgressionDirection;
    const c = rn(
      await this.#e("META-INF/com.apple.ibooks.display-options.xml") ?? await this.#e("META-INF/com.kobobooks.display-options.xml")
    );
    return c && (c.fixedLayout === "true" && (this.rendition.layout ??= "pre-paginated"), c.openToSpread === "false" && (this.sections.find((f) => f.linear !== "no").pageSpread ??= this.dir === "rtl" ? "left" : "right")), this;
  }
  async loadDocument(t) {
    const e = await this.loadText(t.href);
    return this.parser.parseFromString(e, t.mediaType);
  }
  getMediaOverlay() {
    return new Ke(this, this.#e.bind(this));
  }
  resolveCFI(t) {
    return this.resources.resolveCFI(t);
  }
  resolveHref(t) {
    const [e, s] = t.split("#"), r = this.resources.getItemByHref(decodeURI(e));
    return r ? { index: this.resources.spine.findIndex(({ idref: a }) => a === r.id), anchor: s ? (a) => nn(a, s) : () => 0 } : null;
  }
  splitTOCHref(t) {
    return t?.split("#") ?? [];
  }
  getTOCFragment(t, e) {
    return t.getElementById(e) ?? t.querySelector(`[name="${CSS.escape(e)}"]`);
  }
  isExternal(t) {
    return le(t);
  }
  async getCover() {
    const t = this.resources?.cover;
    return t?.href ? new Blob([await this.loadBlob(t.href)], { type: t.mediaType }) : null;
  }
  async getCalibreBookmarks() {
    const t = await this.loadText("META-INF/calibre_bookmarks.txt"), e = "encoding=json+base64:";
    if (t?.startsWith(e)) {
      const s = atob(t.slice(e.length));
      return JSON.parse(s);
    }
  }
  destroy() {
    this.#t?.destroy();
  }
}
const Y = (n) => {
  if (!n) return "";
  const t = document.createElement("textarea");
  return t.innerHTML = n, t.value;
}, z = {
  XML: "application/xml",
  XHTML: "application/xhtml+xml",
  HTML: "text/html",
  CSS: "text/css",
  SVG: "image/svg+xml"
}, on = {
  name: [0, 32, "string"],
  type: [60, 4, "string"],
  creator: [64, 4, "string"],
  numRecords: [76, 2, "uint"]
}, an = {
  compression: [0, 2, "uint"],
  numTextRecords: [8, 2, "uint"],
  recordSize: [10, 2, "uint"],
  encryption: [12, 2, "uint"]
}, cn = {
  magic: [16, 4, "string"],
  length: [20, 4, "uint"],
  type: [24, 4, "uint"],
  encoding: [28, 4, "uint"],
  uid: [32, 4, "uint"],
  version: [36, 4, "uint"],
  titleOffset: [84, 4, "uint"],
  titleLength: [88, 4, "uint"],
  localeRegion: [94, 1, "uint"],
  localeLanguage: [95, 1, "uint"],
  resourceStart: [108, 4, "uint"],
  huffcdic: [112, 4, "uint"],
  numHuffcdic: [116, 4, "uint"],
  exthFlag: [128, 4, "uint"],
  trailingFlags: [240, 4, "uint"],
  indx: [244, 4, "uint"]
}, ln = {
  resourceStart: [108, 4, "uint"],
  fdst: [192, 4, "uint"],
  numFdst: [196, 4, "uint"],
  frag: [248, 4, "uint"],
  skel: [252, 4, "uint"],
  guide: [260, 4, "uint"]
}, un = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  count: [8, 4, "uint"]
}, Vt = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  type: [8, 4, "uint"],
  idxt: [20, 4, "uint"],
  numRecords: [24, 4, "uint"],
  encoding: [28, 4, "uint"],
  language: [32, 4, "uint"],
  total: [36, 4, "uint"],
  ordt: [40, 4, "uint"],
  ligt: [44, 4, "uint"],
  numLigt: [48, 4, "uint"],
  numCncx: [52, 4, "uint"]
}, hn = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  numControlBytes: [8, 4, "uint"]
}, fn = {
  magic: [0, 4, "string"],
  offset1: [8, 4, "uint"],
  offset2: [12, 4, "uint"]
}, dn = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  numEntries: [8, 4, "uint"],
  codeLength: [12, 4, "uint"]
}, pn = {
  magic: [0, 4, "string"],
  numEntries: [8, 4, "uint"]
}, gn = {
  flags: [8, 4, "uint"],
  dataStart: [12, 4, "uint"],
  keyLength: [16, 4, "uint"],
  keyStart: [20, 4, "uint"]
}, mn = {
  1252: "windows-1252",
  65001: "utf-8"
}, Kt = {
  100: ["creator", "string", !0],
  101: ["publisher"],
  103: ["description"],
  104: ["isbn"],
  105: ["subject", "string", !0],
  106: ["date"],
  108: ["contributor", "string", !0],
  109: ["rights"],
  110: ["subjectCode", "string", !0],
  112: ["source", "string", !0],
  113: ["asin"],
  121: ["boundary", "uint"],
  122: ["fixedLayout"],
  125: ["numResources", "uint"],
  126: ["originalResolution"],
  127: ["zeroGutter"],
  128: ["zeroMargin"],
  129: ["coverURI"],
  132: ["regionMagnification"],
  201: ["coverOffset", "uint"],
  202: ["thumbnailOffset", "uint"],
  503: ["title"],
  524: ["language", "string", !0],
  527: ["pageProgressionDirection"]
}, yn = {
  1: [
    "ar",
    "ar-SA",
    "ar-IQ",
    "ar-EG",
    "ar-LY",
    "ar-DZ",
    "ar-MA",
    "ar-TN",
    "ar-OM",
    "ar-YE",
    "ar-SY",
    "ar-JO",
    "ar-LB",
    "ar-KW",
    "ar-AE",
    "ar-BH",
    "ar-QA"
  ],
  2: ["bg"],
  3: ["ca"],
  4: ["zh", "zh-TW", "zh-CN", "zh-HK", "zh-SG"],
  5: ["cs"],
  6: ["da"],
  7: ["de", "de-DE", "de-CH", "de-AT", "de-LU", "de-LI"],
  8: ["el"],
  9: [
    "en",
    "en-US",
    "en-GB",
    "en-AU",
    "en-CA",
    "en-NZ",
    "en-IE",
    "en-ZA",
    "en-JM",
    null,
    "en-BZ",
    "en-TT",
    "en-ZW",
    "en-PH"
  ],
  10: [
    "es",
    "es-ES",
    "es-MX",
    null,
    "es-GT",
    "es-CR",
    "es-PA",
    "es-DO",
    "es-VE",
    "es-CO",
    "es-PE",
    "es-AR",
    "es-EC",
    "es-CL",
    "es-UY",
    "es-PY",
    "es-BO",
    "es-SV",
    "es-HN",
    "es-NI",
    "es-PR"
  ],
  11: ["fi"],
  12: ["fr", "fr-FR", "fr-BE", "fr-CA", "fr-CH", "fr-LU", "fr-MC"],
  13: ["he"],
  14: ["hu"],
  15: ["is"],
  16: ["it", "it-IT", "it-CH"],
  17: ["ja"],
  18: ["ko"],
  19: ["nl", "nl-NL", "nl-BE"],
  20: ["no", "nb", "nn"],
  21: ["pl"],
  22: ["pt", "pt-BR", "pt-PT"],
  23: ["rm"],
  24: ["ro"],
  25: ["ru"],
  26: ["hr", null, "sr"],
  27: ["sk"],
  28: ["sq"],
  29: ["sv", "sv-SE", "sv-FI"],
  30: ["th"],
  31: ["tr"],
  32: ["ur"],
  33: ["id"],
  34: ["uk"],
  35: ["be"],
  36: ["sl"],
  37: ["et"],
  38: ["lv"],
  39: ["lt"],
  41: ["fa"],
  42: ["vi"],
  43: ["hy"],
  44: ["az"],
  45: ["eu"],
  46: ["hsb"],
  47: ["mk"],
  48: ["st"],
  49: ["ts"],
  50: ["tn"],
  52: ["xh"],
  53: ["zu"],
  54: ["af"],
  55: ["ka"],
  56: ["fo"],
  57: ["hi"],
  58: ["mt"],
  59: ["se"],
  62: ["ms"],
  63: ["kk"],
  65: ["sw"],
  67: ["uz", null, "uz-UZ"],
  68: ["tt"],
  69: ["bn"],
  70: ["pa"],
  71: ["gu"],
  72: ["or"],
  73: ["ta"],
  74: ["te"],
  75: ["kn"],
  76: ["ml"],
  77: ["as"],
  78: ["mr"],
  79: ["sa"],
  82: ["cy", "cy-GB"],
  83: ["gl", "gl-ES"],
  87: ["kok"],
  97: ["ne"],
  98: ["fy"]
}, Bt = (n, t) => {
  const e = new n.constructor(n.length + t.length);
  return e.set(n), e.set(t, n.length), e;
}, he = (n, t, e) => {
  const s = new n.constructor(n.length + t.length + e.length);
  return s.set(n), s.set(t, n.length), s.set(e, n.length + t.length), s;
}, bn = new TextDecoder(), ot = (n) => bn.decode(n), C = (n) => {
  if (!n) return;
  const t = n.byteLength, e = t === 4 ? "getUint32" : t === 2 ? "getUint16" : "getUint8";
  return new DataView(n)[e](0);
}, N = (n, t) => Object.fromEntries(Array.from(Object.entries(n)).map(([e, [s, r, i]]) => [
  e,
  (i === "string" ? ot : C)(t.slice(s, s + r))
])), Nt = (n) => new TextDecoder(mn[n]), ct = (n, t = 0) => {
  let e = 0, s = 0;
  for (const r of n.subarray(t, t + 4))
    if (e = e << 7 | (r & 127) >>> 0, s++, r & 128) break;
  return { value: e, length: s };
}, wn = (n) => {
  let t = 0;
  for (const e of n.subarray(-4))
    e & 128 && (t = 0), t = t << 7 | e & 127;
  return t;
}, fe = (n) => {
  let t = 0;
  for (; n > 0; n = n >> 1) (n & 1) === 1 && t++;
  return t;
}, vn = (n) => {
  let t = 0;
  for (; (n & 1) === 0; ) n = n >> 1, t++;
  return t;
}, xn = (n) => {
  let t = [];
  for (let e = 0; e < n.length; e++) {
    const s = n[e];
    if (s === 0) t.push(0);
    else if (s <= 8)
      for (const r of n.subarray(e + 1, (e += s) + 1))
        t.push(r);
    else if (s <= 127) t.push(s);
    else if (s <= 191) {
      const r = s << 8 | n[e++ + 1], i = (r & 16383) >>> 3, o = (r & 7) + 3;
      for (let a = 0; a < o; a++)
        t.push(t[t.length - i]);
    } else t.push(32, s ^ 128);
  }
  return Uint8Array.from(t);
}, Sn = (n, t) => {
  const e = t >> 3, s = t + 32, r = s >> 3;
  let i = 0n;
  for (let o = e; o <= r; o++)
    i = i << 8n | BigInt(n[o] ?? 0);
  return i >> 8n - BigInt(s & 7) & 0xffffffffn;
}, En = async (n, t) => {
  const e = await t(n.huffcdic), { magic: s, offset1: r, offset2: i } = N(fn, e);
  if (s !== "HUFF") throw new Error("Invalid HUFF record");
  const o = Array.from({ length: 256 }, (l, c) => r + c * 4).map((l) => C(e.slice(l, l + 4))).map((l) => [l & 128, l & 31, l >>> 8]), a = [null].concat(Array.from({ length: 32 }, (l, c) => i + c * 8).map((l) => [
    C(e.slice(l, l + 4)),
    C(e.slice(l + 4, l + 8))
  ])), u = [];
  for (let l = 1; l < n.numHuffcdic; l++) {
    const c = await t(n.huffcdic + l), f = N(dn, c);
    if (f.magic !== "CDIC") throw new Error("Invalid CDIC record");
    const d = Math.min(1 << f.codeLength, f.numEntries - u.length), p = c.slice(f.length);
    for (let g = 0; g < d; g++) {
      const y = C(p.slice(g * 2, g * 2 + 2)), b = C(p.slice(y, y + 2)), v = b & 32767, S = b & 32768, E = new Uint8Array(
        p.slice(y + 2, y + 2 + v)
      );
      u.push([E, S]);
    }
  }
  const h = (l) => {
    let c = new Uint8Array();
    const f = l.byteLength * 8;
    for (let d = 0; d < f; ) {
      const p = Number(Sn(l, d));
      let [g, y, b] = o[p >>> 24];
      if (!g) {
        for (; p >>> 32 - y < a[y][0]; )
          y += 1;
        b = a[y][1];
      }
      if ((d += y) > f) break;
      const v = b - (p >>> 32 - y);
      let [S, E] = u[v];
      E || (S = h(S), u[v] = [S, !0]), c = Bt(c, S);
    }
    return c;
  };
  return h;
}, dt = async (n, t) => {
  const e = await t(n), s = N(Vt, e);
  if (s.magic !== "INDX") throw new Error("Invalid INDX record");
  const r = Nt(s.encoding), i = e.slice(s.length), o = N(hn, i);
  if (o.magic !== "TAGX") throw new Error("Invalid TAGX section");
  const a = (o.length - 12) / 4, u = Array.from({ length: a }, (f, d) => new Uint8Array(i.slice(12 + d * 4, 12 + d * 4 + 4))), h = {};
  let l = 0;
  for (let f = 0; f < s.numCncx; f++) {
    const d = await t(n + s.numRecords + f + 1), p = new Uint8Array(d);
    for (let g = 0; g < p.byteLength; ) {
      const y = g, { value: b, length: v } = ct(p, g);
      g += v;
      const S = d.slice(g, g + b);
      g += b, h[l + y] = r.decode(S);
    }
    l += 65536;
  }
  const c = [];
  for (let f = 0; f < s.numRecords; f++) {
    const d = await t(n + 1 + f), p = new Uint8Array(d), g = N(Vt, d);
    if (g.magic !== "INDX") throw new Error("Invalid INDX record");
    for (let y = 0; y < g.numRecords; y++) {
      const b = g.idxt + 4 + 2 * y, v = C(d.slice(b, b + 2)), S = C(d.slice(v, v + 1)), E = ot(d.slice(v + 1, v + 1 + S)), L = [], U = v + 1 + S;
      let D = 0, m = U + o.numControlBytes;
      for (const [A, x, M, tt] of u) {
        if (tt & 1) {
          D++;
          continue;
        }
        const q = U + D, F = C(d.slice(q, q + 1)) & M;
        if (F === M)
          if (fe(M) > 1) {
            const { value: B, length: H } = ct(p, m);
            L.push([A, null, B, x]), m += H;
          } else L.push([A, 1, null, x]);
        else L.push([A, F >> vn(M), null, x]);
      }
      const w = {};
      for (const [A, x, M, tt] of L) {
        const q = [];
        if (x != null)
          for (let F = 0; F < x * tt; F++) {
            const { value: B, length: H } = ct(p, m);
            q.push(B), m += H;
          }
        else {
          let F = 0;
          for (; F < M; ) {
            const { value: B, length: H } = ct(p, m);
            q.push(B), m += H, F += H;
          }
        }
        w[A] = q;
      }
      c.push({ name: E, tagMap: w });
    }
  }
  return { table: c, cncx: h };
}, An = async (n, t) => {
  const { table: e, cncx: s } = await dt(n, t), r = e.map(({ tagMap: o }, a) => ({
    index: a,
    offset: o[1]?.[0],
    size: o[2]?.[0],
    label: s[o[3]] ?? "",
    headingLevel: o[4]?.[0],
    pos: o[6],
    parent: o[21]?.[0],
    firstChild: o[22]?.[0],
    lastChild: o[23]?.[0]
  })), i = (o) => (o.firstChild == null || (o.children = r.filter((a) => a.parent === o.index).map(i)), o);
  return r.filter((o) => o.headingLevel === 0).map(i);
}, Tn = (n, t) => {
  const { magic: e, count: s } = N(un, n);
  if (e !== "EXTH") throw new Error("Invalid EXTH header");
  const r = Nt(t), i = {};
  let o = 12;
  for (let a = 0; a < s; a++) {
    const u = C(n.slice(o, o + 4)), h = C(n.slice(o + 4, o + 8));
    if (u in Kt) {
      const [l, c, f] = Kt[u], d = n.slice(o + 8, o + h), p = c === "uint" ? C(d) : r.decode(d);
      f ? (i[l] ??= [], i[l].push(p)) : i[l] = p;
    }
    o += h;
  }
  return i;
}, In = async (n, t) => {
  const { flags: e, dataStart: s, keyLength: r, keyStart: i } = N(gn, n), o = new Uint8Array(n.slice(s));
  if (e & 2) {
    const u = r === 16 ? 1024 : 1040, h = new Uint8Array(n.slice(i, i + r)), l = Math.min(u, o.length);
    for (var a = 0; a < l; a++) o[a] = o[a] ^ h[a % h.length];
  }
  if (e & 1) try {
    return await t(o);
  } catch (u) {
    console.warn(u), console.warn("Failed to decompress font");
  }
  return o;
}, cs = async (n) => ot(await n.slice(60, 68).arrayBuffer()) === "BOOKMOBI";
class Ln {
  #t;
  #n;
  pdb;
  async open(t) {
    this.#t = t;
    const e = N(on, await t.slice(0, 78).arrayBuffer());
    this.pdb = e;
    const s = await t.slice(78, 78 + e.numRecords * 8).arrayBuffer();
    this.#n = Array.from(
      { length: e.numRecords },
      (r, i) => C(s.slice(i * 8, i * 8 + 4))
    ).map((r, i, o) => [r, o[i + 1]]);
  }
  loadRecord(t) {
    const e = this.#n[t];
    if (!e) throw new RangeError("Record index out of bounds");
    return this.#t.slice(...e).arrayBuffer();
  }
  async loadMagic(t) {
    const e = this.#n[t][0];
    return ot(await this.#t.slice(e, e + 4).arrayBuffer());
  }
}
class ls extends Ln {
  #t = 0;
  #n;
  #e;
  #r;
  #i;
  #s;
  constructor({ unzlib: t }) {
    super(), this.unzlib = t;
  }
  async open(t) {
    await super.open(t), this.headers = this.#o(await super.loadRecord(0)), this.#n = this.headers.mobi.resourceStart;
    let e = this.headers.mobi.version >= 8;
    if (!e) {
      const s = this.headers.exth?.boundary;
      if (s < 4294967295) try {
        this.headers = this.#o(await super.loadRecord(s)), this.#t = s, e = !0;
      } catch (r) {
        console.warn(r), console.warn("Failed to open KF8; falling back to MOBI");
      }
    }
    return await this.#a(), e ? new Un(this).init() : new Mn(this).init();
  }
  #o(t) {
    const e = N(an, t), s = N(cn, t);
    if (s.magic !== "MOBI") throw new Error("Missing MOBI header");
    const { titleOffset: r, titleLength: i, localeLanguage: o, localeRegion: a } = s;
    s.title = t.slice(r, r + i);
    const u = yn[o];
    s.language = u?.[a >> 2] ?? u?.[0];
    const h = s.exthFlag & 64 ? Tn(t.slice(s.length + 16), s.encoding) : null, l = s.version >= 8 ? N(ln, t) : null;
    return { palmdoc: e, mobi: s, exth: h, kf8: l };
  }
  async #a() {
    const { palmdoc: t, mobi: e } = this.headers;
    this.#e = Nt(e.encoding), this.#r = new TextEncoder();
    const { compression: s } = t;
    if (this.#i = s === 1 ? (a) => a : s === 2 ? xn : s === 17480 ? await En(e, this.loadRecord.bind(this)) : null, !this.#i) throw new Error("Unknown compression type");
    const { trailingFlags: r } = e, i = r & 1, o = fe(r >>> 1);
    this.#s = (a) => {
      for (let u = 0; u < o; u++) {
        const h = wn(a);
        a = a.subarray(0, -h);
      }
      if (i) {
        const u = (a[a.length - 1] & 3) + 1;
        a = a.subarray(0, -u);
      }
      return a;
    };
  }
  decode(...t) {
    return this.#e.decode(...t);
  }
  encode(...t) {
    return this.#r.encode(...t);
  }
  loadRecord(t) {
    return super.loadRecord(this.#t + t);
  }
  loadMagic(t) {
    return super.loadMagic(this.#t + t);
  }
  loadText(t) {
    return this.loadRecord(t + 1).then((e) => new Uint8Array(e)).then(this.#s).then(this.#i);
  }
  async loadResource(t) {
    const e = await super.loadRecord(this.#n + t), s = ot(e.slice(0, 4));
    return s === "FONT" ? In(e, this.unzlib) : s === "VIDE" || s === "AUDI" ? e.slice(12) : e;
  }
  getNCX() {
    const t = this.headers.mobi.indx;
    if (t < 4294967295) return An(t, this.loadRecord.bind(this));
  }
  getMetadata() {
    const { mobi: t, exth: e } = this.headers;
    return {
      identifier: t.uid.toString(),
      title: Y(e?.title || this.decode(t.title)),
      author: e?.creator?.map(Y),
      publisher: Y(e?.publisher),
      language: e?.language ?? t.language,
      published: e?.date,
      description: Y(e?.description),
      subject: e?.subject?.map(Y),
      rights: Y(e?.rights),
      contributor: e?.contributor
    };
  }
  async getCover() {
    const { exth: t } = this.headers, e = t?.coverOffset < 4294967295 ? t?.coverOffset : t?.thumbnailOffset < 4294967295 ? t?.thumbnailOffset : null;
    if (e != null) {
      const s = await this.loadResource(e);
      return new Blob([s]);
    }
  }
}
const Wt = /<\s*(?:mbp:)?pagebreak[^>]*>/gi, Rn = /<[^<>]+filepos=['"]{0,1}(\d+)[^<>]*>/gi, Cn = (n) => {
  let t = 0;
  for (; n; ) {
    const e = n.parentElement;
    if (e) {
      const s = e.tagName.toLowerCase();
      s === "p" ? t += 1.5 : s === "blockquote" && (t += 2);
    }
    n = e;
  }
  return t;
};
function kn(n) {
  let e = "";
  for (let s = 0; s < n.length; s += 32768)
    e += String.fromCharCode.apply(null, n.subarray(s, s + 32768));
  return e;
}
class Mn {
  parser = new DOMParser();
  serializer = new XMLSerializer();
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e = /* @__PURE__ */ new Map();
  #r;
  #i = [];
  #s = z.HTML;
  constructor(t) {
    this.mobi = t;
  }
  async init() {
    const t = [];
    for (let i = 0; i < this.mobi.headers.palmdoc.numTextRecords; i++) {
      const o = await this.mobi.loadText(i);
      t.push(o);
    }
    const e = t.reduce((i, o) => i + o.byteLength, 0), s = new Uint8Array(e);
    t.reduce((i, o) => (s.set(new Uint8Array(o), i), i + o.byteLength), 0);
    const r = kn(s);
    this.#r = [0].concat(Array.from(r.matchAll(Wt), (i) => i.index)).map((i, o, a) => {
      const u = a[o + 1] ?? s.length;
      return { book: this, raw: s.subarray(i, u) };
    }).map((i, o, a) => (i.start = a[o - 1]?.end ?? 0, i.end = i.start + i.raw.byteLength, i)), this.sections = this.#r.map((i, o) => ({
      id: o,
      load: () => this.loadSection(i),
      createDocument: () => this.createDocument(i),
      size: i.end - i.start
    })), this.#i = [...new Set(
      Array.from(r.matchAll(Rn), (i) => i[1])
    )].map((i) => ({ filepos: i, number: Number(i) })).sort((i, o) => i.number - o.number);
    try {
      this.landmarks = await this.getGuide();
      const i = this.landmarks.find(({ type: o }) => o?.includes("toc"))?.href;
      if (i) {
        const { index: o } = this.resolveHref(i), a = await this.sections[o].createDocument();
        let u, h = 0, l = 0;
        const c = /* @__PURE__ */ new Map(), f = /* @__PURE__ */ new Map();
        this.toc = Array.from(a.querySelectorAll("a[filepos]")).reduce((d, p) => {
          const g = Cn(p), y = {
            label: p.innerText?.trim() ?? "",
            href: `filepos:${p.getAttribute("filepos")}`
          }, b = g > l ? h + 1 : g === l ? h : c.get(g) ?? Math.max(0, h - 1);
          if (b > h)
            u ? (u.subitems ??= [], u.subitems.push(y), f.set(b, u)) : d.push(y);
          else {
            const v = f.get(b);
            v ? v.subitems.push(y) : d.push(y);
          }
          return u = y, h = b, l = g, c.set(g, b), d;
        }, []);
      }
    } catch (i) {
      console.warn(i);
    }
    return this.metadata = this.mobi.getMetadata(), this.getCover = this.mobi.getCover.bind(this.mobi), this;
  }
  async getGuide() {
    const t = await this.createDocument(this.#r[0]);
    return Array.from(t.getElementsByTagName("reference"), (e) => ({
      label: e.getAttribute("title"),
      type: e.getAttribute("type")?.split(/\s/),
      href: `filepos:${e.getAttribute("filepos")}`
    }));
  }
  async loadResource(t) {
    if (this.#t.has(t)) return this.#t.get(t);
    const e = await this.mobi.loadResource(t), s = URL.createObjectURL(new Blob([e]));
    return this.#t.set(t, s), s;
  }
  async loadRecindex(t) {
    return this.loadResource(Number(t) - 1);
  }
  async replaceResources(t) {
    for (const e of t.querySelectorAll("img[recindex]")) {
      const s = e.getAttribute("recindex");
      try {
        e.src = await this.loadRecindex(s);
      } catch {
        console.warn(`Failed to load image ${s}`);
      }
    }
    for (const e of t.querySelectorAll("[mediarecindex]")) {
      const s = e.getAttribute("mediarecindex"), r = e.getAttribute("recindex");
      try {
        e.src = await this.loadRecindex(s), r && (e.poster = await this.loadRecindex(r));
      } catch {
        console.warn(`Failed to load media ${s}`);
      }
    }
    for (const e of t.querySelectorAll("[filepos]")) {
      const s = e.getAttribute("filepos");
      e.href = `filepos:${s}`;
    }
  }
  async loadText(t) {
    if (this.#n.has(t)) return this.#n.get(t);
    const { raw: e } = t, s = this.#i.filter(({ number: o }) => o >= t.start && o < t.end).map((o) => ({ ...o, offset: o.number - t.start }));
    let r = e;
    s.length && (r = e.subarray(0, s[0].offset), s.forEach(({ filepos: o, offset: a }, u) => {
      const h = s[u + 1], l = this.mobi.encode(`<a id="filepos${o}"></a>`);
      r = he(r, l, e.subarray(a, h?.offset));
    }));
    const i = this.mobi.decode(r).replaceAll(Wt, "");
    return this.#n.set(t, i), i;
  }
  async createDocument(t) {
    const e = await this.loadText(t);
    return this.parser.parseFromString(e, this.#s);
  }
  async loadSection(t) {
    if (this.#e.has(t)) return this.#e.get(t);
    const e = await this.createDocument(t), s = e.createElement("style");
    e.head.append(s), s.append(e.createTextNode(`blockquote {
            margin-block-start: 0;
            margin-block-end: 0;
            margin-inline-start: 1em;
            margin-inline-end: 0;
        }`)), await this.replaceResources(e);
    const r = this.serializer.serializeToString(e), i = URL.createObjectURL(new Blob([r], { type: this.#s }));
    return this.#e.set(t, i), i;
  }
  resolveHref(t) {
    const e = t.match(/filepos:(.*)/)[1], s = Number(e);
    return { index: this.#r.findIndex((o) => o.end > s), anchor: (o) => o.getElementById(`filepos${e}`) };
  }
  splitTOCHref(t) {
    const e = t.match(/filepos:(.*)/)[1], s = Number(e);
    return [this.#r.findIndex((i) => i.end > s), `filepos${e}`];
  }
  getTOCFragment(t, e) {
    return t.getElementById(e);
  }
  isExternal(t) {
    return /^(?!blob|filepos)\w+:/i.test(t);
  }
  destroy() {
    for (const t of this.#t.values()) URL.revokeObjectURL(t);
    for (const t of this.#e.values()) URL.revokeObjectURL(t);
  }
}
const de = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/, Bn = /kindle:pos:fid:(\w+):off:(\w+)/, On = (n) => {
  const [t, e, s] = n.match(de).slice(1);
  return { resourceType: t, id: parseInt(e, 32), type: s };
}, Yt = (n) => {
  const [t, e] = n.match(Bn).slice(1);
  return { fid: parseInt(t, 32), off: parseInt(e, 32) };
}, Zt = (n = 0, t = 0) => `kindle:pos:fid:${n.toString(32).toUpperCase().padStart(4, "0")}:off:${t.toString(32).toUpperCase().padStart(10, "0")}`, Jt = (n) => {
  const t = n.match(/\s(id|name|aid)\s*=\s*['"]([^'"]*)['"]/i);
  if (!t) return;
  const [, e, s] = t;
  return `[${e}="${CSS.escape(s)}"]`;
}, $n = async (n, t, e) => {
  const s = [];
  n.replace(t, (...i) => (s.push(i), null));
  const r = [];
  for (const i of s) r.push(await e(...i));
  return n.replace(t, () => r.shift());
}, Nn = (n) => {
  for (const t of n) {
    if (t === "page-spread-left" || t === "rendition:page-spread-left")
      return "left";
    if (t === "page-spread-right" || t === "rendition:page-spread-right")
      return "right";
    if (t === "rendition:page-spread-center") return "center";
  }
};
class Un {
  parser = new DOMParser();
  serializer = new XMLSerializer();
  transformTarget = new EventTarget();
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e = /* @__PURE__ */ new Map();
  #r = {};
  #i;
  #s;
  #o = new Uint8Array();
  #a = new Uint8Array();
  #h = -1;
  #d = -1;
  #c = z.XHTML;
  #l = /* @__PURE__ */ new Map();
  constructor(t) {
    this.mobi = t;
  }
  async init() {
    const t = this.mobi.loadRecord.bind(this.mobi), { kf8: e } = this.mobi.headers;
    try {
      const h = await t(e.fdst), l = N(pn, h);
      if (l.magic !== "FDST") throw new Error("Missing FDST record");
      const c = Array.from(
        { length: l.numEntries },
        (f, d) => 12 + d * 8
      ).map((f) => [
        C(h.slice(f, f + 4)),
        C(h.slice(f + 4, f + 8))
      ]);
      this.#r.fdstTable = c, this.#s = c[c.length - 1][1];
    } catch {
    }
    const s = (await dt(e.skel, t)).table.map(({ name: h, tagMap: l }, c) => ({
      index: c,
      name: h,
      numFrag: l[1][0],
      offset: l[6][0],
      length: l[6][1]
    })), r = await dt(e.frag, t), i = r.table.map(({ name: h, tagMap: l }) => ({
      insertOffset: parseInt(h),
      selector: r.cncx[l[2][0]],
      index: l[4][0],
      offset: l[6][0],
      length: l[6][1]
    }));
    this.#r.skelTable = s, this.#r.fragTable = i, this.#i = s.reduce((h, l) => {
      const c = h[h.length - 1], f = c?.fragEnd ?? 0, d = f + l.numFrag, p = i.slice(f, d), g = l.length + p.map((b) => b.length).reduce((b, v) => b + v, 0), y = (c?.totalLength ?? 0) + g;
      return h.concat({ skel: l, frags: p, fragEnd: d, length: g, totalLength: y });
    }, []);
    const o = await this.getResourcesByMagic(["RESC", "PAGE"]), a = /* @__PURE__ */ new Map();
    if (o.RESC) {
      const h = await this.mobi.loadRecord(o.RESC), l = this.mobi.decode(h.slice(16)).replace(/\0/g, ""), c = l.search(/\?>/), f = `<package>${l.slice(c)}</package>`, d = this.parser.parseFromString(f, z.XML);
      for (const p of d.querySelectorAll("spine > itemref")) {
        const g = parseInt(p.getAttribute("skelid"));
        a.set(g, Nn(
          p.getAttribute("properties")?.split(" ") ?? []
        ));
      }
    }
    this.sections = this.#i.map((h, l) => h.frags.length ? {
      id: l,
      load: () => this.loadSection(h),
      createDocument: () => this.createDocument(h),
      size: h.length,
      pageSpread: a.get(l)
    } : { linear: "no" });
    try {
      const h = await this.mobi.getNCX(), l = ({ label: c, pos: f, children: d }) => {
        const [p, g] = f, y = Zt(p, g), b = this.#n.get(p);
        return b ? b.push(g) : this.#n.set(p, [g]), { label: Y(c), href: y, subitems: d?.map(l) };
      };
      this.toc = h?.map(l), this.landmarks = await this.getGuide();
    } catch (h) {
      console.warn(h);
    }
    const { exth: u } = this.mobi.headers;
    return this.dir = u.pageProgressionDirection, this.rendition = {
      layout: u.fixedLayout === "true" ? "pre-paginated" : "reflowable",
      viewport: Object.fromEntries(u.originalResolution?.split("x")?.slice(0, 2)?.map((h, l) => [l ? "height" : "width", h]) ?? [])
    }, this.metadata = this.mobi.getMetadata(), this.getCover = this.mobi.getCover.bind(this.mobi), this;
  }
  // is this really the only way of getting to RESC, PAGE, etc.?
  async getResourcesByMagic(t) {
    const e = {}, s = this.mobi.headers.kf8.resourceStart, r = this.mobi.pdb.numRecords;
    for (let i = s; i < r; i++)
      try {
        const o = await this.mobi.loadMagic(i), a = t.find((u) => u === o);
        a && (e[a] = i);
      } catch {
      }
    return e;
  }
  async getGuide() {
    const t = this.mobi.headers.kf8.guide;
    if (t < 4294967295) {
      const e = this.mobi.loadRecord.bind(this.mobi), { table: s, cncx: r } = await dt(t, e);
      return s.map(({ name: i, tagMap: o }) => ({
        label: r[o[1][0]] ?? "",
        type: i?.split(/\s/),
        href: Zt(o[6]?.[0] ?? o[3]?.[0])
      }));
    }
  }
  async loadResourceBlob(t) {
    const { resourceType: e, id: s, type: r } = On(t), i = e === "flow" ? await this.loadFlow(s) : await this.mobi.loadResource(s - 1), a = { data: [z.XHTML, z.HTML, z.CSS, z.SVG].includes(r) ? await this.replaceResources(this.mobi.decode(i)) : i, type: r }, u = new CustomEvent("data", { detail: a });
    this.transformTarget.dispatchEvent(u);
    const h = await u.detail.data, l = await u.detail.type, c = l === z.SVG ? this.parser.parseFromString(h, l) : null;
    return [
      new Blob([h], { newType: l }),
      // SVG wrappers need to be inlined
      // as browsers don't allow external resources when loading SVG as an image
      c?.getElementsByTagNameNS("http://www.w3.org/2000/svg", "image")?.length ? c.documentElement : null
    ];
  }
  async loadResource(t) {
    if (this.#t.has(t)) return this.#t.get(t);
    const [e, s] = await this.loadResourceBlob(t), r = s ? t : URL.createObjectURL(e);
    return s && this.#l.set(r, s), this.#t.set(t, r), r;
  }
  replaceResources(t) {
    const e = new RegExp(de, "g");
    return $n(t, e, this.loadResource.bind(this));
  }
  // NOTE: there doesn't seem to be a way to access text randomly?
  // how to know the decompressed size of the records without decompressing?
  // 4096 is just the maximum size
  async loadRaw(t, e) {
    const s = e - this.#o.length, r = this.#s == null ? 1 / 0 : this.#s - this.#a.length - t;
    if (s < 0 || s < r) {
      for (; this.#o.length < e; ) {
        const o = ++this.#h, a = await this.mobi.loadText(o);
        this.#o = Bt(this.#o, a);
      }
      return this.#o.slice(t, e);
    }
    for (; this.#s - this.#a.length > t; ) {
      const o = this.mobi.headers.palmdoc.numTextRecords - 1 - ++this.#d, a = await this.mobi.loadText(o);
      this.#a = Bt(a, this.#a);
    }
    const i = this.#s - this.#a.length;
    return this.#a.slice(t - i, e - i);
  }
  loadFlow(t) {
    if (t < 4294967295)
      return this.loadRaw(...this.#r.fdstTable[t]);
  }
  async loadText(t) {
    const { skel: e, frags: s, length: r } = t, i = await this.loadRaw(e.offset, e.offset + r);
    let o = i.slice(0, e.length);
    for (const a of s) {
      const u = a.insertOffset - e.offset, h = e.length + a.offset, l = i.slice(h, h + a.length);
      o = he(
        o.slice(0, u),
        l,
        o.slice(u)
      );
      const c = this.#n.get(a.index);
      if (c) for (const f of c) {
        const d = this.mobi.decode(l.slice(f)), p = Jt(d);
        this.#u(a.index, f, p);
      }
    }
    return this.mobi.decode(o);
  }
  async createDocument(t) {
    const e = await this.loadText(t);
    return this.parser.parseFromString(e, this.#c);
  }
  async loadSection(t) {
    if (this.#t.has(t)) return this.#t.get(t);
    const e = await this.loadText(t), s = await this.replaceResources(e);
    let r = this.parser.parseFromString(s, this.#c);
    (r.querySelector("parsererror") || !r.documentElement?.namespaceURI) && (this.#c = z.HTML, r = this.parser.parseFromString(s, this.#c));
    for (const [o, a] of this.#l)
      for (const u of r.querySelectorAll(`img[src="${o}"]`))
        u.replaceWith(a);
    const i = URL.createObjectURL(
      new Blob([this.serializer.serializeToString(r)], { type: this.#c })
    );
    return this.#t.set(t, i), i;
  }
  getIndexByFID(t) {
    return this.#i.findIndex((e) => e.frags.some((s) => s.index === t));
  }
  #u(t, e, s) {
    const r = this.#e.get(t);
    if (r) r.set(e, s);
    else {
      const i = /* @__PURE__ */ new Map();
      this.#e.set(t, i), i.set(e, s);
    }
  }
  async resolveHref(t) {
    const { fid: e, off: s } = Yt(t), r = this.getIndexByFID(e);
    if (r < 0) return;
    const i = this.#e.get(e)?.get(s);
    if (i) return { index: r, anchor: (p) => p.querySelector(i) };
    const { skel: o, frags: a } = this.#i[r], u = a.find((p) => p.index === e), h = o.offset + o.length + u.offset, l = await this.loadRaw(h, h + u.length), c = this.mobi.decode(l.slice(s)), f = Jt(c);
    return this.#u(e, s, f), { index: r, anchor: (p) => p.querySelector(f) };
  }
  splitTOCHref(t) {
    const e = Yt(t);
    return [this.getIndexByFID(e.fid), e];
  }
  getTOCFragment(t, { fid: e, off: s }) {
    const r = this.#e.get(e)?.get(s);
    return t.querySelector(r);
  }
  isExternal(t) {
    return /^(?!blob|kindle)\w+:/i.test(t);
  }
  destroy() {
    for (const t of this.#t.values()) URL.revokeObjectURL(t);
  }
}
const pe = (n) => n ? n.replace(/[\t\n\f\r ]+/g, " ").replace(/^[\t\n\f\r ]+/, "").replace(/[\t\n\f\r ]+$/, "") : "", O = (n) => pe(n?.textContent), lt = {
  XLINK: "http://www.w3.org/1999/xlink",
  EPUB: "http://www.idpf.org/2007/ops"
}, gt = {
  XML: "application/xml",
  XHTML: "application/xhtml+xml"
}, k = {
  strong: ["strong", "self"],
  emphasis: ["em", "self"],
  style: ["span", "self"],
  a: "anchor",
  strikethrough: ["s", "self"],
  sub: ["sub", "self"],
  sup: ["sup", "self"],
  code: ["code", "self"],
  image: "image"
}, Dn = {
  tr: ["tr", {
    th: ["th", k, ["colspan", "rowspan", "align", "valign"]],
    td: ["td", k, ["colspan", "rowspan", "align", "valign"]]
  }, ["align"]]
}, ge = {
  epigraph: ["blockquote"],
  subtitle: ["h2", k],
  "text-author": ["p", k],
  date: ["p", k],
  stanza: "stanza"
}, mt = {
  title: ["header", {
    p: ["h1", k],
    "empty-line": ["br"]
  }],
  epigraph: ["blockquote", "self"],
  image: "image",
  annotation: ["aside"],
  section: ["section", "self"],
  p: ["p", k],
  poem: ["blockquote", ge],
  subtitle: ["h2", k],
  cite: ["blockquote", "self"],
  "empty-line": ["br"],
  table: ["table", Dn],
  "text-author": ["p", k]
};
ge.epigraph.push(mt);
const Fn = {
  image: "image",
  title: ["section", {
    p: ["h1", k],
    "empty-line": ["br"]
  }],
  epigraph: ["section", mt],
  section: ["section", mt]
};
class Hn {
  constructor(t) {
    this.fb2 = t, this.doc = document.implementation.createDocument(lt.XHTML, "html"), this.bins = new Map(Array.from(
      this.fb2.getElementsByTagName("binary"),
      (e) => [e.id, e]
    ));
  }
  getImageSrc(t) {
    const e = t.getAttributeNS(lt.XLINK, "href");
    if (!e) return "data:,";
    const [, s] = e.split("#");
    if (!s) return e;
    const r = this.bins.get(s);
    return r ? `data:${r.getAttribute("content-type")};base64,${r.textContent}` : e;
  }
  image(t) {
    const e = this.doc.createElement("img");
    return e.alt = t.getAttribute("alt"), e.title = t.getAttribute("title"), e.setAttribute("src", this.getImageSrc(t)), e;
  }
  anchor(t) {
    const e = this.convert(t, { a: ["a", k] });
    return e.setAttribute("href", t.getAttributeNS(lt.XLINK, "href")), t.getAttribute("type") === "note" && e.setAttributeNS(lt.EPUB, "epub:type", "noteref"), e;
  }
  stanza(t) {
    const e = this.convert(t, {
      stanza: ["p", {
        title: ["header", {
          p: ["strong", k],
          "empty-line": ["br"]
        }],
        subtitle: ["p", k]
      }]
    });
    for (const s of t.children) s.nodeName === "v" && (e.append(this.doc.createTextNode(s.textContent)), e.append(this.doc.createElement("br")));
    return e;
  }
  convert(t, e) {
    if (t.nodeType === 3) return this.doc.createTextNode(t.textContent);
    if (t.nodeType === 4) return this.doc.createCDATASection(t.textContent);
    if (t.nodeType === 8) return this.doc.createComment(t.textContent);
    const s = e?.[t.nodeName];
    if (!s) return null;
    if (typeof s == "string") return this[s](t);
    const [r, i, o] = s, a = this.doc.createElement(r);
    if (t.id && (a.id = t.id), a.classList.add(t.nodeName), Array.isArray(o)) for (const l of o) {
      const c = t.getAttribute(l);
      c && a.setAttribute(l, c);
    }
    const u = i === "self" ? e : i;
    let h = t.firstChild;
    for (; h; ) {
      const l = this.convert(h, u);
      l && a.append(l), h = h.nextSibling;
    }
    return a;
  }
}
const Pn = async (n) => {
  const t = await n.arrayBuffer(), e = new TextDecoder("utf-8").decode(t), s = new DOMParser(), r = s.parseFromString(e, gt.XML), i = r.xmlEncoding || e.match(/^<\?xml\s+version\s*=\s*["']1.\d+"\s+encoding\s*=\s*["']([A-Za-z0-9._-]*)["']/)?.[1];
  if (i && i.toLowerCase() !== "utf-8") {
    const o = new TextDecoder(i).decode(t);
    return s.parseFromString(o, gt.XML);
  }
  return r;
}, Xn = URL.createObjectURL(new Blob([`
@namespace epub "http://www.idpf.org/2007/ops";
body > img, section > img {
    display: block;
    margin: auto;
}
.title h1 {
    text-align: center;
}
body > section > .title, body.notesBodyType > .title {
    margin: 3em 0;
}
body.notesBodyType > section .title h1 {
    text-align: start;
}
body.notesBodyType > section .title {
    margin: 1em 0;
}
p {
    text-indent: 1em;
    margin: 0;
}
:not(p) + p, p:first-child {
    text-indent: 0;
}
.poem p {
    text-indent: 0;
    margin: 1em 0;
}
.text-author, .date {
    text-align: end;
}
.text-author:before {
    content: "—";
}
table {
    border-collapse: collapse;
}
td, th {
    padding: .25em;
}
a[epub|type~="noteref"] {
    font-size: .75em;
    vertical-align: super;
}
body:not(.notesBodyType) > .title, body:not(.notesBodyType) > .epigraph {
    margin: 3em 0;
}
`], { type: "text/css" })), jn = (n) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
    <head><link href="${Xn}" rel="stylesheet" type="text/css"/></head>
    <body>${n}</body>
</html>`, St = "data-foliate-id", us = async (n) => {
  const t = {}, e = await Pn(n), s = new Hn(e), r = (d) => e.querySelector(d), i = (d) => [...e.querySelectorAll(d)], o = (d) => {
    const p = O(d.querySelector("nickname"));
    if (p) return p;
    const g = O(d.querySelector("first-name")), y = O(d.querySelector("middle-name")), b = O(d.querySelector("last-name")), v = [g, y, b].filter((E) => E).join(" "), S = b ? [b, [g, y].filter((E) => E).join(" ")].join(", ") : null;
    return { name: v, sortAs: S };
  }, a = (d) => d?.getAttribute("value") ?? O(d), u = r("title-info annotation");
  if (t.metadata = {
    title: O(r("title-info book-title")),
    identifier: O(r("document-info id")),
    language: O(r("title-info lang")),
    author: i("title-info author").map(o),
    translator: i("title-info translator").map(o),
    contributor: i("document-info author").map(o).concat(i("document-info program-used").map(O)).map((d) => Object.assign(
      typeof d == "string" ? { name: d } : d,
      { role: "bkp" }
    )),
    publisher: O(r("publish-info publisher")),
    published: a(r("title-info date")),
    modified: a(r("document-info date")),
    description: u ? s.convert(
      u,
      { annotation: ["div", mt] }
    ).innerHTML : null,
    subject: i("title-info genre").map(O)
  }, r("coverpage image")) {
    const d = s.getImageSrc(r("coverpage image"));
    t.getCover = () => fetch(d).then((p) => p.blob());
  } else t.getCover = () => null;
  const h = Array.from(e.querySelectorAll("body"), (d) => {
    const p = s.convert(d, { body: ["body", Fn] });
    return [Array.from(p.children, (g) => {
      const y = [g, ...g.querySelectorAll("[id]")].map((b) => b.id);
      return { el: g, ids: y };
    }), p];
  }), l = [], c = h[0][0].map(({ el: d, ids: p }) => {
    const g = Array.from(
      d.querySelectorAll(":scope > section > .title"),
      (y, b) => (y.setAttribute(St, b), { title: O(y), index: b })
    );
    return { ids: p, titles: g, el: d };
  }).concat(h.slice(1).map(([d, p]) => {
    const g = d.map((y) => y.ids).flat();
    return p.classList.add("notesBodyType"), { ids: g, el: p, linear: "no" };
  })).map(({ ids: d, titles: p, el: g, linear: y }) => {
    const b = jn(g.outerHTML), v = new Blob([b], { type: gt.XHTML }), S = URL.createObjectURL(v);
    l.push(S);
    const E = pe(
      g.querySelector(".title, .subtitle, p")?.textContent ?? (g.classList.contains("title") ? g.textContent : "")
    );
    return {
      ids: d,
      title: E,
      titles: p,
      load: () => S,
      createDocument: () => new DOMParser().parseFromString(b, gt.XHTML),
      // doo't count image data as it'd skew the size too much
      size: v.size - Array.from(
        g.querySelectorAll("[src]"),
        (L) => L.getAttribute("src")?.length ?? 0
      ).reduce((L, U) => L + U, 0),
      linear: y
    };
  }), f = /* @__PURE__ */ new Map();
  return t.sections = c.map((d, p) => {
    const { ids: g, load: y, createDocument: b, size: v, linear: S } = d;
    for (const E of g) E && f.set(E, p);
    return { id: p, load: y, createDocument: b, size: v, linear: S };
  }), t.toc = c.map(({ title: d, titles: p }, g) => {
    const y = g.toString();
    return {
      label: d,
      href: y,
      subitems: p?.length ? p.map(({ title: b, index: v }) => ({
        label: b,
        href: `${y}#${v}`
      })) : null
    };
  }).filter((d) => d), t.resolveHref = (d) => {
    const [p, g] = d.split("#");
    return p ? { index: Number(p), anchor: (y) => y.querySelector(`[${St}="${g}"]`) } : { index: f.get(g), anchor: (y) => y.getElementById(g) };
  }, t.splitTOCHref = (d) => d?.split("#")?.map((p) => Number(p)) ?? [], t.getTOCFragment = (d, p) => d.querySelector(`[${St}="${p}"]`), t.isExternal = (d) => /^\w+:/i.test(d), t.destroy = () => {
    for (const d of l) URL.revokeObjectURL(d);
  }, t;
}, hs = ({ entries: n, loadBlob: t, getSize: e }, s) => {
  const r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), o = async (c) => {
    if (r.has(c)) return r.get(c);
    const f = URL.createObjectURL(await t(c)), d = URL.createObjectURL(
      new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin: 0"><img src="${f}"></body></html>`], { type: "text/html" })
    );
    return i.set(c, [f, d]), r.set(c, d), d;
  }, a = (c) => {
    i.get(c)?.forEach?.((f) => URL.revokeObjectURL(f)), i.delete(c), r.delete(c);
  }, u = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".jxl", ".avif"], h = n.map((c) => c.filename).filter((c) => u.some((f) => c.endsWith(f))).sort(new Intl.Collator([], { numeric: !0 }).compare);
  if (!h.length) throw new Error("No supported image files in archive");
  const l = {};
  return l.getCover = () => t(h[0]), l.metadata = { title: s.name }, l.sections = h.map((c) => ({
    id: c,
    load: () => o(c),
    unload: () => a(c),
    size: e(c)
  })), l.toc = h.map((c) => ({ label: c, href: c })), l.rendition = { layout: "pre-paginated" }, l.resolveHref = (c) => ({ index: l.sections.findIndex((f) => f.id === c) }), l.splitTOCHref = (c) => [c, null], l.getTOCFragment = (c) => c.documentElement, l.destroy = () => {
    for (const c of i.values())
      for (const f of c) URL.revokeObjectURL(f);
  }, l;
}, ut = 50, Qt = (n) => n.replace(/\s+/g, " "), me = (n, { startIndex: t, startOffset: e, endIndex: s, endOffset: r }) => {
  const i = n[t], o = n[s], a = i === o ? i.slice(e, r) : i.slice(e) + n.slice(i + 1, o).join("") + o.slice(0, r), u = Qt(i.slice(0, e)).trimStart(), h = Qt(o.slice(r)).trimEnd(), l = u.length < ut ? "" : "…", c = h.length < ut ? "" : "…", f = `${l}${u.slice(-ut)}`, d = `${h.slice(0, ut)}${c}`;
  return { pre: f, match: a, post: d };
}, zn = function* (n, t, e = {}) {
  const { locales: s = "en", sensitivity: r } = e, i = r === "variant", o = n.join(""), a = i ? o : o.toLocaleLowerCase(s), u = i ? t : t.toLocaleLowerCase(s), h = u.length;
  let l = -1, c = -1, f = 0;
  do
    if (l = a.indexOf(u, l + 1), l > -1) {
      for (; f <= l; ) f += n[++c].length;
      const d = c, p = l - (f - n[c].length), g = l + h;
      for (; f <= g; ) f += n[++c].length;
      const y = c, b = g - (f - n[c].length), v = { startIndex: d, startOffset: p, endIndex: y, endOffset: b };
      yield { range: v, excerpt: me(n, v) };
    }
  while (l > -1);
}, _n = function* (n, t, e = {}) {
  const { locales: s = "en", granularity: r = "word", sensitivity: i = "base" } = e;
  let o, a;
  try {
    o = new Intl.Segmenter(s, { usage: "search", granularity: r }), a = new Intl.Collator(s, { sensitivity: i });
  } catch (f) {
    console.warn(f), o = new Intl.Segmenter("en", { usage: "search", granularity: r }), a = new Intl.Collator("en", { sensitivity: i });
  }
  const u = Array.from(o.segment(t)).length, h = [];
  let l = 0, c = o.segment(n[l])[Symbol.iterator]();
  t: for (; l < n.length; ) {
    for (; h.length < u; ) {
      const { done: d, value: p } = c.next();
      if (d)
        if (l++, l < n.length) {
          c = o.segment(n[l])[Symbol.iterator]();
          continue;
        } else break t;
      const { index: g, segment: y } = p;
      if (/[^\p{Format}]/u.test(y)) {
        if (/\s/u.test(y)) {
          /\s/u.test(h[h.length - 1]?.segment) || h.push({ strIndex: l, index: g, segment: " " });
          continue;
        }
        p.strIndex = l, h.push(p);
      }
    }
    const f = h.map((d) => d.segment).join("");
    if (a.compare(t, f) === 0) {
      const d = l, p = h[h.length - 1], g = p.index + p.segment.length, y = h[0].strIndex, b = h[0].index, v = { startIndex: y, startOffset: b, endIndex: d, endOffset: g };
      yield { range: v, excerpt: me(n, v) };
    }
    h.shift();
  }
}, fs = (n, t, e) => {
  const { granularity: s = "grapheme", sensitivity: r = "base" } = e;
  return !Intl?.Segmenter || s === "grapheme" && (r === "variant" || r === "accent") ? zn(n, t, e) : _n(n, t, e);
};
var $ = Uint8Array, Q = Uint16Array, qn = Int32Array, ye = new $([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]), be = new $([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]), Gn = new $([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]), we = function(n, t) {
  for (var e = new Q(31), s = 0; s < 31; ++s)
    e[s] = t += 1 << n[s - 1];
  for (var r = new qn(e[30]), s = 1; s < 30; ++s)
    for (var i = e[s]; i < e[s + 1]; ++i)
      r[i] = i - e[s] << 5 | s;
  return { b: e, r };
}, ve = we(ye, 2), xe = ve.b, Vn = ve.r;
xe[28] = 258, Vn[258] = 28;
var Kn = we(be, 0), Wn = Kn.b, Ot = new Q(32768);
for (var T = 0; T < 32768; ++T) {
  var V = (T & 43690) >> 1 | (T & 21845) << 1;
  V = (V & 52428) >> 2 | (V & 13107) << 2, V = (V & 61680) >> 4 | (V & 3855) << 4, Ot[T] = ((V & 65280) >> 8 | (V & 255) << 8) >> 1;
}
var st = (function(n, t, e) {
  for (var s = n.length, r = 0, i = new Q(t); r < s; ++r)
    n[r] && ++i[n[r] - 1];
  var o = new Q(t);
  for (r = 1; r < t; ++r)
    o[r] = o[r - 1] + i[r - 1] << 1;
  var a;
  if (e) {
    a = new Q(1 << t);
    var u = 15 - t;
    for (r = 0; r < s; ++r)
      if (n[r])
        for (var h = r << 4 | n[r], l = t - n[r], c = o[n[r] - 1]++ << l, f = c | (1 << l) - 1; c <= f; ++c)
          a[Ot[c] >> u] = h;
  } else
    for (a = new Q(s), r = 0; r < s; ++r)
      n[r] && (a[r] = Ot[o[n[r] - 1]++] >> 15 - n[r]);
  return a;
}), at = new $(288);
for (var T = 0; T < 144; ++T)
  at[T] = 8;
for (var T = 144; T < 256; ++T)
  at[T] = 9;
for (var T = 256; T < 280; ++T)
  at[T] = 7;
for (var T = 280; T < 288; ++T)
  at[T] = 8;
var Se = new $(32);
for (var T = 0; T < 32; ++T)
  Se[T] = 5;
var Yn = /* @__PURE__ */ st(at, 9, 1), Zn = /* @__PURE__ */ st(Se, 5, 1), Et = function(n) {
  for (var t = n[0], e = 1; e < n.length; ++e)
    n[e] > t && (t = n[e]);
  return t;
}, P = function(n, t, e) {
  var s = t / 8 | 0;
  return (n[s] | n[s + 1] << 8) >> (t & 7) & e;
}, At = function(n, t) {
  var e = t / 8 | 0;
  return (n[e] | n[e + 1] << 8 | n[e + 2] << 16) >> (t & 7);
}, Jn = function(n) {
  return (n + 7) / 8 | 0;
}, Qn = function(n, t, e) {
  return (e == null || e > n.length) && (e = n.length), new $(n.subarray(t, e));
}, ts = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  // determined by compression function
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
], X = function(n, t, e) {
  var s = new Error(t || ts[n]);
  if (s.code = n, Error.captureStackTrace && Error.captureStackTrace(s, X), !e)
    throw s;
  return s;
}, es = function(n, t, e, s) {
  var r = n.length, i = s ? s.length : 0;
  if (!r || t.f && !t.l)
    return e || new $(0);
  var o = !e, a = o || t.i != 2, u = t.i;
  o && (e = new $(r * 3));
  var h = function(Pt) {
    var Xt = e.length;
    if (Pt > Xt) {
      var jt = new $(Math.max(Xt * 2, Pt));
      jt.set(e), e = jt;
    }
  }, l = t.f || 0, c = t.p || 0, f = t.b || 0, d = t.l, p = t.d, g = t.m, y = t.n, b = r * 8;
  do {
    if (!d) {
      l = P(n, c, 1);
      var v = P(n, c + 1, 3);
      if (c += 3, v)
        if (v == 1)
          d = Yn, p = Zn, g = 9, y = 5;
        else if (v == 2) {
          var U = P(n, c, 31) + 257, D = P(n, c + 10, 15) + 4, m = U + P(n, c + 5, 31) + 1;
          c += 14;
          for (var w = new $(m), A = new $(19), x = 0; x < D; ++x)
            A[Gn[x]] = P(n, c + x * 3, 7);
          c += D * 3;
          for (var M = Et(A), tt = (1 << M) - 1, q = st(A, M, 1), x = 0; x < m; ) {
            var F = q[P(n, c, tt)];
            c += F & 15;
            var S = F >> 4;
            if (S < 16)
              w[x++] = S;
            else {
              var B = 0, H = 0;
              for (S == 16 ? (H = 3 + P(n, c, 3), c += 2, B = w[x - 1]) : S == 17 ? (H = 3 + P(n, c, 7), c += 3) : S == 18 && (H = 11 + P(n, c, 127), c += 7); H--; )
                w[x++] = B;
            }
          }
          var Ut = w.subarray(0, U), G = w.subarray(U);
          g = Et(Ut), y = Et(G), d = st(Ut, g, 1), p = st(G, y, 1);
        } else
          X(1);
      else {
        var S = Jn(c) + 4, E = n[S - 4] | n[S - 3] << 8, L = S + E;
        if (L > r) {
          u && X(0);
          break;
        }
        a && h(f + E), e.set(n.subarray(S, L), f), t.b = f += E, t.p = c = L * 8, t.f = l;
        continue;
      }
      if (c > b) {
        u && X(0);
        break;
      }
    }
    a && h(f + 131072);
    for (var Ee = (1 << g) - 1, Ae = (1 << y) - 1, bt = c; ; bt = c) {
      var B = d[At(n, c) & Ee], Z = B >> 4;
      if (c += B & 15, c > b) {
        u && X(0);
        break;
      }
      if (B || X(2), Z < 256)
        e[f++] = Z;
      else if (Z == 256) {
        bt = c, d = null;
        break;
      } else {
        var Dt = Z - 254;
        if (Z > 264) {
          var x = Z - 257, et = ye[x];
          Dt = P(n, c, (1 << et) - 1) + xe[x], c += et;
        }
        var wt = p[At(n, c) & Ae], vt = wt >> 4;
        wt || X(3), c += wt & 15;
        var G = Wn[vt];
        if (vt > 3) {
          var et = be[vt];
          G += At(n, c) & (1 << et) - 1, c += et;
        }
        if (c > b) {
          u && X(0);
          break;
        }
        a && h(f + 131072);
        var Ft = f + Dt;
        if (f < G) {
          var Ht = i - G, Te = Math.min(G, Ft);
          for (Ht + f < 0 && X(3); f < Te; ++f)
            e[f] = s[Ht + f];
        }
        for (; f < Ft; ++f)
          e[f] = e[f - G];
      }
    }
    t.l = d, t.p = bt, t.b = f, t.f = l, d && (l = 1, t.m = g, t.d = p, t.n = y);
  } while (!l);
  return f != e.length && o ? Qn(e, 0, f) : e.subarray(0, f);
}, ns = /* @__PURE__ */ new $(0), ss = function(n, t) {
  return ((n[0] & 15) != 8 || n[0] >> 4 > 7 || (n[0] << 8 | n[1]) % 31) && X(6, "invalid zlib data"), (n[1] >> 5 & 1) == +!t && X(6, "invalid zlib data: " + (n[1] & 32 ? "need" : "unexpected") + " dictionary"), (n[1] >> 3 & 4) + 2;
};
function ds(n, t) {
  return es(n.subarray(ss(n, t && t.dictionary), -4), { i: 2 }, t && t.out, t && t.dictionary);
}
var rs = typeof TextDecoder < "u" && /* @__PURE__ */ new TextDecoder(), is = 0;
try {
  rs.decode(ns, { stream: !0 }), is = 1;
} catch {
}
export {
  os as CFI,
  as as EPUB,
  ls as MOBI,
  cs as isMOBI,
  hs as makeComicBook,
  us as makeFB2,
  fs as search,
  ds as unzlibSync
};
