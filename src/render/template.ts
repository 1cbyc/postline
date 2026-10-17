// A small Mustache-compatible template engine for custom card layouts.
// Supports {{name}}, {{{name}}}, {{&name}}, dotted names, {{.}},
// sections {{#name}}...{{/name}}, inverted sections {{^name}}...{{/name}}
// and comments {{! ... }}. No partials, no lambdas, no delimiter changes.

import { esc } from "./escape.js";

type Node =
  | { kind: "text"; value: string }
  | { kind: "var"; name: string; raw: boolean }
  | { kind: "section"; name: string; inverted: boolean; children: Node[] };

export class TemplateError extends Error {}

const TAG = /\{\{(\{)?\s*([#^/&!]?)\s*([^}]*?)\s*\}?\}\}/g;

export function parseTemplate(source: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [{ name: "", children: root }];
  let last = 0;
  for (const match of source.matchAll(TAG)) {
    const index = match.index ?? 0;
    const top = stack[stack.length - 1]!;
    if (index > last) top.children.push({ kind: "text", value: source.slice(last, index) });
    last = index + match[0].length;

    const triple = match[1] === "{";
    const sigil = match[2] ?? "";
    const name = (match[3] ?? "").trim();
    if (sigil === "!") continue;
    if (!name) throw new TemplateError(`empty tag at offset ${index}`);
    if (sigil === "#" || sigil === "^") {
      const section: Node = { kind: "section", name, inverted: sigil === "^", children: [] };
      top.children.push(section);
      stack.push({ name, children: section.children });
    } else if (sigil === "/") {
      if (stack.length === 1 || top.name !== name) {
        throw new TemplateError(`unexpected {{/${name}}}${stack.length > 1 ? `, expected {{/${top.name}}}` : ""}`);
      }
      stack.pop();
    } else {
      top.children.push({ kind: "var", name, raw: triple || sigil === "&" });
    }
  }
  if (stack.length > 1) throw new TemplateError(`unclosed section {{#${stack[stack.length - 1]!.name}}}`);
  if (last < source.length) root.push({ kind: "text", value: source.slice(last) });
  return root;
}

function lookup(stack: unknown[], name: string): unknown {
  if (name === ".") return stack[stack.length - 1];
  const [head, ...rest] = name.split(".");
  for (let i = stack.length - 1; i >= 0; i--) {
    const scope = stack[i];
    if (scope !== null && typeof scope === "object" && Object.prototype.hasOwnProperty.call(scope, head!)) {
      let value: unknown = (scope as Record<string, unknown>)[head!];
      for (const key of rest) {
        if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
        value = (value as Record<string, unknown>)[key];
      }
      return value;
    }
  }
  return undefined;
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== false && value !== "" && value !== 0;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null || value === false) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function renderNodes(nodes: Node[], stack: unknown[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") out += node.value;
    else if (node.kind === "var") {
      const text = stringify(lookup(stack, node.name));
      out += node.raw ? text : esc(text);
    } else {
      const value = lookup(stack, node.name);
      if (node.inverted) {
        if (!truthy(value)) out += renderNodes(node.children, stack);
      } else if (Array.isArray(value)) {
        for (const item of value) out += renderNodes(node.children, [...stack, item]);
      } else if (truthy(value)) {
        out += renderNodes(node.children, typeof value === "object" ? [...stack, value] : stack);
      }
    }
  }
  return out;
}

export function renderTemplate(source: string, view: Record<string, unknown>): string {
  return renderNodes(parseTemplate(source), [view]);
}
