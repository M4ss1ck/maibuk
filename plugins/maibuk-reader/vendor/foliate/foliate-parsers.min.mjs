const Vt = (s, t) => s.map((e, n, r) => t(e, n, r) ? n : null).filter((e) => e != null), kt = (s, t) => [-1, ...t, s.length].reduce(({ xs: e, a: n }, r) => ({ xs: e?.concat([s.slice(n + 1, r)]) ?? [], a: r }), {}).xs, Kt = (s, t) => s.slice(0, -1).concat([s[s.length - 1].concat(t[0])]).concat(t.slice(1)), at = /\d/, it = /^epubcfi\((.*)\)$/, wt = (s) => s.replace(/[\^[\](),;=]/g, "^$&"), Mt = (s) => it.test(s) ? s : `epubcfi(${s})`, Wt = (s) => s.match(it)?.[1] ?? s, Yt = (s) => (...t) => `epubcfi(${s(...t.map((e) => e.match(it)?.[1] ?? e))})`, Zt = Yt((...s) => s.join("!")), Jt = (s) => {
  const t = [];
  let e, n, r = "";
  const i = (a) => (t.push(a), e = null, r = ""), o = (a) => (r += a, n = !1);
  for (const a of Array.from(s.trim()).concat("")) {
    if (a === "^" && !n) {
      n = !0;
      continue;
    }
    if (e === "!") i(["!"]);
    else if (e === ",") i([","]);
    else if (e === "/" || e === ":")
      if (at.test(a)) {
        o(a);
        continue;
      } else i([e, parseInt(r)]);
    else if (e === "~")
      if (at.test(a) || a === ".") {
        o(a);
        continue;
      } else i(["~", parseFloat(r)]);
    else if (e === "@") {
      if (a === ":") {
        i(["@", parseFloat(r)]), e = "@";
        continue;
      }
      if (at.test(a) || a === ".") {
        o(a);
        continue;
      } else i(["@", parseFloat(r)]);
    } else if (e === "[") {
      a === ";" && !n ? (i(["[", r]), e = ";") : a === "," && !n ? (i(["[", r]), e = "[") : a === "]" && !n ? i(["[", r]) : o(a);
      continue;
    } else if (e?.startsWith(";")) {
      a === "=" && !n ? (e = `;${r}`, r = "") : a === ";" && !n ? (i([e, r]), e = ";") : a === "]" && !n ? i([e, r]) : o(a);
      continue;
    }
    (a === "/" || a === ":" || a === "~" || a === "@" || a === "[" || a === "!" || a === ",") && (e = a);
  }
  return t;
}, Bt = (s, t) => Vt(s, ([e]) => e === t), Qt = (s) => {
  const t = [];
  let e;
  for (const [n, r] of s) {
    if (n === "/") t.push({ index: r });
    else {
      const i = t[t.length - 1];
      if (n === ":") i.offset = r;
      else if (n === "~") i.temporal = r;
      else if (n === "@") i.spatial = (i.spatial ?? []).concat(r);
      else if (n === ";s") i.side = r;
      else if (n === "[")
        if (e === "/" && r) i.id = r;
        else {
          i.text = (i.text ?? []).concat(r);
          continue;
        }
    }
    e = n;
  }
  return t;
}, xt = (s) => kt(s, Bt(s, "!")).map(Qt), H = (s) => {
  const t = Jt(Wt(s)), e = Bt(t, ",");
  if (!e.length) return xt(t);
  const [n, r, i] = kt(t, e).map(xt);
  return { parent: n, start: r, end: i };
}, te = ({ index: s, id: t, offset: e, temporal: n, spatial: r, text: i, side: o }) => {
  const a = o ? `;s=${o}` : "";
  return `/${s}` + (t ? `[${wt(t)}${a}]` : "") + (e != null && s % 2 ? `:${e}` : "") + (n ? `~${n}` : "") + (r ? `@${r.join(":")}` : "") + (i || !t && o ? "[" + (i?.map(wt)?.join(",") ?? "") + a + "]" : "");
}, Ot = (s) => s.parent ? [s.parent, s.start, s.end].map(Ot).join(",") : s.map((t) => t.map(te).join("")).join("!"), V = (s) => Mt(Ot(s)), B = (s, t) => typeof s == "string" ? V(B(H(s), t)) : s.parent ? Kt(s.parent, s[t ? "end" : "start"]) : s, $t = (s, t) => {
  typeof s == "string" && (s = H(s)), typeof t == "string" && (t = H(t)), s = B(s), t = B(t, !0);
  const e = s[s.length - 1], n = t[t.length - 1], r = [], i = [], o = [];
  let a = !0;
  const l = Math.max(e.length, n.length);
  for (let c = 0; c < l; c++) {
    const h = e[c], d = n[c];
    a &&= h?.index === d?.index && !h?.offset && !d?.offset, a ? r.push(h) : (h && i.push(h), d && o.push(d));
  }
  const u = s.slice(0, -1).concat([r]);
  return V({ parent: u, start: [i], end: [o] });
}, lt = (s, t) => {
  if (typeof s == "string" && (s = H(s)), typeof t == "string" && (t = H(t)), s.start || t.start) return lt(B(s), B(t)) || lt(B(s, !0), B(t, !0));
  for (let e = 0; e < Math.max(s.length, t.length); e++) {
    const n = s[e] ?? [], r = t[e] ?? [], i = Math.max(n.length, r.length) - 1;
    for (let o = 0; o <= i; o++) {
      const a = n[o], l = r[o];
      if (!a) return -1;
      if (!l || a.index > l.index) return 1;
      if (a.index < l.index) return -1;
      if (o === i) {
        if (a.offset > l.offset) return 1;
        if (a.offset < l.offset) return -1;
      }
    }
  }
  return 0;
}, ut = ({ nodeType: s }) => s === 3 || s === 4, Q = ({ nodeType: s }) => s === 1, Nt = (s, t) => {
  const e = Array.from(s.childNodes).filter((n) => ut(n) || Q(n));
  return t ? e.map((n) => {
    const r = t(n);
    return r === NodeFilter.FILTER_REJECT ? null : r === NodeFilter.FILTER_SKIP ? Nt(n, t) : n;
  }).flat().filter((n) => n) : e;
}, yt = (s, t) => {
  const e = Nt(s, t).reduce((n, r) => {
    let i = n[n.length - 1];
    return i ? ut(r) ? Array.isArray(i) ? i.push(r) : ut(i) ? n[n.length - 1] = [i, r] : n.push(r) : Q(i) ? n.push(null, r) : n.push(r) : n.push(r), n;
  }, []);
  return Q(e[0]) && e.unshift("first"), Q(e[e.length - 1]) && e.push("last"), e.unshift("before"), e.push("after"), e;
}, ht = (s, t, e) => {
  const { id: n } = t[t.length - 1];
  if (n) {
    const o = s.ownerDocument.getElementById(n);
    if (o) return { node: o, offset: 0 };
  }
  for (const { index: o } of t) {
    const a = s ? yt(s, e)[o] : null;
    if (a === "first") return { node: s.firstChild ?? s };
    if (a === "last") return { node: s.lastChild ?? s };
    if (a === "before") return { node: s, before: !0 };
    if (a === "after") return { node: s, after: !0 };
    s = a;
  }
  const { offset: r } = t[t.length - 1];
  if (!Array.isArray(s)) return { node: s, offset: r };
  let i = 0;
  for (const o of s) {
    const { length: a } = o.nodeValue;
    if (i + a >= r) return { node: o, offset: r - i };
    i += a;
  }
}, nt = (s, t, e) => {
  let { id: n, parentNode: r } = s;
  for (; e && r && r !== s.ownerDocument.documentElement && e(r) === NodeFilter.FILTER_SKIP; )
    r = r.parentNode;
  const i = yt(r, e), o = i.findIndex((u) => Array.isArray(u) ? u.some((c) => c === s) : u === s), a = i[o];
  if (Array.isArray(a)) {
    let u = 0;
    for (const c of a)
      if (c === s) {
        u += t;
        break;
      } else u += c.nodeValue.length;
    t = u;
  }
  const l = { id: n, index: o, offset: t };
  return (r !== s.ownerDocument.documentElement ? nt(r, null, e).concat(l) : [l]).filter((u) => u.index !== -1);
}, ee = (s, t) => {
  const { startContainer: e, startOffset: n, endContainer: r, endOffset: i } = s, o = nt(e, n, t);
  if (s.collapsed) return V([o]);
  const a = nt(r, i, t);
  return $t([o], [a]);
}, Ut = (s, t, e) => {
  const n = B(t), r = B(t, !0), i = s.documentElement, o = ht(i, n[0], e), a = ht(i, r[0], e), l = s.createRange();
  return o.before ? l.setStartBefore(o.node) : o.after ? l.setStartAfter(o.node) : l.setStart(o.node, o.offset), a.before ? l.setEndBefore(a.node) : a.after ? l.setEndAfter(a.node) : l.setEnd(a.node, a.offset), l;
}, Dt = (s) => {
  const t = [], { parentNode: e } = s[0], n = nt(e);
  for (const [r, i] of yt(e).entries()) {
    const o = s[t.length];
    i === o && t.push(V([n.concat({ id: o.id, index: r })]));
  }
  return t;
}, dt = (s, t) => ht(s.documentElement, B(t)).node, Ft = {
  fromIndex: (s) => Mt(`/6/${(s + 1) * 2}`),
  toIndex: (s) => s?.at(-1).index / 2 - 1
}, ne = (s) => {
  const [t] = H(s), e = t.shift();
  return t.shift(), V([[{ index: 6 }, e], t]);
}, se = ({ spine_index: s, start_cfi: t, end_cfi: e }) => {
  const n = Ft.fromIndex(s) + "!";
  return $t(n + t.slice(2), n + e.slice(2));
}, dn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  collapse: B,
  compare: lt,
  fake: Ft,
  fromCalibreHighlight: se,
  fromCalibrePos: ne,
  fromElements: Dt,
  fromRange: ee,
  isCFI: it,
  joinIndir: Zt,
  parse: H,
  toElement: dt,
  toRange: Ut
}, Symbol.toStringTag, { value: "Module" })), T = {
  CONTAINER: "urn:oasis:names:tc:opendocument:xmlns:container",
  XHTML: "http://www.w3.org/1999/xhtml",
  OPF: "http://www.idpf.org/2007/opf",
  EPUB: "http://www.idpf.org/2007/ops",
  DC: "http://purl.org/dc/elements/1.1/",
  ENC: "http://www.w3.org/2001/04/xmlenc#",
  NCX: "http://www.daisy.org/z3986/2005/ncx/",
  XLINK: "http://www.w3.org/1999/xlink",
  SMIL: "http://www.w3.org/ns/SMIL"
}, L = {
  XML: "application/xml",
  NCX: "application/x-dtbncx+xml",
  XHTML: "application/xhtml+xml",
  HTML: "text/html",
  CSS: "text/css",
  SVG: "image/svg+xml",
  JS: /\/(x-)?(javascript|ecmascript)/
}, F = {
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
}, re = {
  art: "artist",
  aut: "author",
  clr: "colorist",
  edt: "editor",
  ill: "illustrator",
  nrt: "narrator",
  trl: "translator",
  pbl: "publisher"
}, ie = {
  "02": "isbn",
  "06": "doi",
  15: "isbn",
  26: "doi",
  34: "issn"
}, ft = (s) => s.toLowerCase().replace(/[-:](.)/g, (t, e) => e.toUpperCase()), oe = (s) => s ? s.replace(/[\t\n\f\r ]+/g, " ").replace(/^[\t\n\f\r ]+/, "").replace(/[\t\n\f\r ]+$/, "") : "", ae = (s, t, e) => e ? (n) => n.getAttribute(s)?.split(/\s/)?.includes(t) : typeof t == "function" ? (n) => t(n.getAttribute(s)) : (n) => n.getAttribute(s) === t, tt = (...s) => (t) => t ? Object.fromEntries(s.map((e) => [ft(e), t.getAttribute(e)])) : null, N = (s) => oe(s?.textContent), K = (s, t) => {
  const e = s.lookupNamespaceURI(null) === t || s.lookupPrefix(t), n = e ? (r, i) => (o) => o.namespaceURI === t && o.localName === i : (r, i) => (o) => o.localName === i;
  return {
    $: (r, i) => [...r.children].find(n(r, i)),
    $$: (r, i) => [...r.children].filter(n(r, i)),
    $$$: e ? (r, i) => [...r.getElementsByTagNameNS(t, i)] : (r, i) => [...r.getElementsByTagName(i)]
  };
}, z = (s, t) => {
  try {
    if (t.includes(":")) return new URL(s, t);
    const e = "https://invalid.invalid/", n = new URL(s, e + t);
    return n.search = "", decodeURI(n.href.replace(e, ""));
  } catch (e) {
    return console.warn(e), s;
  }
}, Ht = (s) => /^(?!blob)\w+:/i.test(s), ce = (s, t) => {
  if (!s) return t;
  const e = s.replace(/\/$/, "").split("/"), n = t.replace(/\/$/, "").split("/"), r = (e.length > n.length ? e : n).findIndex((i, o) => e[o] !== n[o]);
  return r < 0 ? "" : Array(e.length - r).fill("..").concat(n.slice(r)).join("/");
}, le = (s) => s.slice(0, s.lastIndexOf("/") + 1), G = async (s, t, e) => {
  const n = [];
  s.replace(t, (...i) => (n.push(i), null));
  const r = [];
  for (const i of n) r.push(await e(...i));
  return s.replace(t, () => r.shift());
}, ue = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), pt = (s) => {
  for (const [e, n] of Object.entries(s))
    n == null ? delete s[e] : Array.isArray(n) ? (s[e] = n.filter((r) => r).map((r) => typeof r == "object" && !Array.isArray(r) ? pt(r) : r), s[e].length ? s[e].length === 1 && (s[e] = s[e][0]) : delete s[e]) : typeof n == "object" && (s[e] = pt(n), Object.keys(n).length || delete s[e]);
  const t = Object.keys(s);
  return t.length === 1 && t[0] === "name" ? s[t[0]] : s;
}, he = (s) => {
  const t = new Map(Object.entries(F)), e = s.documentElement.getAttributeNS(T.EPUB, "prefix") || s.documentElement.getAttribute("prefix");
  if (e) for (const [, n, r] of e.matchAll(/(.+): +(.+)[ \t\r\n]*/g)) t.set(n, r);
  return t;
}, St = (s, t) => {
  if (!s) return null;
  const [e, n] = s.split(":"), r = n ? e : null, i = n || e, o = t.get(r);
  return o ? o + i : null;
}, de = (s) => {
  const { $: t } = K(s, T.OPF), e = t(s.documentElement, "metadata"), n = Object.groupBy(e.children, (m) => m.namespaceURI === T.DC ? "dc" : m.namespaceURI === T.OPF && m.localName === "meta" ? m.hasAttribute("name") ? "legacyMeta" : "meta" : ""), r = e.getAttribute("xml:lang") ?? s.documentElement.getAttribute("xml:lang") ?? "und", i = he(s), o = (m) => {
    const x = m.getAttribute("property"), v = m.getAttribute("scheme");
    return {
      property: St(x, i) ?? x,
      scheme: St(v, i) ?? v,
      lang: m.getAttribute("xml:lang"),
      value: N(m),
      props: l(m),
      // `opf:` attributes from EPUB 2 & EPUB 3.1 (removed in EPUB 3.2)
      attrs: Object.fromEntries(Array.from(m.attributes).filter((E) => E.namespaceURI === T.OPF).map((E) => [E.localName, E.value]))
    };
  }, a = Map.groupBy(n.meta ?? [], (m) => m.getAttribute("refines")), l = (m) => {
    const x = a.get(m ? "#" + m.getAttribute("id") : null);
    return x ? Object.groupBy(x.map(o), (v) => v.property) : null;
  }, u = Object.fromEntries(Object.entries(Object.groupBy(n.dc, (m) => m.localName)).map(([m, x]) => [m, x.map(o)])), c = l() ?? {}, h = Object.fromEntries(n.legacyMeta?.map((m) => [m.getAttribute("name"), m.getAttribute("content")]) ?? []), d = (m) => m?.[0]?.value, f = (m, x) => d(m?.props?.[x]), p = (m) => {
    if (!m) return null;
    const x = m.props?.["alternate-script"] ?? [], v = m.attrs["alt-rep"];
    if (!x.length && (!m.lang || m.lang === r) && !v) return m.value;
    const E = { [m.lang ?? r]: m.value };
    v && (E[m.attrs["alt-rep-lang"]] = v);
    for (const O of x) E[O.lang] ??= O.value;
    return E;
  }, g = (m) => m ? {
    name: p(m),
    sortAs: p(m.props?.["file-as"]?.[0]) ?? m.attrs["file-as"],
    role: m.props?.role?.filter((x) => x.scheme === F.marc + "relators")?.map((x) => x.value) ?? [m.attrs.role],
    code: f(m, "term") ?? m.attrs.term,
    scheme: f(m, "authority") ?? m.attrs.authority
  } : null, y = (m) => ({
    name: p(m),
    // NOTE: webpub requires number but EPUB allows values like "2.2.1"
    position: d(m.props?.["group-position"])
  }), b = (m) => {
    const { value: x } = m;
    if (/^urn:/i.test(x)) return x;
    if (/^doi:/i.test(x)) return `urn:${x}`;
    const v = m.props?.["identifier-type"];
    if (!v) {
      const E = m.attrs.scheme;
      return E ? /^(doi|isbn|uuid)$/i.test(E) ? `urn:${E}:${x}` : { scheme: E, value: x } : x;
    }
    if (v.scheme === F.onix + "codelist5") {
      const E = ie[v.value];
      if (E) return `urn:${E}:${x}`;
    }
    return x;
  }, w = Object.groupBy(
    c["belongs-to-collection"] ?? [],
    (m) => f(m, "collection-type") === "series" ? "series" : "collection"
  ), A = u.title?.find((m) => f(m, "title-type") === "main") ?? u.title?.[0], S = {
    identifier: Pt(s),
    title: p(A),
    sortAs: p(A?.props?.["file-as"]?.[0]) ?? A?.attrs?.["file-as"] ?? h?.["calibre:title_sort"],
    subtitle: u.title?.find((m) => f(m, "title-type") === "subtitle")?.value,
    language: u.language?.map((m) => m.value),
    description: d(u.description),
    publisher: u.publisher?.map(g),
    published: u.date?.find((m) => m.attrs.event === "publication")?.value ?? d(u.date),
    modified: d(c[F.dcterms + "modified"]) ?? u.date?.find((m) => m.attrs.event === "modification")?.value,
    subject: u.subject?.map(g),
    belongsTo: {
      collection: w.collection?.map(y),
      series: w.series?.map(y) ?? h?.["calibre:series"] ? {
        name: h?.["calibre:series"],
        position: parseFloat(h?.["calibre:series_index"])
      } : null
    },
    altIdentifier: u.identifier?.map(b),
    source: u.source?.map(b),
    // NOTE: not in webpub schema
    rights: d(u.rights),
    // NOTE: not in webpub schema
    pageBreakSource: d(c.pageBreakSource)
    // NOTE: not in webpub schema
  }, M = (m) => (x) => {
    const v = new Set(x.role?.map((E) => re[E] ?? m));
    return [v.size ? v : [m], x];
  };
  for (const [m, x] of [].concat(
    u.creator?.map(g)?.map(M("author")) ?? [],
    u.contributor?.map(g)?.map(M("contributor")) ?? []
  ))
    for (const v of m)
      S[v] ? S[v].push(x) : S[v] = [x];
  pt(S), S.altIdentifier === S.identifier && delete S.altIdentifier;
  const P = {}, U = {};
  for (const [m, x] of Object.entries(c))
    m.startsWith(F.rendition) ? P[ft(m.replace(F.rendition, ""))] = d(x) : m.startsWith(F.media) && (U[ft(m.replace(F.media, ""))] = d(x));
  return U.duration && (U.duration = gt(U.duration)), { metadata: S, rendition: P, media: U };
}, fe = (s, t = (e) => e) => {
  const { $: e, $$: n, $$$: r } = K(s, T.XHTML), i = (p) => p ? decodeURI(t(p)) : null, o = (p) => (g) => {
    const y = e(g, "a") ?? e(g, "span"), b = e(g, "ol"), w = i(y?.getAttribute("href")), S = { label: N(y) || y?.getAttribute("title"), href: w, subitems: a(b) };
    return p && (S.type = y?.getAttributeNS(T.EPUB, "type")?.split(/\s/)), S;
  }, a = (p, g) => p ? n(p, "li").map(o(g)) : null, l = (p, g) => a(e(p, "ol"), g), u = r(s, "nav");
  let c = null, h = null, d = null, f = [];
  for (const p of u) {
    const g = p.getAttributeNS(T.EPUB, "type")?.split(/\s/) ?? [];
    g.includes("toc") ? c ??= l(p) : g.includes("page-list") ? h ??= l(p) : g.includes("landmarks") ? d ??= l(p, !0) : f.push({
      label: N(p.firstElementChild),
      type: g,
      list: l(p)
    });
  }
  return { toc: c, pageList: h, landmarks: d, others: f };
}, pe = (s, t = (e) => e) => {
  const { $: e, $$: n } = K(s, T.NCX), r = (l) => l ? decodeURI(t(l)) : null, i = (l) => {
    const u = e(l, "navLabel"), c = e(l, "content"), h = N(u), d = r(c.getAttribute("src"));
    if (l.localName === "navPoint") {
      const f = n(l, "navPoint");
      return { label: h, href: d, subitems: f.length ? f.map(i) : null };
    }
    return { label: h, href: d };
  }, o = (l, u) => n(l, u).map(i), a = (l, u) => {
    const c = e(s.documentElement, l);
    return c ? o(c, u) : null;
  };
  return {
    toc: a("navMap", "navPoint"),
    pageList: a("pageList", "pageTarget"),
    others: n(s.documentElement, "navList").map((l) => ({
      label: N(e(l, "navLabel")),
      list: o(l, "navTarget")
    }))
  };
}, gt = (s) => {
  if (!s) return;
  const t = s.split(":").map((o) => parseFloat(o));
  if (t.length === 3) {
    const [o, a, l] = t;
    return o * 60 * 60 + a * 60 + l;
  }
  if (t.length === 2) {
    const [o, a] = t;
    return o * 60 + a;
  }
  const [e, n] = s.split(/(?=[^\d.])/);
  return parseFloat(e) * (n === "h" ? 3600 : n === "min" ? 60 : n === "ms" ? 1e-3 : 1);
};
class ge extends EventTarget {
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
  async #f(t) {
    if (this.#n === t) return;
    const e = await this.loadXML(t.href), n = (o) => o ? z(o, t.href) : null, { $: r, $$$: i } = K(e, T.SMIL);
    this.#r = -1, this.#i = -1, this.#t = i(e, "par").reduce((o, a) => {
      const l = n(r(a, "text")?.getAttribute("src")), u = r(a, "audio");
      if (!l || !u) return o;
      const c = n(u.getAttribute("src")), h = gt(u.getAttribute("clipBegin")), d = gt(u.getAttribute("clipEnd")), f = o.at(-1);
      return f?.src === c ? f.items.push({ text: l, begin: h, end: d }) : o.push({ src: c, items: [{ text: l, begin: h, end: d }] }), o;
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
  async #d(t, e) {
    this.#m(), this.#r = t, this.#i = e;
    const n = this.#c?.src;
    if (!n || !this.#l) return this.start(this.#e + 1);
    const r = URL.createObjectURL(await this.book.loadBlob(n)), i = new Audio(r);
    this.#s = i, i.volume = this.#o, i.playbackRate = this.#a, i.addEventListener("timeupdate", () => {
      if (i.paused) return;
      const o = i.currentTime, { items: a } = this.#c;
      if (o > this.#l?.end && (this.#g(), this.#i === a.length - 1)) {
        this.#d(this.#r + 1, 0).catch((u) => this.#u(u));
        return;
      }
      const l = this.#i;
      for (; a[this.#i + 1]?.begin <= o; ) this.#i++;
      this.#i !== l && this.#p();
    }), i.addEventListener("error", () => this.#u(new Error(`Failed to load ${n}`))), i.addEventListener("playing", () => this.#p()), i.addEventListener("ended", () => {
      this.#g(), URL.revokeObjectURL(r), this.#s = null, this.#d(t + 1, 0).catch((o) => this.#u(o));
    }), this.#h === "paused" ? (this.#p(), i.currentTime = this.#l.begin ?? 0) : i.addEventListener("canplaythrough", () => {
      i.currentTime = this.#l.begin ?? 0, this.#h = "playing", i.play().catch((o) => this.#u(o));
    }, { once: !0 });
  }
  async start(t, e = () => !0) {
    this.#s?.pause();
    const n = this.book.sections[t], r = n?.id;
    if (!r) return;
    const { mediaOverlay: i } = n;
    if (!i) return this.start(t + 1);
    this.#e = t, await this.#f(i);
    for (let o = 0; o < this.#t.length; o++) {
      const { items: a } = this.#t[o];
      for (let l = 0; l < a.length; l++)
        if (a[l].text.split("#")[0] === r && e(a[l], l, a))
          return this.#d(o, l).catch((u) => this.#u(u));
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
    this.#i > 0 ? this.#d(this.#r, this.#i - 1) : this.#r > 0 ? this.#d(
      this.#r - 1,
      this.#t[this.#r - 1].items.length - 1
    ) : this.#e > 0 && this.start(this.#e - 1, (t, e, n) => e === n.length - 1);
  }
  next() {
    this.#d(this.#r, this.#i + 1);
  }
  setVolume(t) {
    this.#o = t, this.#s && (this.#s.volume = t);
  }
  setRate(t) {
    this.#a = t, this.#s && (this.#s.playbackRate = t);
  }
}
const me = /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/, ye = (s) => {
  for (const t of s.getElementsByTagNameNS(T.DC, "identifier")) {
    const [e] = N(t).split(":").slice(-1);
    if (me.test(e)) return e;
  }
  return "";
}, Pt = (s) => N(
  s.getElementById(s.documentElement.getAttribute("unique-identifier")) ?? s.getElementsByTagNameNS(T.DC, "identifier")[0]
), vt = async (s, t, e) => {
  const n = new Uint8Array(await e.slice(0, t).arrayBuffer());
  t = Math.min(t, n.length);
  for (var r = 0; r < t; r++) n[r] = n[r] ^ s[r % s.length];
  return new Blob([n, e.slice(t)], { type: e.type });
}, be = async (s) => {
  const t = new TextEncoder().encode(s), e = await globalThis.crypto.subtle.digest("SHA-1", t);
  return new Uint8Array(e);
}, we = (s = be) => ({
  "http://www.idpf.org/2008/embedding": {
    key: (t) => s(Pt(t).replaceAll(/[\u0020\u0009\u000d\u000a]/g, "")),
    decode: (t, e) => vt(t, 1040, e)
  },
  "http://ns.adobe.com/pdf/enc#RC": {
    key: (t) => {
      const e = ye(t).replaceAll("-", "");
      return Uint8Array.from({ length: 16 }, (n, r) => parseInt(e.slice(r * 2, r * 2 + 2), 16));
    },
    decode: (t, e) => vt(t, 1024, e)
  }
});
class xe {
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e;
  constructor(t) {
    this.#e = t;
  }
  async init(t, e) {
    if (!t) return;
    const n = Array.from(
      t.getElementsByTagNameNS(T.ENC, "EncryptedData"),
      (r) => ({
        algorithm: r.getElementsByTagNameNS(T.ENC, "EncryptionMethod")[0]?.getAttribute("Algorithm"),
        uri: r.getElementsByTagNameNS(T.ENC, "CipherReference")[0]?.getAttribute("URI")
      })
    );
    for (const { algorithm: r, uri: i } of n) {
      if (!this.#n.has(r)) {
        const o = this.#e[r];
        if (!o) {
          console.warn("Unknown encryption algorithm");
          continue;
        }
        const a = await o.key(e);
        this.#n.set(r, (l) => o.decode(a, l));
      }
      this.#t.set(i, r);
    }
  }
  getDecoder(t) {
    return this.#n.get(this.#t.get(t)) ?? ((e) => e);
  }
}
class Se {
  constructor({ opf: t, resolveHref: e }) {
    this.opf = t;
    const { $: n, $$: r, $$$: i } = K(t, T.OPF), o = n(t.documentElement, "manifest"), a = n(t.documentElement, "spine"), l = r(a, "itemref");
    this.manifest = r(o, "item").map(tt("href", "id", "media-type", "properties", "media-overlay")).map((c) => (c.href = e(c.href), c.properties = c.properties?.split(/\s/), c)), this.manifestById = new Map(this.manifest.map((c) => [c.id, c])), this.spine = l.map(tt("idref", "id", "linear", "properties")).map((c) => (c.properties = c.properties?.split(/\s/), c)), this.pageProgressionDirection = a.getAttribute("page-progression-direction"), this.navPath = this.getItemByProperty("nav")?.href, this.ncxPath = (this.getItemByID(a.getAttribute("toc")) ?? this.manifest.find((c) => c.mediaType === L.NCX))?.href;
    const u = n(t.documentElement, "guide");
    u && (this.guide = r(u, "reference").map(tt("type", "title", "href")).map(({ type: c, title: h, href: d }) => ({
      label: h,
      type: c.split(/\s/),
      href: e(d)
    }))), this.cover = this.getItemByProperty("cover-image") ?? this.getItemByID(i(t, "meta").find(ae("name", "cover"))?.getAttribute("content")) ?? this.getItemByHref(this.guide?.find((c) => c.type.includes("cover"))?.href), this.cfis = Dt(l);
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
    const e = H(t), n = (e.parent ?? e).shift();
    let r = dt(this.opf, n);
    r && r.nodeName !== "idref" && (n.at(-1).id = null, r = dt(this.opf, n));
    const i = r?.getAttribute("idref");
    return { index: this.spine.findIndex((l) => l.idref === i), anchor: (l) => Ut(l, e) };
  }
}
class ve {
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e = /* @__PURE__ */ new Map();
  eventTarget = new EventTarget();
  constructor({ loadText: t, loadBlob: e, resources: n }) {
    this.loadText = t, this.loadBlob = e, this.manifest = n.manifest, this.assets = n.manifest;
  }
  async createURL(t, e, n, r) {
    if (!e) return "";
    const i = { data: e, type: n };
    Object.defineProperty(i, "name", { value: t });
    const o = new CustomEvent("data", { detail: i });
    this.eventTarget.dispatchEvent(o);
    const a = await o.detail.data, l = await o.detail.type, u = URL.createObjectURL(new Blob([a], { type: l }));
    if (this.#t.set(t, u), this.#e.set(t, 1), r) {
      const c = this.#n.get(r);
      c ? c.push(t) : this.#n.set(r, [t]);
    }
    return u;
  }
  ref(t, e) {
    const n = this.#n.get(e);
    return n?.includes(t) || (this.#e.set(t, this.#e.get(t) + 1), n ? n.push(t) : this.#n.set(e, [t])), this.#t.get(t);
  }
  unref(t) {
    if (!this.#e.has(t)) return;
    const e = this.#e.get(t) - 1;
    if (e < 1) {
      URL.revokeObjectURL(this.#t.get(t)), this.#t.delete(t), this.#e.delete(t);
      const n = this.#n.get(t);
      if (n) for (; n.length; ) this.unref(n.pop());
      this.#n.delete(t);
    } else this.#e.set(t, e);
  }
  // load manifest item, recursively loading all resources as needed
  async loadItem(t, e = []) {
    if (!t) return null;
    const { href: n, mediaType: r } = t, i = L.JS.test(t.mediaType), o = { type: r, isScript: i, allow: !0 }, a = new CustomEvent("load", { detail: o });
    if (this.eventTarget.dispatchEvent(a), !await a.detail.allow) return null;
    const u = e.at(-1);
    if (this.#t.has(n)) return this.ref(n, u);
    if ((i || [L.XHTML, L.HTML, L.CSS, L.SVG].includes(r)) && e.every((d) => d !== n)) return this.loadReplaced(t, e);
    const h = Promise.resolve().then(() => this.loadBlob(n));
    return this.createURL(n, h, r, u);
  }
  async loadHref(t, e, n = []) {
    if (Ht(t)) return t;
    const r = z(t, e), i = this.manifest.find((o) => o.href === r);
    return i ? this.loadItem(i, n.concat(e)) : t;
  }
  async loadReplaced(t, e = []) {
    const { href: n, mediaType: r } = t, i = e.at(-1);
    let o = "";
    try {
      o = await this.loadText(n);
    } catch (l) {
      return this.createURL(n, Promise.reject(l), r, i);
    }
    if (!o) return null;
    if ([L.XHTML, L.HTML, L.SVG].includes(r)) {
      let l = new DOMParser().parseFromString(o, r);
      if (r === L.XHTML && (l.querySelector("parsererror") || !l.documentElement?.namespaceURI) && (console.warn(l.querySelector("parsererror")?.innerText ?? "Invalid XHTML"), t.mediaType = L.HTML, l = new DOMParser().parseFromString(o, t.mediaType)), [L.XHTML, L.SVG].includes(t.mediaType)) {
        let h = l.firstChild;
        for (; h instanceof ProcessingInstruction; ) {
          if (h.data) {
            const d = await G(
              h.data,
              /(?:^|\s*)(href\s*=\s*['"])([^'"]*)(['"])/i,
              (f, p, g, y) => this.loadHref(g, n, e).then((b) => `${p}${b}${y}`)
            );
            h.replaceWith(l.createProcessingInstruction(
              h.target,
              d
            ));
          }
          h = h.nextSibling;
        }
      }
      const u = async (h, d) => h.setAttribute(
        d,
        await this.loadHref(h.getAttribute(d), n, e)
      );
      for (const h of l.querySelectorAll("link[href]")) await u(h, "href");
      for (const h of l.querySelectorAll("[src]")) await u(h, "src");
      for (const h of l.querySelectorAll("[poster]")) await u(h, "poster");
      for (const h of l.querySelectorAll("object[data]")) await u(h, "data");
      for (const h of l.querySelectorAll("[*|href]:not([href])"))
        h.setAttributeNS(T.XLINK, "href", await this.loadHref(
          h.getAttributeNS(T.XLINK, "href"),
          n,
          e
        ));
      for (const h of l.querySelectorAll("[srcset]"))
        h.setAttribute("srcset", await G(
          h.getAttribute("srcset"),
          /(\s*)(.+?)\s*((?:\s[\d.]+[wx])+\s*(?:,|$)|,\s+|$)/g,
          (d, f, p, g) => this.loadHref(p, n, e).then((y) => `${f}${y}${g}`)
        ));
      for (const h of l.querySelectorAll("style"))
        h.textContent && (h.textContent = await this.replaceCSS(h.textContent, n, e));
      for (const h of l.querySelectorAll("[style]"))
        h.setAttribute(
          "style",
          await this.replaceCSS(h.getAttribute("style"), n, e)
        );
      const c = new XMLSerializer().serializeToString(l);
      return this.createURL(n, c, t.mediaType, i);
    }
    const a = r === L.CSS ? await this.replaceCSS(o, n, e) : await this.replaceString(o, n, e);
    return this.createURL(n, a, r, i);
  }
  async replaceCSS(t, e, n = []) {
    const r = await G(
      t,
      /url\(\s*["']?([^'"\n]*?)\s*["']?\s*\)/gi,
      (i, o) => this.loadHref(o, e, n).then((a) => `url("${a}")`)
    );
    return G(
      r,
      /@import\s*["']([^"'\n]*?)["']/gi,
      (i, o) => this.loadHref(o, e, n).then((a) => `@import "${a}"`)
    );
  }
  // find & replace all possible relative paths for all assets without parsing
  replaceString(t, e, n = []) {
    const r = /* @__PURE__ */ new Map(), i = this.assets.map((a) => {
      if (a.href === e) return;
      const l = ce(le(e), a.href), u = encodeURI(l), c = "/" + a.href, h = encodeURI(c), d = /* @__PURE__ */ new Set([l, u, c, h]);
      for (const f of d) r.set(f, a);
      return Array.from(d);
    }).flat().filter((a) => a);
    if (!i.length) return t;
    const o = new RegExp(i.map(ue).join("|"), "g");
    return G(t, o, async (a) => this.loadItem(
      r.get(a.replace(/^\//, "")),
      n.concat(e)
    ));
  }
  unloadItem(t) {
    this.unref(t?.href);
  }
  destroy() {
    for (const t of this.#t.values()) URL.revokeObjectURL(t);
  }
}
const Ee = (s, t) => s.getElementById(t) ?? s.querySelector(`[name="${CSS.escape(t)}"]`), Ae = (s) => {
  for (const t of s) {
    if (t === "page-spread-left" || t === "rendition:page-spread-left")
      return "left";
    if (t === "page-spread-right" || t === "rendition:page-spread-right")
      return "right";
    if (t === "rendition:page-spread-center") return "center";
  }
}, Te = (s) => s ? {
  fixedLayout: N(s.querySelector('option[name="fixed-layout"]')),
  openToSpread: N(s.querySelector('option[name="open-to-spread"]'))
} : null;
class fn {
  parser = new DOMParser();
  #t;
  #n;
  constructor({ loadText: t, loadBlob: e, getSize: n, sha1: r }) {
    this.loadText = t, this.loadBlob = e, this.getSize = n, this.#n = new xe(we(r));
  }
  async #e(t) {
    const e = await this.loadText(t);
    if (!e) return null;
    const n = this.parser.parseFromString(e, L.XML);
    if (n.querySelector("parsererror"))
      throw new Error(`XML parsing error: ${t}
${n.querySelector("parsererror").innerText}`);
    return n;
  }
  async init() {
    const t = await this.#e("META-INF/container.xml");
    if (!t) throw new Error("Failed to load container file");
    const e = Array.from(
      t.getElementsByTagNameNS(T.CONTAINER, "rootfile"),
      tt("full-path", "media-type")
    ).filter((d) => d.mediaType === "application/oebps-package+xml");
    if (!e.length) throw new Error("No package document defined in container");
    const n = e[0].fullPath, r = await this.#e(n);
    if (!r) throw new Error("Failed to load package document");
    const i = await this.#e("META-INF/encryption.xml");
    await this.#n.init(i, r), this.resources = new Se({
      opf: r,
      resolveHref: (d) => z(d, n)
    }), this.#t = new ve({
      loadText: this.loadText,
      loadBlob: (d) => Promise.resolve(this.loadBlob(d)).then(this.#n.getDecoder(d)),
      resources: this.resources
    }), this.transformTarget = this.#t.eventTarget, this.sections = this.resources.spine.map((d, f) => {
      const { idref: p, linear: g, properties: y = [] } = d, b = this.resources.getItemByID(p);
      return b ? {
        id: b.href,
        load: () => this.#t.loadItem(b),
        unload: () => this.#t.unloadItem(b),
        createDocument: () => this.loadDocument(b),
        size: this.getSize(b.href),
        cfi: this.resources.cfis[f],
        linear: g,
        pageSpread: Ae(y),
        resolveHref: (w) => z(w, b.href),
        mediaOverlay: b.mediaOverlay ? this.resources.getItemByID(b.mediaOverlay) : null
      } : (console.warn(`Could not find item with ID "${p}" in manifest`), null);
    }).filter((d) => d);
    const { navPath: o, ncxPath: a } = this.resources;
    if (o) try {
      const d = (p) => z(p, o), f = fe(await this.#e(o), d);
      this.toc = f.toc, this.pageList = f.pageList, this.landmarks = f.landmarks;
    } catch (d) {
      console.warn(d);
    }
    if (!this.toc && a) try {
      const d = (p) => z(p, a), f = pe(await this.#e(a), d);
      this.toc = f.toc, this.pageList = f.pageList;
    } catch (d) {
      console.warn(d);
    }
    this.landmarks ??= this.resources.guide;
    const { metadata: l, rendition: u, media: c } = de(r);
    this.metadata = l, this.rendition = u, this.media = c, this.dir = this.resources.pageProgressionDirection;
    const h = Te(
      await this.#e("META-INF/com.apple.ibooks.display-options.xml") ?? await this.#e("META-INF/com.kobobooks.display-options.xml")
    );
    return h && (h.fixedLayout === "true" && (this.rendition.layout ??= "pre-paginated"), h.openToSpread === "false" && (this.sections.find((d) => d.linear !== "no").pageSpread ??= this.dir === "rtl" ? "left" : "right")), this;
  }
  async loadDocument(t) {
    const e = await this.loadText(t.href);
    return this.parser.parseFromString(e, t.mediaType);
  }
  getMediaOverlay() {
    return new ge(this, this.#e.bind(this));
  }
  resolveCFI(t) {
    return this.resources.resolveCFI(t);
  }
  resolveHref(t) {
    const [e, n] = t.split("#"), r = this.resources.getItemByHref(decodeURI(e));
    return r ? { index: this.resources.spine.findIndex(({ idref: a }) => a === r.id), anchor: n ? (a) => Ee(a, n) : () => 0 } : null;
  }
  splitTOCHref(t) {
    return t?.split("#") ?? [];
  }
  getTOCFragment(t, e) {
    return t.getElementById(e) ?? t.querySelector(`[name="${CSS.escape(e)}"]`);
  }
  isExternal(t) {
    return Ht(t);
  }
  async getCover() {
    const t = this.resources?.cover;
    return t?.href ? new Blob([await this.loadBlob(t.href)], { type: t.mediaType }) : null;
  }
  async getCalibreBookmarks() {
    const t = await this.loadText("META-INF/calibre_bookmarks.txt"), e = "encoding=json+base64:";
    if (t?.startsWith(e)) {
      const n = atob(t.slice(e.length));
      return JSON.parse(n);
    }
  }
  destroy() {
    this.#t?.destroy();
  }
}
const j = (s) => {
  if (!s) return "";
  const t = document.createElement("textarea");
  return t.innerHTML = s, t.value;
}, $ = {
  XML: "application/xml",
  XHTML: "application/xhtml+xml",
  HTML: "text/html",
  CSS: "text/css",
  SVG: "image/svg+xml"
}, Le = {
  name: [0, 32, "string"],
  type: [60, 4, "string"],
  creator: [64, 4, "string"],
  numRecords: [76, 2, "uint"]
}, Ie = {
  compression: [0, 2, "uint"],
  numTextRecords: [8, 2, "uint"],
  recordSize: [10, 2, "uint"],
  encryption: [12, 2, "uint"]
}, Re = {
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
}, Ce = {
  resourceStart: [108, 4, "uint"],
  fdst: [192, 4, "uint"],
  numFdst: [196, 4, "uint"],
  frag: [248, 4, "uint"],
  skel: [252, 4, "uint"],
  guide: [260, 4, "uint"]
}, ke = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  count: [8, 4, "uint"]
}, Et = {
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
}, Me = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  numControlBytes: [8, 4, "uint"]
}, Be = {
  magic: [0, 4, "string"],
  offset1: [8, 4, "uint"],
  offset2: [12, 4, "uint"]
}, Oe = {
  magic: [0, 4, "string"],
  length: [4, 4, "uint"],
  numEntries: [8, 4, "uint"],
  codeLength: [12, 4, "uint"]
}, $e = {
  magic: [0, 4, "string"],
  numEntries: [8, 4, "uint"]
}, Ne = {
  flags: [8, 4, "uint"],
  dataStart: [12, 4, "uint"],
  keyLength: [16, 4, "uint"],
  keyStart: [20, 4, "uint"]
}, Ue = {
  1252: "windows-1252",
  65001: "utf-8"
}, At = {
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
}, De = {
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
}, mt = (s, t) => {
  const e = new s.constructor(s.length + t.length);
  return e.set(s), e.set(t, s.length), e;
}, jt = (s, t, e) => {
  const n = new s.constructor(s.length + t.length + e.length);
  return n.set(s), n.set(t, s.length), n.set(e, s.length + t.length), n;
}, Fe = new TextDecoder(), W = (s) => Fe.decode(s), I = (s) => {
  if (!s) return;
  const t = s.byteLength, e = t === 4 ? "getUint32" : t === 2 ? "getUint16" : "getUint8";
  return new DataView(s)[e](0);
}, k = (s, t) => Object.fromEntries(Array.from(Object.entries(s)).map(([e, [n, r, i]]) => [
  e,
  (i === "string" ? W : I)(t.slice(n, n + r))
])), bt = (s) => new TextDecoder(Ue[s]), Y = (s, t = 0) => {
  let e = 0, n = 0;
  for (const r of s.subarray(t, t + 4))
    if (e = e << 7 | (r & 127) >>> 0, n++, r & 128) break;
  return { value: e, length: n };
}, He = (s) => {
  let t = 0;
  for (const e of s.subarray(-4))
    e & 128 && (t = 0), t = t << 7 | e & 127;
  return t;
}, Xt = (s) => {
  let t = 0;
  for (; s > 0; s = s >> 1) (s & 1) === 1 && t++;
  return t;
}, Pe = (s) => {
  let t = 0;
  for (; (s & 1) === 0; ) s = s >> 1, t++;
  return t;
}, je = (s) => {
  let t = [];
  for (let e = 0; e < s.length; e++) {
    const n = s[e];
    if (n === 0) t.push(0);
    else if (n <= 8)
      for (const r of s.subarray(e + 1, (e += n) + 1))
        t.push(r);
    else if (n <= 127) t.push(n);
    else if (n <= 191) {
      const r = n << 8 | s[e++ + 1], i = (r & 16383) >>> 3, o = (r & 7) + 3;
      for (let a = 0; a < o; a++)
        t.push(t[t.length - i]);
    } else t.push(32, n ^ 128);
  }
  return Uint8Array.from(t);
}, Xe = (s, t) => {
  const e = t >> 3, n = t + 32, r = n >> 3;
  let i = 0n;
  for (let o = e; o <= r; o++)
    i = i << 8n | BigInt(s[o] ?? 0);
  return i >> 8n - BigInt(n & 7) & 0xffffffffn;
}, _e = async (s, t) => {
  const e = await t(s.huffcdic), { magic: n, offset1: r, offset2: i } = k(Be, e);
  if (n !== "HUFF") throw new Error("Invalid HUFF record");
  const o = Array.from({ length: 256 }, (c, h) => r + h * 4).map((c) => I(e.slice(c, c + 4))).map((c) => [c & 128, c & 31, c >>> 8]), a = [null].concat(Array.from({ length: 32 }, (c, h) => i + h * 8).map((c) => [
    I(e.slice(c, c + 4)),
    I(e.slice(c + 4, c + 8))
  ])), l = [];
  for (let c = 1; c < s.numHuffcdic; c++) {
    const h = await t(s.huffcdic + c), d = k(Oe, h);
    if (d.magic !== "CDIC") throw new Error("Invalid CDIC record");
    const f = Math.min(1 << d.codeLength, d.numEntries - l.length), p = h.slice(d.length);
    for (let g = 0; g < f; g++) {
      const y = I(p.slice(g * 2, g * 2 + 2)), b = I(p.slice(y, y + 2)), w = b & 32767, A = b & 32768, S = new Uint8Array(
        p.slice(y + 2, y + 2 + w)
      );
      l.push([S, A]);
    }
  }
  const u = (c) => {
    let h = new Uint8Array();
    const d = c.byteLength * 8;
    for (let f = 0; f < d; ) {
      const p = Number(Xe(c, f));
      let [g, y, b] = o[p >>> 24];
      if (!g) {
        for (; p >>> 32 - y < a[y][0]; )
          y += 1;
        b = a[y][1];
      }
      if ((f += y) > d) break;
      const w = b - (p >>> 32 - y);
      let [A, S] = l[w];
      S || (A = u(A), l[w] = [A, !0]), h = mt(h, A);
    }
    return h;
  };
  return u;
}, et = async (s, t) => {
  const e = await t(s), n = k(Et, e);
  if (n.magic !== "INDX") throw new Error("Invalid INDX record");
  const r = bt(n.encoding), i = e.slice(n.length), o = k(Me, i);
  if (o.magic !== "TAGX") throw new Error("Invalid TAGX section");
  const a = (o.length - 12) / 4, l = Array.from({ length: a }, (d, f) => new Uint8Array(i.slice(12 + f * 4, 12 + f * 4 + 4))), u = {};
  let c = 0;
  for (let d = 0; d < n.numCncx; d++) {
    const f = await t(s + n.numRecords + d + 1), p = new Uint8Array(f);
    for (let g = 0; g < p.byteLength; ) {
      const y = g, { value: b, length: w } = Y(p, g);
      g += w;
      const A = f.slice(g, g + b);
      g += b, u[c + y] = r.decode(A);
    }
    c += 65536;
  }
  const h = [];
  for (let d = 0; d < n.numRecords; d++) {
    const f = await t(s + 1 + d), p = new Uint8Array(f), g = k(Et, f);
    if (g.magic !== "INDX") throw new Error("Invalid INDX record");
    for (let y = 0; y < g.numRecords; y++) {
      const b = g.idxt + 4 + 2 * y, w = I(f.slice(b, b + 2)), A = I(f.slice(w, w + 1)), S = W(f.slice(w + 1, w + 1 + A)), M = [], P = w + 1 + A;
      let U = 0, m = P + o.numControlBytes;
      for (const [v, E, O, ot] of l) {
        if (ot & 1) {
          U++;
          continue;
        }
        const X = P + U, D = I(f.slice(X, X + 1)) & O;
        if (D === O)
          if (Xt(O) > 1) {
            const { value: q, length: _ } = Y(p, m);
            M.push([v, null, q, E]), m += _;
          } else M.push([v, 1, null, E]);
        else M.push([v, D >> Pe(O), null, E]);
      }
      const x = {};
      for (const [v, E, O, ot] of M) {
        const X = [];
        if (E != null)
          for (let D = 0; D < E * ot; D++) {
            const { value: q, length: _ } = Y(p, m);
            X.push(q), m += _;
          }
        else {
          let D = 0;
          for (; D < O; ) {
            const { value: q, length: _ } = Y(p, m);
            X.push(q), m += _, D += _;
          }
        }
        x[v] = X;
      }
      h.push({ name: S, tagMap: x });
    }
  }
  return { table: h, cncx: u };
}, ze = async (s, t) => {
  const { table: e, cncx: n } = await et(s, t), r = e.map(({ tagMap: o }, a) => ({
    index: a,
    offset: o[1]?.[0],
    size: o[2]?.[0],
    label: n[o[3]] ?? "",
    headingLevel: o[4]?.[0],
    pos: o[6],
    parent: o[21]?.[0],
    firstChild: o[22]?.[0],
    lastChild: o[23]?.[0]
  })), i = (o) => (o.firstChild == null || (o.children = r.filter((a) => a.parent === o.index).map(i)), o);
  return r.filter((o) => o.headingLevel === 0).map(i);
}, qe = (s, t) => {
  const { magic: e, count: n } = k(ke, s);
  if (e !== "EXTH") throw new Error("Invalid EXTH header");
  const r = bt(t), i = {};
  let o = 12;
  for (let a = 0; a < n; a++) {
    const l = I(s.slice(o, o + 4)), u = I(s.slice(o + 4, o + 8));
    if (l in At) {
      const [c, h, d] = At[l], f = s.slice(o + 8, o + u), p = h === "uint" ? I(f) : r.decode(f);
      d ? (i[c] ??= [], i[c].push(p)) : i[c] = p;
    }
    o += u;
  }
  return i;
}, Ge = async (s, t) => {
  const { flags: e, dataStart: n, keyLength: r, keyStart: i } = k(Ne, s), o = new Uint8Array(s.slice(n));
  if (e & 2) {
    const l = r === 16 ? 1024 : 1040, u = new Uint8Array(s.slice(i, i + r)), c = Math.min(l, o.length);
    for (var a = 0; a < c; a++) o[a] = o[a] ^ u[a % u.length];
  }
  if (e & 1) try {
    return await t(o);
  } catch (l) {
    console.warn(l), console.warn("Failed to decompress font");
  }
  return o;
}, pn = async (s) => W(await s.slice(60, 68).arrayBuffer()) === "BOOKMOBI";
class Ve {
  #t;
  #n;
  pdb;
  async open(t) {
    this.#t = t;
    const e = k(Le, await t.slice(0, 78).arrayBuffer());
    this.pdb = e;
    const n = await t.slice(78, 78 + e.numRecords * 8).arrayBuffer();
    this.#n = Array.from(
      { length: e.numRecords },
      (r, i) => I(n.slice(i * 8, i * 8 + 4))
    ).map((r, i, o) => [r, o[i + 1]]);
  }
  loadRecord(t) {
    const e = this.#n[t];
    if (!e) throw new RangeError("Record index out of bounds");
    return this.#t.slice(...e).arrayBuffer();
  }
  async loadMagic(t) {
    const e = this.#n[t][0];
    return W(await this.#t.slice(e, e + 4).arrayBuffer());
  }
}
class gn extends Ve {
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
      const n = this.headers.exth?.boundary;
      if (n < 4294967295) try {
        this.headers = this.#o(await super.loadRecord(n)), this.#t = n, e = !0;
      } catch (r) {
        console.warn(r), console.warn("Failed to open KF8; falling back to MOBI");
      }
    }
    return await this.#a(), e ? new nn(this).init() : new Ze(this).init();
  }
  #o(t) {
    const e = k(Ie, t), n = k(Re, t);
    if (n.magic !== "MOBI") throw new Error("Missing MOBI header");
    const { titleOffset: r, titleLength: i, localeLanguage: o, localeRegion: a } = n;
    n.title = t.slice(r, r + i);
    const l = De[o];
    n.language = l?.[a >> 2] ?? l?.[0];
    const u = n.exthFlag & 64 ? qe(t.slice(n.length + 16), n.encoding) : null, c = n.version >= 8 ? k(Ce, t) : null;
    return { palmdoc: e, mobi: n, exth: u, kf8: c };
  }
  async #a() {
    const { palmdoc: t, mobi: e } = this.headers;
    this.#e = bt(e.encoding), this.#r = new TextEncoder();
    const { compression: n } = t;
    if (this.#i = n === 1 ? (a) => a : n === 2 ? je : n === 17480 ? await _e(e, this.loadRecord.bind(this)) : null, !this.#i) throw new Error("Unknown compression type");
    const { trailingFlags: r } = e, i = r & 1, o = Xt(r >>> 1);
    this.#s = (a) => {
      for (let l = 0; l < o; l++) {
        const u = He(a);
        a = a.subarray(0, -u);
      }
      if (i) {
        const l = (a[a.length - 1] & 3) + 1;
        a = a.subarray(0, -l);
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
    const e = await super.loadRecord(this.#n + t), n = W(e.slice(0, 4));
    return n === "FONT" ? Ge(e, this.unzlib) : n === "VIDE" || n === "AUDI" ? e.slice(12) : e;
  }
  getNCX() {
    const t = this.headers.mobi.indx;
    if (t < 4294967295) return ze(t, this.loadRecord.bind(this));
  }
  getMetadata() {
    const { mobi: t, exth: e } = this.headers;
    return {
      identifier: t.uid.toString(),
      title: j(e?.title || this.decode(t.title)),
      author: e?.creator?.map(j),
      publisher: j(e?.publisher),
      language: e?.language ?? t.language,
      published: e?.date,
      description: j(e?.description),
      subject: e?.subject?.map(j),
      rights: j(e?.rights),
      contributor: e?.contributor
    };
  }
  async getCover() {
    const { exth: t } = this.headers, e = t?.coverOffset < 4294967295 ? t?.coverOffset : t?.thumbnailOffset < 4294967295 ? t?.thumbnailOffset : null;
    if (e != null) {
      const n = await this.loadResource(e);
      return new Blob([n]);
    }
  }
}
const Tt = /<\s*(?:mbp:)?pagebreak[^>]*>/gi, Ke = /<[^<>]+filepos=['"]{0,1}(\d+)[^<>]*>/gi, We = (s) => {
  let t = 0;
  for (; s; ) {
    const e = s.parentElement;
    if (e) {
      const n = e.tagName.toLowerCase();
      n === "p" ? t += 1.5 : n === "blockquote" && (t += 2);
    }
    s = e;
  }
  return t;
};
function Ye(s) {
  let e = "";
  for (let n = 0; n < s.length; n += 32768)
    e += String.fromCharCode.apply(null, s.subarray(n, n + 32768));
  return e;
}
class Ze {
  parser = new DOMParser();
  serializer = new XMLSerializer();
  #t = /* @__PURE__ */ new Map();
  #n = /* @__PURE__ */ new Map();
  #e = /* @__PURE__ */ new Map();
  #r;
  #i = [];
  #s = $.HTML;
  constructor(t) {
    this.mobi = t;
  }
  async init() {
    const t = [];
    for (let i = 0; i < this.mobi.headers.palmdoc.numTextRecords; i++) {
      const o = await this.mobi.loadText(i);
      t.push(o);
    }
    const e = t.reduce((i, o) => i + o.byteLength, 0), n = new Uint8Array(e);
    t.reduce((i, o) => (n.set(new Uint8Array(o), i), i + o.byteLength), 0);
    const r = Ye(n);
    this.#r = [0].concat(Array.from(r.matchAll(Tt), (i) => i.index)).map((i, o, a) => {
      const l = a[o + 1] ?? n.length;
      return { book: this, raw: n.subarray(i, l) };
    }).map((i, o, a) => (i.start = a[o - 1]?.end ?? 0, i.end = i.start + i.raw.byteLength, i)), this.sections = this.#r.map((i, o) => ({
      id: o,
      load: () => this.loadSection(i),
      createDocument: () => this.createDocument(i),
      size: i.end - i.start
    })), this.#i = [...new Set(
      Array.from(r.matchAll(Ke), (i) => i[1])
    )].map((i) => ({ filepos: i, number: Number(i) })).sort((i, o) => i.number - o.number);
    try {
      this.landmarks = await this.getGuide();
      const i = this.landmarks.find(({ type: o }) => o?.includes("toc"))?.href;
      if (i) {
        const { index: o } = this.resolveHref(i), a = await this.sections[o].createDocument();
        let l, u = 0, c = 0;
        const h = /* @__PURE__ */ new Map(), d = /* @__PURE__ */ new Map();
        this.toc = Array.from(a.querySelectorAll("a[filepos]")).reduce((f, p) => {
          const g = We(p), y = {
            label: p.innerText?.trim() ?? "",
            href: `filepos:${p.getAttribute("filepos")}`
          }, b = g > c ? u + 1 : g === c ? u : h.get(g) ?? Math.max(0, u - 1);
          if (b > u)
            l ? (l.subitems ??= [], l.subitems.push(y), d.set(b, l)) : f.push(y);
          else {
            const w = d.get(b);
            w ? w.subitems.push(y) : f.push(y);
          }
          return l = y, u = b, c = g, h.set(g, b), f;
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
    const e = await this.mobi.loadResource(t), n = URL.createObjectURL(new Blob([e]));
    return this.#t.set(t, n), n;
  }
  async loadRecindex(t) {
    return this.loadResource(Number(t) - 1);
  }
  async replaceResources(t) {
    for (const e of t.querySelectorAll("img[recindex]")) {
      const n = e.getAttribute("recindex");
      try {
        e.src = await this.loadRecindex(n);
      } catch {
        console.warn(`Failed to load image ${n}`);
      }
    }
    for (const e of t.querySelectorAll("[mediarecindex]")) {
      const n = e.getAttribute("mediarecindex"), r = e.getAttribute("recindex");
      try {
        e.src = await this.loadRecindex(n), r && (e.poster = await this.loadRecindex(r));
      } catch {
        console.warn(`Failed to load media ${n}`);
      }
    }
    for (const e of t.querySelectorAll("[filepos]")) {
      const n = e.getAttribute("filepos");
      e.href = `filepos:${n}`;
    }
  }
  async loadText(t) {
    if (this.#n.has(t)) return this.#n.get(t);
    const { raw: e } = t, n = this.#i.filter(({ number: o }) => o >= t.start && o < t.end).map((o) => ({ ...o, offset: o.number - t.start }));
    let r = e;
    n.length && (r = e.subarray(0, n[0].offset), n.forEach(({ filepos: o, offset: a }, l) => {
      const u = n[l + 1], c = this.mobi.encode(`<a id="filepos${o}"></a>`);
      r = jt(r, c, e.subarray(a, u?.offset));
    }));
    const i = this.mobi.decode(r).replaceAll(Tt, "");
    return this.#n.set(t, i), i;
  }
  async createDocument(t) {
    const e = await this.loadText(t);
    return this.parser.parseFromString(e, this.#s);
  }
  async loadSection(t) {
    if (this.#e.has(t)) return this.#e.get(t);
    const e = await this.createDocument(t), n = e.createElement("style");
    e.head.append(n), n.append(e.createTextNode(`blockquote {
            margin-block-start: 0;
            margin-block-end: 0;
            margin-inline-start: 1em;
            margin-inline-end: 0;
        }`)), await this.replaceResources(e);
    const r = this.serializer.serializeToString(e), i = URL.createObjectURL(new Blob([r], { type: this.#s }));
    return this.#e.set(t, i), i;
  }
  resolveHref(t) {
    const e = t.match(/filepos:(.*)/)[1], n = Number(e);
    return { index: this.#r.findIndex((o) => o.end > n), anchor: (o) => o.getElementById(`filepos${e}`) };
  }
  splitTOCHref(t) {
    const e = t.match(/filepos:(.*)/)[1], n = Number(e);
    return [this.#r.findIndex((i) => i.end > n), `filepos${e}`];
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
const _t = /kindle:(flow|embed):(\w+)(?:\?mime=(\w+\/[-+.\w]+))?/, Je = /kindle:pos:fid:(\w+):off:(\w+)/, Qe = (s) => {
  const [t, e, n] = s.match(_t).slice(1);
  return { resourceType: t, id: parseInt(e, 32), type: n };
}, Lt = (s) => {
  const [t, e] = s.match(Je).slice(1);
  return { fid: parseInt(t, 32), off: parseInt(e, 32) };
}, It = (s = 0, t = 0) => `kindle:pos:fid:${s.toString(32).toUpperCase().padStart(4, "0")}:off:${t.toString(32).toUpperCase().padStart(10, "0")}`, Rt = (s) => {
  const t = s.match(/\s(id|name|aid)\s*=\s*['"]([^'"]*)['"]/i);
  if (!t) return;
  const [, e, n] = t;
  return `[${e}="${CSS.escape(n)}"]`;
}, tn = async (s, t, e) => {
  const n = [];
  s.replace(t, (...i) => (n.push(i), null));
  const r = [];
  for (const i of n) r.push(await e(...i));
  return s.replace(t, () => r.shift());
}, en = (s) => {
  for (const t of s) {
    if (t === "page-spread-left" || t === "rendition:page-spread-left")
      return "left";
    if (t === "page-spread-right" || t === "rendition:page-spread-right")
      return "right";
    if (t === "rendition:page-spread-center") return "center";
  }
};
class nn {
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
  #f = -1;
  #c = $.XHTML;
  #l = /* @__PURE__ */ new Map();
  constructor(t) {
    this.mobi = t;
  }
  async init() {
    const t = this.mobi.loadRecord.bind(this.mobi), { kf8: e } = this.mobi.headers;
    try {
      const u = await t(e.fdst), c = k($e, u);
      if (c.magic !== "FDST") throw new Error("Missing FDST record");
      const h = Array.from(
        { length: c.numEntries },
        (d, f) => 12 + f * 8
      ).map((d) => [
        I(u.slice(d, d + 4)),
        I(u.slice(d + 4, d + 8))
      ]);
      this.#r.fdstTable = h, this.#s = h[h.length - 1][1];
    } catch {
    }
    const n = (await et(e.skel, t)).table.map(({ name: u, tagMap: c }, h) => ({
      index: h,
      name: u,
      numFrag: c[1][0],
      offset: c[6][0],
      length: c[6][1]
    })), r = await et(e.frag, t), i = r.table.map(({ name: u, tagMap: c }) => ({
      insertOffset: parseInt(u),
      selector: r.cncx[c[2][0]],
      index: c[4][0],
      offset: c[6][0],
      length: c[6][1]
    }));
    this.#r.skelTable = n, this.#r.fragTable = i, this.#i = n.reduce((u, c) => {
      const h = u[u.length - 1], d = h?.fragEnd ?? 0, f = d + c.numFrag, p = i.slice(d, f), g = c.length + p.map((b) => b.length).reduce((b, w) => b + w, 0), y = (h?.totalLength ?? 0) + g;
      return u.concat({ skel: c, frags: p, fragEnd: f, length: g, totalLength: y });
    }, []);
    const o = await this.getResourcesByMagic(["RESC", "PAGE"]), a = /* @__PURE__ */ new Map();
    if (o.RESC) {
      const u = await this.mobi.loadRecord(o.RESC), c = this.mobi.decode(u.slice(16)).replace(/\0/g, ""), h = c.search(/\?>/), d = `<package>${c.slice(h)}</package>`, f = this.parser.parseFromString(d, $.XML);
      for (const p of f.querySelectorAll("spine > itemref")) {
        const g = parseInt(p.getAttribute("skelid"));
        a.set(g, en(
          p.getAttribute("properties")?.split(" ") ?? []
        ));
      }
    }
    this.sections = this.#i.map((u, c) => u.frags.length ? {
      id: c,
      load: () => this.loadSection(u),
      createDocument: () => this.createDocument(u),
      size: u.length,
      pageSpread: a.get(c)
    } : { linear: "no" });
    try {
      const u = await this.mobi.getNCX(), c = ({ label: h, pos: d, children: f }) => {
        const [p, g] = d, y = It(p, g), b = this.#n.get(p);
        return b ? b.push(g) : this.#n.set(p, [g]), { label: j(h), href: y, subitems: f?.map(c) };
      };
      this.toc = u?.map(c), this.landmarks = await this.getGuide();
    } catch (u) {
      console.warn(u);
    }
    const { exth: l } = this.mobi.headers;
    return this.dir = l.pageProgressionDirection, this.rendition = {
      layout: l.fixedLayout === "true" ? "pre-paginated" : "reflowable",
      viewport: Object.fromEntries(l.originalResolution?.split("x")?.slice(0, 2)?.map((u, c) => [c ? "height" : "width", u]) ?? [])
    }, this.metadata = this.mobi.getMetadata(), this.getCover = this.mobi.getCover.bind(this.mobi), this;
  }
  // is this really the only way of getting to RESC, PAGE, etc.?
  async getResourcesByMagic(t) {
    const e = {}, n = this.mobi.headers.kf8.resourceStart, r = this.mobi.pdb.numRecords;
    for (let i = n; i < r; i++)
      try {
        const o = await this.mobi.loadMagic(i), a = t.find((l) => l === o);
        a && (e[a] = i);
      } catch {
      }
    return e;
  }
  async getGuide() {
    const t = this.mobi.headers.kf8.guide;
    if (t < 4294967295) {
      const e = this.mobi.loadRecord.bind(this.mobi), { table: n, cncx: r } = await et(t, e);
      return n.map(({ name: i, tagMap: o }) => ({
        label: r[o[1][0]] ?? "",
        type: i?.split(/\s/),
        href: It(o[6]?.[0] ?? o[3]?.[0])
      }));
    }
  }
  async loadResourceBlob(t) {
    const { resourceType: e, id: n, type: r } = Qe(t), i = e === "flow" ? await this.loadFlow(n) : await this.mobi.loadResource(n - 1), a = { data: [$.XHTML, $.HTML, $.CSS, $.SVG].includes(r) ? await this.replaceResources(this.mobi.decode(i)) : i, type: r }, l = new CustomEvent("data", { detail: a });
    this.transformTarget.dispatchEvent(l);
    const u = await l.detail.data, c = await l.detail.type, h = c === $.SVG ? this.parser.parseFromString(u, c) : null;
    return [
      new Blob([u], { newType: c }),
      // SVG wrappers need to be inlined
      // as browsers don't allow external resources when loading SVG as an image
      h?.getElementsByTagNameNS("http://www.w3.org/2000/svg", "image")?.length ? h.documentElement : null
    ];
  }
  async loadResource(t) {
    if (this.#t.has(t)) return this.#t.get(t);
    const [e, n] = await this.loadResourceBlob(t), r = n ? t : URL.createObjectURL(e);
    return n && this.#l.set(r, n), this.#t.set(t, r), r;
  }
  replaceResources(t) {
    const e = new RegExp(_t, "g");
    return tn(t, e, this.loadResource.bind(this));
  }
  // NOTE: there doesn't seem to be a way to access text randomly?
  // how to know the decompressed size of the records without decompressing?
  // 4096 is just the maximum size
  async loadRaw(t, e) {
    const n = e - this.#o.length, r = this.#s == null ? 1 / 0 : this.#s - this.#a.length - t;
    if (n < 0 || n < r) {
      for (; this.#o.length < e; ) {
        const o = ++this.#h, a = await this.mobi.loadText(o);
        this.#o = mt(this.#o, a);
      }
      return this.#o.slice(t, e);
    }
    for (; this.#s - this.#a.length > t; ) {
      const o = this.mobi.headers.palmdoc.numTextRecords - 1 - ++this.#f, a = await this.mobi.loadText(o);
      this.#a = mt(a, this.#a);
    }
    const i = this.#s - this.#a.length;
    return this.#a.slice(t - i, e - i);
  }
  loadFlow(t) {
    if (t < 4294967295)
      return this.loadRaw(...this.#r.fdstTable[t]);
  }
  async loadText(t) {
    const { skel: e, frags: n, length: r } = t, i = await this.loadRaw(e.offset, e.offset + r);
    let o = i.slice(0, e.length);
    for (const a of n) {
      const l = a.insertOffset - e.offset, u = e.length + a.offset, c = i.slice(u, u + a.length);
      o = jt(
        o.slice(0, l),
        c,
        o.slice(l)
      );
      const h = this.#n.get(a.index);
      if (h) for (const d of h) {
        const f = this.mobi.decode(c.slice(d)), p = Rt(f);
        this.#u(a.index, d, p);
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
    const e = await this.loadText(t), n = await this.replaceResources(e);
    let r = this.parser.parseFromString(n, this.#c);
    (r.querySelector("parsererror") || !r.documentElement?.namespaceURI) && (this.#c = $.HTML, r = this.parser.parseFromString(n, this.#c));
    for (const [o, a] of this.#l)
      for (const l of r.querySelectorAll(`img[src="${o}"]`))
        l.replaceWith(a);
    const i = URL.createObjectURL(
      new Blob([this.serializer.serializeToString(r)], { type: this.#c })
    );
    return this.#t.set(t, i), i;
  }
  getIndexByFID(t) {
    return this.#i.findIndex((e) => e.frags.some((n) => n.index === t));
  }
  #u(t, e, n) {
    const r = this.#e.get(t);
    if (r) r.set(e, n);
    else {
      const i = /* @__PURE__ */ new Map();
      this.#e.set(t, i), i.set(e, n);
    }
  }
  async resolveHref(t) {
    const { fid: e, off: n } = Lt(t), r = this.getIndexByFID(e);
    if (r < 0) return;
    const i = this.#e.get(e)?.get(n);
    if (i) return { index: r, anchor: (p) => p.querySelector(i) };
    const { skel: o, frags: a } = this.#i[r], l = a.find((p) => p.index === e), u = o.offset + o.length + l.offset, c = await this.loadRaw(u, u + l.length), h = this.mobi.decode(c.slice(n)), d = Rt(h);
    return this.#u(e, n, d), { index: r, anchor: (p) => p.querySelector(d) };
  }
  splitTOCHref(t) {
    const e = Lt(t);
    return [this.getIndexByFID(e.fid), e];
  }
  getTOCFragment(t, { fid: e, off: n }) {
    const r = this.#e.get(e)?.get(n);
    return t.querySelector(r);
  }
  isExternal(t) {
    return /^(?!blob|kindle)\w+:/i.test(t);
  }
  destroy() {
    for (const t of this.#t.values()) URL.revokeObjectURL(t);
  }
}
const zt = (s) => s ? s.replace(/[\t\n\f\r ]+/g, " ").replace(/^[\t\n\f\r ]+/, "").replace(/[\t\n\f\r ]+$/, "") : "", C = (s) => zt(s?.textContent), Z = {
  XLINK: "http://www.w3.org/1999/xlink",
  EPUB: "http://www.idpf.org/2007/ops"
}, st = {
  XML: "application/xml",
  XHTML: "application/xhtml+xml"
}, R = {
  strong: ["strong", "self"],
  emphasis: ["em", "self"],
  style: ["span", "self"],
  a: "anchor",
  strikethrough: ["s", "self"],
  sub: ["sub", "self"],
  sup: ["sup", "self"],
  code: ["code", "self"],
  image: "image"
}, sn = {
  tr: ["tr", {
    th: ["th", R, ["colspan", "rowspan", "align", "valign"]],
    td: ["td", R, ["colspan", "rowspan", "align", "valign"]]
  }, ["align"]]
}, qt = {
  epigraph: ["blockquote"],
  subtitle: ["h2", R],
  "text-author": ["p", R],
  date: ["p", R],
  stanza: "stanza"
}, rt = {
  title: ["header", {
    p: ["h1", R],
    "empty-line": ["br"]
  }],
  epigraph: ["blockquote", "self"],
  image: "image",
  annotation: ["aside"],
  section: ["section", "self"],
  p: ["p", R],
  poem: ["blockquote", qt],
  subtitle: ["h2", R],
  cite: ["blockquote", "self"],
  "empty-line": ["br"],
  table: ["table", sn],
  "text-author": ["p", R]
};
qt.epigraph.push(rt);
const rn = {
  image: "image",
  title: ["section", {
    p: ["h1", R],
    "empty-line": ["br"]
  }],
  epigraph: ["section", rt],
  section: ["section", rt]
};
class on {
  constructor(t) {
    this.fb2 = t, this.doc = document.implementation.createDocument(Z.XHTML, "html"), this.bins = new Map(Array.from(
      this.fb2.getElementsByTagName("binary"),
      (e) => [e.id, e]
    ));
  }
  getImageSrc(t) {
    const e = t.getAttributeNS(Z.XLINK, "href");
    if (!e) return "data:,";
    const [, n] = e.split("#");
    if (!n) return e;
    const r = this.bins.get(n);
    return r ? `data:${r.getAttribute("content-type")};base64,${r.textContent}` : e;
  }
  image(t) {
    const e = this.doc.createElement("img");
    return e.alt = t.getAttribute("alt"), e.title = t.getAttribute("title"), e.setAttribute("src", this.getImageSrc(t)), e;
  }
  anchor(t) {
    const e = this.convert(t, { a: ["a", R] });
    return e.setAttribute("href", t.getAttributeNS(Z.XLINK, "href")), t.getAttribute("type") === "note" && e.setAttributeNS(Z.EPUB, "epub:type", "noteref"), e;
  }
  stanza(t) {
    const e = this.convert(t, {
      stanza: ["p", {
        title: ["header", {
          p: ["strong", R],
          "empty-line": ["br"]
        }],
        subtitle: ["p", R]
      }]
    });
    for (const n of t.children) n.nodeName === "v" && (e.append(this.doc.createTextNode(n.textContent)), e.append(this.doc.createElement("br")));
    return e;
  }
  convert(t, e) {
    if (t.nodeType === 3) return this.doc.createTextNode(t.textContent);
    if (t.nodeType === 4) return this.doc.createCDATASection(t.textContent);
    if (t.nodeType === 8) return this.doc.createComment(t.textContent);
    const n = e?.[t.nodeName];
    if (!n) return null;
    if (typeof n == "string") return this[n](t);
    const [r, i, o] = n, a = this.doc.createElement(r);
    if (t.id && (a.id = t.id), a.classList.add(t.nodeName), Array.isArray(o)) for (const c of o) {
      const h = t.getAttribute(c);
      h && a.setAttribute(c, h);
    }
    const l = i === "self" ? e : i;
    let u = t.firstChild;
    for (; u; ) {
      const c = this.convert(u, l);
      c && a.append(c), u = u.nextSibling;
    }
    return a;
  }
}
const an = async (s) => {
  const t = await s.arrayBuffer(), e = new TextDecoder("utf-8").decode(t), n = new DOMParser(), r = n.parseFromString(e, st.XML), i = r.xmlEncoding || e.match(/^<\?xml\s+version\s*=\s*["']1.\d+"\s+encoding\s*=\s*["']([A-Za-z0-9._-]*)["']/)?.[1];
  if (i && i.toLowerCase() !== "utf-8") {
    const o = new TextDecoder(i).decode(t);
    return n.parseFromString(o, st.XML);
  }
  return r;
}, cn = URL.createObjectURL(new Blob([`
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
`], { type: "text/css" })), ln = (s) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
    <head><link href="${cn}" rel="stylesheet" type="text/css"/></head>
    <body>${s}</body>
</html>`, ct = "data-foliate-id", mn = async (s) => {
  const t = {}, e = await an(s), n = new on(e), r = (f) => e.querySelector(f), i = (f) => [...e.querySelectorAll(f)], o = (f) => {
    const p = C(f.querySelector("nickname"));
    if (p) return p;
    const g = C(f.querySelector("first-name")), y = C(f.querySelector("middle-name")), b = C(f.querySelector("last-name")), w = [g, y, b].filter((S) => S).join(" "), A = b ? [b, [g, y].filter((S) => S).join(" ")].join(", ") : null;
    return { name: w, sortAs: A };
  }, a = (f) => f?.getAttribute("value") ?? C(f), l = r("title-info annotation");
  if (t.metadata = {
    title: C(r("title-info book-title")),
    identifier: C(r("document-info id")),
    language: C(r("title-info lang")),
    author: i("title-info author").map(o),
    translator: i("title-info translator").map(o),
    contributor: i("document-info author").map(o).concat(i("document-info program-used").map(C)).map((f) => Object.assign(
      typeof f == "string" ? { name: f } : f,
      { role: "bkp" }
    )),
    publisher: C(r("publish-info publisher")),
    published: a(r("title-info date")),
    modified: a(r("document-info date")),
    description: l ? n.convert(
      l,
      { annotation: ["div", rt] }
    ).innerHTML : null,
    subject: i("title-info genre").map(C)
  }, r("coverpage image")) {
    const f = n.getImageSrc(r("coverpage image"));
    t.getCover = () => fetch(f).then((p) => p.blob());
  } else t.getCover = () => null;
  const u = Array.from(e.querySelectorAll("body"), (f) => {
    const p = n.convert(f, { body: ["body", rn] });
    return [Array.from(p.children, (g) => {
      const y = [g, ...g.querySelectorAll("[id]")].map((b) => b.id);
      return { el: g, ids: y };
    }), p];
  }), c = [], h = u[0][0].map(({ el: f, ids: p }) => {
    const g = Array.from(
      f.querySelectorAll(":scope > section > .title"),
      (y, b) => (y.setAttribute(ct, b), { title: C(y), index: b })
    );
    return { ids: p, titles: g, el: f };
  }).concat(u.slice(1).map(([f, p]) => {
    const g = f.map((y) => y.ids).flat();
    return p.classList.add("notesBodyType"), { ids: g, el: p, linear: "no" };
  })).map(({ ids: f, titles: p, el: g, linear: y }) => {
    const b = ln(g.outerHTML), w = new Blob([b], { type: st.XHTML }), A = URL.createObjectURL(w);
    c.push(A);
    const S = zt(
      g.querySelector(".title, .subtitle, p")?.textContent ?? (g.classList.contains("title") ? g.textContent : "")
    );
    return {
      ids: f,
      title: S,
      titles: p,
      load: () => A,
      createDocument: () => new DOMParser().parseFromString(b, st.XHTML),
      // doo't count image data as it'd skew the size too much
      size: w.size - Array.from(
        g.querySelectorAll("[src]"),
        (M) => M.getAttribute("src")?.length ?? 0
      ).reduce((M, P) => M + P, 0),
      linear: y
    };
  }), d = /* @__PURE__ */ new Map();
  return t.sections = h.map((f, p) => {
    const { ids: g, load: y, createDocument: b, size: w, linear: A } = f;
    for (const S of g) S && d.set(S, p);
    return { id: p, load: y, createDocument: b, size: w, linear: A };
  }), t.toc = h.map(({ title: f, titles: p }, g) => {
    const y = g.toString();
    return {
      label: f,
      href: y,
      subitems: p?.length ? p.map(({ title: b, index: w }) => ({
        label: b,
        href: `${y}#${w}`
      })) : null
    };
  }).filter((f) => f), t.resolveHref = (f) => {
    const [p, g] = f.split("#");
    return p ? { index: Number(p), anchor: (y) => y.querySelector(`[${ct}="${g}"]`) } : { index: d.get(g), anchor: (y) => y.getElementById(g) };
  }, t.splitTOCHref = (f) => f?.split("#")?.map((p) => Number(p)) ?? [], t.getTOCFragment = (f, p) => f.querySelector(`[${ct}="${p}"]`), t.isExternal = (f) => /^\w+:/i.test(f), t.destroy = () => {
    for (const f of c) URL.revokeObjectURL(f);
  }, t;
}, yn = ({ entries: s, loadBlob: t, getSize: e }, n) => {
  const r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), o = async (h) => {
    if (r.has(h)) return r.get(h);
    const d = URL.createObjectURL(await t(h)), f = URL.createObjectURL(
      new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin: 0"><img src="${d}"></body></html>`], { type: "text/html" })
    );
    return i.set(h, [d, f]), r.set(h, f), f;
  }, a = (h) => {
    i.get(h)?.forEach?.((d) => URL.revokeObjectURL(d)), i.delete(h), r.delete(h);
  }, l = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".jxl", ".avif"], u = s.map((h) => h.filename).filter((h) => l.some((d) => h.endsWith(d))).sort(new Intl.Collator([], { numeric: !0 }).compare);
  if (!u.length) throw new Error("No supported image files in archive");
  const c = {};
  return c.getCover = () => t(u[0]), c.metadata = { title: n.name }, c.sections = u.map((h) => ({
    id: h,
    load: () => o(h),
    unload: () => a(h),
    size: e(h)
  })), c.toc = u.map((h) => ({ label: h, href: h })), c.rendition = { layout: "pre-paginated" }, c.resolveHref = (h) => ({ index: c.sections.findIndex((d) => d.id === h) }), c.splitTOCHref = (h) => [h, null], c.getTOCFragment = (h) => h.documentElement, c.destroy = () => {
    for (const h of i.values())
      for (const d of h) URL.revokeObjectURL(d);
  }, c;
}, J = 50, Ct = (s) => s.replace(/\s+/g, " "), Gt = (s, { startIndex: t, startOffset: e, endIndex: n, endOffset: r }) => {
  const i = s[t], o = s[n], a = i === o ? i.slice(e, r) : i.slice(e) + s.slice(i + 1, o).join("") + o.slice(0, r), l = Ct(i.slice(0, e)).trimStart(), u = Ct(o.slice(r)).trimEnd(), c = l.length < J ? "" : "…", h = u.length < J ? "" : "…", d = `${c}${l.slice(-J)}`, f = `${u.slice(0, J)}${h}`;
  return { pre: d, match: a, post: f };
}, un = function* (s, t, e = {}) {
  const { locales: n = "en", sensitivity: r } = e, i = r === "variant", o = s.join(""), a = i ? o : o.toLocaleLowerCase(n), l = i ? t : t.toLocaleLowerCase(n), u = l.length;
  let c = -1, h = -1, d = 0;
  do
    if (c = a.indexOf(l, c + 1), c > -1) {
      for (; d <= c; ) d += s[++h].length;
      const f = h, p = c - (d - s[h].length), g = c + u;
      for (; d <= g; ) d += s[++h].length;
      const y = h, b = g - (d - s[h].length), w = { startIndex: f, startOffset: p, endIndex: y, endOffset: b };
      yield { range: w, excerpt: Gt(s, w) };
    }
  while (c > -1);
}, hn = function* (s, t, e = {}) {
  const { locales: n = "en", granularity: r = "word", sensitivity: i = "base" } = e;
  let o, a;
  try {
    o = new Intl.Segmenter(n, { usage: "search", granularity: r }), a = new Intl.Collator(n, { sensitivity: i });
  } catch (d) {
    console.warn(d), o = new Intl.Segmenter("en", { usage: "search", granularity: r }), a = new Intl.Collator("en", { sensitivity: i });
  }
  const l = Array.from(o.segment(t)).length, u = [];
  let c = 0, h = o.segment(s[c])[Symbol.iterator]();
  t: for (; c < s.length; ) {
    for (; u.length < l; ) {
      const { done: f, value: p } = h.next();
      if (f)
        if (c++, c < s.length) {
          h = o.segment(s[c])[Symbol.iterator]();
          continue;
        } else break t;
      const { index: g, segment: y } = p;
      if (/[^\p{Format}]/u.test(y)) {
        if (/\s/u.test(y)) {
          /\s/u.test(u[u.length - 1]?.segment) || u.push({ strIndex: c, index: g, segment: " " });
          continue;
        }
        p.strIndex = c, u.push(p);
      }
    }
    const d = u.map((f) => f.segment).join("");
    if (a.compare(t, d) === 0) {
      const f = c, p = u[u.length - 1], g = p.index + p.segment.length, y = u[0].strIndex, b = u[0].index, w = { startIndex: y, startOffset: b, endIndex: f, endOffset: g };
      yield { range: w, excerpt: Gt(s, w) };
    }
    u.shift();
  }
}, bn = (s, t, e) => {
  const { granularity: n = "grapheme", sensitivity: r = "base" } = e;
  return !Intl?.Segmenter || n === "grapheme" && (r === "variant" || r === "accent") ? un(s, t, e) : hn(s, t, e);
};
export {
  dn as CFI,
  fn as EPUB,
  gn as MOBI,
  pn as isMOBI,
  yn as makeComicBook,
  mn as makeFB2,
  bn as search
};
