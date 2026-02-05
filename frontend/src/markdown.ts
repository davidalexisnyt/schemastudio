import { Marked } from "marked";

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "code",
  "pre",
  "span",
  "div",
  "blockquote",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href"]),
};

function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const walk = (node: Node): void => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // Never remove structural elements that we need as containers
    if (tag === "body" || tag === "html" || tag === "head") {
      for (const child of Array.from(el.childNodes)) walk(child);
      return;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      const children = Array.from(el.childNodes);
      el.replaceWith(...children);
      children.forEach((c) => walk(c));
      return;
    }

    const allowedAttrs = ALLOWED_ATTRS[tag];
    if (allowedAttrs) {
      for (const a of Array.from(el.attributes)) {
        if (!allowedAttrs.has(a.name.toLowerCase())) el.removeAttribute(a.name);
      }

      const href = el.getAttribute("href");

      if (href && !/^#?[\w-]*$/.test(href) && !href.startsWith("/")) {
        try {
          const u = new URL(href);

          if (u.protocol !== "http:" && u.protocol !== "https:")
            el.removeAttribute("href");
        } catch {
          el.removeAttribute("href");
        }
      }
    } else {
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
    }

    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const markedInstance = new Marked();

/** Parse markdown to HTML and sanitize for safe display in text blocks. Never throws. */
export function markdownToHtml(md: string): string {
  if (!md?.trim()) return "";
  try {
    const raw = markedInstance.parse(md, { async: false });
    if (typeof raw !== "string") return escapeHtml(md);
    try {
      return sanitizeHtml(raw);
    } catch {
      return escapeHtml(md);
    }
  } catch {
    return escapeHtml(md);
  }
}

export interface MarkdownSvgLine {
  text: string;
  fontSize: number;
  fontWeight: string;
}

const HEADING_SCALE: Record<string, number> = {
  h1: 1.5,
  h2: 1.3,
  h3: 1.15,
  h4: 1.05,
  h5: 1,
  h6: 0.95,
};

function getTextContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  if (el.tagName.toLowerCase() === "br") return "\n";
  let out = "";
  for (const child of el.childNodes) out += getTextContent(child);
  return out;
}

function wrapTextToWidth(
  text: string,
  widthPx: number,
  fontSize: number,
  fontWeight: string,
  measureEl: HTMLElement
): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return lines;
  measureEl.style.fontSize = `${fontSize}px`;
  measureEl.style.fontWeight = fontWeight;
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const next = current + " " + words[i];
    measureEl.textContent = next;
    if (measureEl.offsetWidth > widthPx && current.length > 0) {
      lines.push(current);
      current = words[i];
    } else {
      current = next;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

let measureSpan: HTMLElement | null = null;

function getMeasureSpan(): HTMLElement {
  if (!measureSpan) {
    measureSpan = document.createElement("span");
    measureSpan.style.cssText =
      "position:absolute;left:-9999px;white-space:nowrap;font-family:inherit;";
    document.body.appendChild(measureSpan);
  }
  return measureSpan;
}

/**
 * Convert markdown to a list of styled lines for SVG rendering. Uses HTML parsing
 * of the marked output so we get correct structure; then word-wraps to the given width.
 */
export function markdownToSvgLines(
  md: string,
  baseFontSize: number,
  widthPx: number
): MarkdownSvgLine[] {
  const out: MarkdownSvgLine[] = [];
  if (!md?.trim()) return out;
  try {
    const html = markdownToHtml(md);
    if (!html.trim()) return out;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const measureEl = getMeasureSpan();
    const blockTags = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "div"];
    const walk = (node: Node): void => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        for (const child of el.childNodes) walk(child);
        return;
      }
      if (!blockTags.includes(tag)) {
        for (const child of el.childNodes) walk(child);
        return;
      }
      const text = getTextContent(el).replace(/\n+/g, " ").trim();
      if (!text) return;
      const scale = HEADING_SCALE[tag] ?? 1;
      const fontSize = Math.round(baseFontSize * scale);
      const fontWeight = /^h[1-6]$/.test(tag) ? "bold" : "normal";
      const lines = wrapTextToWidth(
        text,
        widthPx,
        fontSize,
        fontWeight,
        measureEl
      );
      for (const line of lines) {
        out.push({ text: line, fontSize, fontWeight });
      }
    };
    walk(doc.body);
    if (out.length === 0 && (html.trim() || md.trim())) {
      const plain = (doc.body.textContent ?? md).replace(/\n+/g, " ").trim();
      if (plain) {
        const lines = wrapTextToWidth(
          plain,
          widthPx,
          baseFontSize,
          "normal",
          measureEl
        );
        for (const line of lines) {
          out.push({
            text: line,
            fontSize: baseFontSize,
            fontWeight: "normal",
          });
        }
      }
    }
  } catch {
    const measureEl = getMeasureSpan();
    const lines = wrapTextToWidth(
      md,
      widthPx,
      baseFontSize,
      "normal",
      measureEl
    );
    for (const line of lines) {
      out.push({ text: line, fontSize: baseFontSize, fontWeight: "normal" });
    }
  }
  return out;
}

const LINE_HEIGHT_RATIO = 1.35;

/**
 * Return width and height for markdown content when rendered as SVG lines.
 */
export function measureMarkdownSvg(
  md: string,
  baseFontSize: number,
  constrainWidthPx?: number
): { width: number; height: number } {
  const widthForWrap = constrainWidthPx ?? 9999;
  const lines = markdownToSvgLines(md, baseFontSize, widthForWrap);
  if (lines.length === 0) return { width: 0, height: 0 };
  const measureEl = getMeasureSpan();
  let maxW = 0;
  let totalH = 0;
  for (const line of lines) {
    measureEl.style.fontSize = `${line.fontSize}px`;
    measureEl.style.fontWeight = line.fontWeight;
    measureEl.textContent = line.text;
    maxW = Math.max(maxW, measureEl.offsetWidth);
    totalH += line.fontSize * LINE_HEIGHT_RATIO;
  }
  const width = constrainWidthPx !== undefined ? constrainWidthPx : maxW;
  return { width, height: totalH };
}
