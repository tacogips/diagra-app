export class BpmnParseError extends Error {
  readonly line: number;

  constructor(message: string, line = 1) {
    super(`line ${line}: ${message}`);
    this.name = "BpmnParseError";
    this.line = line;
  }
}

export interface XmlAttribute {
  readonly name: string;
  readonly prefix?: string;
  readonly local: string;
  readonly ns?: string;
  readonly value: string;
}
export interface XmlText {
  readonly kind: "text";
  readonly text: string;
}
export interface XmlElement {
  readonly name: string;
  readonly prefix?: string;
  readonly local: string;
  readonly ns?: string;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlNode[];
}
export type XmlNode = XmlElement | XmlText;

const XMLNS = "http://www.w3.org/2000/xmlns/";
const XML = "http://www.w3.org/XML/1998/namespace";
const BPMN_MODEL = "http://www.omg.org/spec/BPMN/20100524/MODEL";

function decode(value: string, line: number): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(value))
    throw new BpmnParseError("malformed entity reference", line);
  return value.replace(/&([^;]+);/g, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    if (/^#\d+$/.test(entity) || /^#x[\da-f]+$/i.test(entity)) {
      const value =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (
        !Number.isInteger(value) ||
        value <= 0 ||
        value > 0x10ffff ||
        (value >= 0xd800 && value <= 0xdfff)
      )
        throw new BpmnParseError("invalid character reference", line);
      return String.fromCodePoint(value);
    }
    throw new BpmnParseError(`unknown entity &${entity};`, line);
  });
}

function splitName(name: string): { prefix?: string; local: string } {
  const colon = name.indexOf(":");
  return colon < 0
    ? { local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = 0; at < index; at += 1)
    if (text.charCodeAt(at) === 10) line += 1;
  return line;
}

