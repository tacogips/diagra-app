import { expect, test } from "bun:test";
import { BpmnParseError, parseXml, serializeXml } from "./xml.ts";

const expectParseError = (source: string): void => {
  expect(() => parseXml(source)).toThrow(BpmnParseError);
};

test("parses namespace scopes, predefined and numeric entities, CDATA, and drops comments", () => {
  const root = parseXml(
    '<a xmlns="urn:a" xmlns:p="urn:old"><p:b p:x="&amp;&lt;&#65;&#x42;">before<![CDATA[<raw>]]><!-- ignored --><p:c xmlns:p="urn:new" /></p:b></a>',
  );
  const child = root.children[0];
  expect(child && "kind" in child ? null : child?.ns).toBe("urn:old");
  if (child && !("kind" in child)) {
    expect(child.attributes[0]?.value).toBe("&<AB");
    expect(child.children).toHaveLength(2);
    const nested = child.children[1];
    expect(nested && "kind" in nested ? null : nested?.ns).toBe("urn:new");
  }
});

test("rejects unsafe and malformed XML", () => {
  for (const source of [
    "<!DOCTYPE a><a/>",
    "<a>&unknown;</a>",
    "<a>&</a>",
    "<a></b>",
    "<a x='1' x='2'/>",
    "<a>",
    "<a><b></a>",
    "<a><p:b/></a>",
  ])
    expectParseError(source);
  expectParseError(`<a>${"<b>".repeat(513)}${"</b>".repeat(513)}</a>`);
});

test("serializes parsed XML deterministically with escaped attributes", () => {
  const parsed = parseXml(
    '<a z="q"&amp;&#10;" b="1"><text>&lt;&amp;&gt;</text></a>'.replace(
      'q"',
      "q&quot;",
    ),
  );
  const first = serializeXml(parsed);
  expect(serializeXml(parseXml(first))).toBe(first);
  expect(first).toContain("q&quot;&amp;&#10;");
  expect(first).toContain("&lt;&amp;&gt;");
});

test("preserves mixed-content whitespace through serialization", () => {
  const source = "<p>Hello <b/> world</p>";
  const serialized = serializeXml(parseXml(source));
  expect(parseXml(serialized).children).toEqual(parseXml(source).children);
});