export function parseXml(text: string): XmlElement {
  const stack: Array<{
    element: {
      name: string;
      prefix?: string;
      local: string;
      ns?: string;
      attributes: XmlAttribute[];
      children: XmlNode[];
    };
    namespaces: Map<string, string>;
  }> = [];
  let root: XmlElement | undefined;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < text.length) {
    if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end < 0)
        throw new BpmnParseError("unclosed comment", lineAt(text, index));
      index = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index + 9);
      if (end < 0)
        throw new BpmnParseError("unclosed CDATA section", lineAt(text, index));
      if (stack.length)
        stack[stack.length - 1]?.element.children.push({
          kind: "text",
          text: text.slice(index + 9, end),
        });
      index = end + 3;
      continue;
    }
    if (
      text.startsWith("<!DOCTYPE", index) ||
      text.startsWith("<!doctype", index)
    )
      throw new BpmnParseError("DOCTYPE is not allowed", lineAt(text, index));
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end < 0)
        throw new BpmnParseError(
          "unclosed processing instruction",
          lineAt(text, index),
        );
      index = end + 2;
      continue;
    }
    if (text.startsWith("</", index)) {
      const end = text.indexOf(">", index + 2);
      if (end < 0)
        throw new BpmnParseError("unclosed end tag", lineAt(text, index));
      const name = text.slice(index + 2, end).trim();
      const current = stack.pop();
      if (!current || current.element.name !== name)
        throw new BpmnParseError(
          `mismatched end tag ${name}`,
          lineAt(text, index),
        );
      index = end + 1;
      continue;
    }
    if (text[index] === "<") {
      const start = index;
      index += 1;
      const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(text.slice(index));
      if (!nameMatch)
        throw new BpmnParseError("invalid start tag", lineAt(text, start));
      const name = nameMatch[0];
      index += name.length;
      const rawAttributes: Array<{ name: string; value: string }> = [];
      const seen = new Set<string>();
      let selfClosing = false;
      while (index < text.length) {
        while (/\s/.test(text[index] ?? "")) index += 1;
        if (text.startsWith("/>", index)) {
          selfClosing = true;
          index += 2;
          break;
        }
        if (text[index] === ">") {
          index += 1;
          break;
        }
        const attrMatch = /^[A-Za-z_][\w.:-]*/.exec(text.slice(index));
        if (!attrMatch)
          throw new BpmnParseError("invalid attribute", lineAt(text, index));
        const attrName = attrMatch[0];
        if (seen.has(attrName))
          throw new BpmnParseError(
            `duplicate attribute ${attrName}`,
            lineAt(text, index),
          );
        seen.add(attrName);
        index += attrName.length;
        while (/\s/.test(text[index] ?? "")) index += 1;
        if (text[index] !== "=")
          throw new BpmnParseError(
            `attribute ${attrName} has no value`,
            lineAt(text, index),
          );
        index += 1;
        while (/\s/.test(text[index] ?? "")) index += 1;
        const quote = text[index];
        if (quote !== '"' && quote !== "'")
          throw new BpmnParseError(
            "attribute value must be quoted",
            lineAt(text, index),
          );
        index += 1;
        const end = text.indexOf(quote, index);
        if (end < 0)
          throw new BpmnParseError(
            "unclosed attribute value",
            lineAt(text, index),
          );
        rawAttributes.push({
          name: attrName,
          value: decode(text.slice(index, end), lineAt(text, index)),
        });
        index = end + 1;
      }
      if (index > text.length)
        throw new BpmnParseError("truncated start tag", lineAt(text, start));
      const namespaces = new Map(stack.at(-1)?.namespaces ?? [["xml", XML]]);
      for (const attribute of rawAttributes) {
        if (attribute.name === "xmlns") namespaces.set("", attribute.value);
        else if (attribute.name.startsWith("xmlns:"))
          namespaces.set(attribute.name.slice(6), attribute.value);
      }
      const elementName = splitName(name);
      const ns = namespaces.get(elementName.prefix ?? "");
      if (elementName.prefix && !ns)
        throw new BpmnParseError(
          `unbound prefix ${elementName.prefix}`,
          lineAt(text, start),
        );
      const attributes: XmlAttribute[] = rawAttributes.map((attribute) => {
        const parts = splitName(attribute.name);
        const attrNs =
          attribute.name === "xmlns" || parts.prefix === "xmlns"
            ? XMLNS
            : parts.prefix
              ? namespaces.get(parts.prefix)
              : undefined;
        if (parts.prefix && parts.prefix !== "xmlns" && !attrNs)
          throw new BpmnParseError(
            `unbound prefix ${parts.prefix}`,
            lineAt(text, start),
          );
        return {
          name: attribute.name,
          ...parts,
          ...(attrNs ? { ns: attrNs } : {}),
          value: attribute.value,
        };
      });
      const element = {
        name,
        ...elementName,
        ...(ns ? { ns } : {}),
        attributes,
        children: [] as XmlNode[],
      };
      if (stack.length) stack.at(-1)?.element.children.push(element);
      else if (root)
        throw new BpmnParseError(
          "content after the root element",
          lineAt(text, start),
        );
      else root = element;
      if (!selfClosing) {
        stack.push({ element, namespaces });
        if (stack.length > 512)
          throw new BpmnParseError(
            "nesting depth exceeds 512",
            lineAt(text, start),
          );
      }
      continue;
    }
    const end = text.indexOf("<", index);
    const stop = end < 0 ? text.length : end;
    const raw = text.slice(index, stop);
    if (!stack.length && raw.trim())
      throw new BpmnParseError(
        "text outside the root element",
        lineAt(text, index),
      );
    if (stack.length && raw)
      stack.at(-1)?.element.children.push({
        kind: "text",
        text: decode(raw, lineAt(text, index)),
      });
    index = stop;
  }
  if (stack.length)
    throw new BpmnParseError(
      `unclosed tag ${stack.at(-1)?.element.name}`,
      lineAt(text, text.length),
    );
  if (!root) throw new BpmnParseError("missing root element");
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    const hasElements = current.children.some((child) => !("kind" in child));
    const hasMeaningfulText = current.children.some(
      (child) => "kind" in child && child.text.trim().length > 0,
    );
    if (hasElements && !hasMeaningfulText) {
      const children = current.children as XmlNode[];
      const normalized = children.filter(
        (child) => !("kind" in child) || child.text.trim().length > 0,
      );
      (current.children as XmlNode[]).splice(0, children.length, ...normalized);
    }
    const merged: XmlNode[] = [];
    for (const child of current.children) {
      const previous = merged.at(-1);
      if (child && "kind" in child && previous && "kind" in previous)
        merged[merged.length - 1] = {
          kind: "text",
          text: previous.text + child.text,
        };
      else merged.push(child);
    }
    (current.children as XmlNode[]).splice(
      0,
      current.children.length,
      ...merged,
    );
    for (const child of current.children)
      if (!("kind" in child)) pending.push(child);
  }
  return root;
}

function escapeText(text: string, attribute: boolean): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(attribute ? /"/g : /$^/, "&quot;")
    .replace(attribute ? /\n/g : /$^/, "&#10;");
}

export function serializeXml(root: XmlElement): string {
  const renderInline = (element: XmlElement): string => {
    const attrs = element.attributes
      .map((item) => ` ${item.name}="${escapeText(item.value, true)}"`)
      .join("");
    if (!element.children.length) return `<${element.name}${attrs} />`;
    const content = element.children
      .map((child) =>
        "kind" in child ? escapeText(child.text, false) : renderInline(child),
      )
      .join("");
    return `<${element.name}${attrs}>${content}</${element.name}>`;
  };
  const render = (element: XmlElement, depth: number): string => {
    const indent = "  ".repeat(depth);
    const attrs = element.attributes
      .map((item) => ` ${item.name}="${escapeText(item.value, true)}"`)
      .join("");
    if (!element.children.length) return `${indent}<${element.name}${attrs} />`;
    if (element.children.every((child) => "kind" in child)) {
      const content = element.children
        .map((child) => escapeText(child.text, false))
        .join("");
      return `${indent}<${element.name}${attrs}>${content}</${element.name}>`;
    }
    if (element.children.some((child) => "kind" in child))
      return `${indent}${renderInline(element)}`;
    return `${indent}<${element.name}${attrs}>\n${element.children.map((child) => ("kind" in child ? `${"  ".repeat(depth + 1)}${escapeText(child.text, false)}` : render(child, depth + 1))).join("\n")}\n${indent}</${element.name}>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(root, 0)}\n`;
}

export const BPMN_MODEL_NAMESPACE = BPMN_MODEL;
