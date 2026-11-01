// Builds postline.nsisong.com into web/dist: the landing page, a 404 page and
// one page per guide in docs/guides, so the site never drifts from the repo.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, type Tokens } from "marked";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const src = join(web, "src");
const dist = join(web, "dist");

const SITE = "https://postline.nsisong.com";
const GITHUB = "https://github.com/1cbyc/postline";

/** Sidebar order. Every file in docs/guides must be listed here. */
const GUIDES: readonly { slug: string; label: string }[] = [
  { slug: "getting-started", label: "Getting started" },
  { slug: "content-format", label: "Content format" },
  { slug: "configuration", label: "Configuration" },
  { slug: "design-systems", label: "Design systems" },
  { slug: "graphics-library", label: "Graphics library" },
  { slug: "channels", label: "Channels" },
  { slug: "scheduling", label: "Scheduling" },
  { slug: "self-hosted-scheduling", label: "Self-hosted scheduling" },
  { slug: "previews", label: "Previews" },
  { slug: "health-and-alerts", label: "Health checks and alerts" },
];

interface Heading {
  id: string;
  text: string;
}

interface Guide {
  slug: string;
  label: string;
  title: string;
  description: string;
  html: string;
  headings: Heading[];
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Plain text of a run of Markdown inline text, for meta descriptions. */
function plain(markdown: string): string {
  return markdown
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Point guide-relative links at their place on the site or on GitHub. */
function rewriteHref(href: string): string {
  if (/^[a-z]+:|^#|^\//i.test(href)) return href;
  const [path = "", hash] = href.split("#", 2);
  const fragment = hash === undefined ? "" : `#${hash}`;
  const sibling = /^([a-z0-9-]+)\.md$/.exec(path);
  if (sibling) {
    if (!GUIDES.some((g) => g.slug === sibling[1])) throw new Error(`link to unknown guide ${href}`);
    return `/docs/${sibling[1]}/${fragment}`;
  }
  const inRepo = resolve(repo, "docs", "guides", path);
  if (!inRepo.startsWith(repo + "/")) throw new Error(`link leaves the repository: ${href}`);
  const kind = existsSync(inRepo) && !/\.[a-z0-9]+$/i.test(inRepo) ? "tree" : "blob";
  return `${GITHUB}/${kind}/main/${inRepo.slice(repo.length + 1)}${fragment}`;
}

function renderGuide(slug: string, label: string): Guide {
  const source = readFileSync(join(repo, "docs", "guides", `${slug}.md`), "utf8");
  const headings: Heading[] = [];
  const used = new Set<string>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading): string {
        const html = this.parser.parseInline(tokens);
        let id = slugify(html) || "section";
        for (let n = 2; used.has(id); n++) id = `${slugify(html)}-${n}`;
        used.add(id);
        if (depth === 2) headings.push({ id, text: html });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        const target = rewriteHref(href);
        const external = /^https?:/.test(target) && !target.startsWith(SITE);
        return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ""}${external ? ' rel="noopener"' : ""}>${text}</a>`;
      },
    },
  });

  const tokens = marked.lexer(source);
  const first = tokens.findIndex((t) => t.type === "heading" && t.depth === 1);
  const h1 = tokens[first];
  if (!h1 || h1.type !== "heading") throw new Error(`${slug}.md must start with a "# Title"`);
  tokens.splice(first, 1);
  const intro = tokens.find((t): t is Tokens.Paragraph => t.type === "paragraph");

  const html = marked
    .parser(tokens)
    .replace(/<table>/g, '<div class="table-wrap" role="region" aria-label="Table" tabindex="0"><table>')
    .replace(/<\/table>/g, "</table></div>");

  return { slug, label, title: h1.text, description: intro ? plain(intro.text) : h1.text, html, headings };
}

function fill(template: string, values: Record<string, string>, name: string): string {
  const out = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`${name}: no value for ${match}`);
    return value;
  });
  return out;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function checkGuideList(): void {
  const files = readdirSync(join(repo, "docs", "guides")).filter((f) => f.endsWith(".md"));
  const listed = new Set(GUIDES.map((g) => `${g.slug}.md`));
  const missing = files.filter((f) => !listed.has(f));
  const extra = [...listed].filter((f) => !files.includes(f));
  if (missing.length || extra.length) {
    throw new Error(`update GUIDES in scripts/build.ts (unlisted: ${missing.join(", ") || "none"}; missing files: ${extra.join(", ") || "none"})`);
  }
}

function build(): void {
  checkGuideList();
  const pkg: unknown = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const version = typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : undefined;
  if (!version) throw new Error("package.json has no version");

  rmSync(dist, { recursive: true, force: true });
  cpSync(join(src, "assets"), dist, { recursive: true });
  cpSync(join(repo, "docs", "images"), join(dist, "images"), { recursive: true });

  const shared = { version, year: String(new Date().getFullYear()), github: GITHUB, site: SITE };
  const layout = readFileSync(join(src, "templates", "layout.html"), "utf8");
  const page = (path: string, title: string, description: string, body: string, bodyClass: string): void => {
    const canonical = `${SITE}${path}`;
    // The body goes in last so Mustache examples in the guides stay literal.
    const shell = fill(layout, { ...shared, title: esc(title), description: esc(description), canonical, body: "{{body}}", bodyClass }, path);
    write(join(dist, path, path.endsWith(".html") ? "" : "index.html"), shell.replace("{{body}}", () => body));
  };

  for (const name of ["index", "404"]) {
    const body = fill(readFileSync(join(src, `${name}.html`), "utf8"), shared, `${name}.html`);
    if (name === "index") {
      page("/", "postline: a content calendar that lives in git", "Plan, render and publish branded social posts from a git repo. Cards from your design system, rules that block bad posts, publishing that never double posts.", body, "home");
    } else {
      page("/404.html", "Page not found · postline", "This page does not exist.", body, "not-found");
    }
  }

  const guides = GUIDES.map((g) => renderGuide(g.slug, g.label));
  const docTemplate = readFileSync(join(src, "templates", "doc.html"), "utf8");
  const nav = (current: string): string =>
    guides
      .map((g) => `<li><a href="/docs/${g.slug}/"${g.slug === current ? ' aria-current="page"' : ""}>${esc(g.label)}</a></li>`)
      .join("\n");

  guides.forEach((g, i) => {
    const prev = guides[i - 1];
    const next = guides[i + 1];
    const toc = g.headings.length
      ? `<nav class="toc" aria-labelledby="toc-title"><p id="toc-title">On this page</p><ol>${g.headings
          .map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`)
          .join("")}</ol></nav>`
      : "";
    const body = fill(
      docTemplate,
      {
        ...shared,
        title: esc(g.title),
        nav: nav(g.slug),
        toc,
        content: g.html,
        source: `${GITHUB}/blob/main/docs/guides/${g.slug}.md`,
        prev: prev ? `<a class="prev" href="/docs/${prev.slug}/"><span>Previous</span>${esc(prev.label)}</a>` : "<span></span>",
        next: next ? `<a class="next" href="/docs/${next.slug}/"><span>Next</span>${esc(next.label)}</a>` : "<span></span>",
      },
      `${g.slug}.md`,
    );
    page(`/docs/${g.slug}/`, `${g.title} · postline docs`, g.description, body, "doc");
  });

  const index = `<div class="docs-index wrap">
  <header class="docs-index-head">
    <p class="eyebrow">Documentation</p>
    <h1>Guides</h1>
    <p class="lede">Everything from your first post to running postline on your own server. The same guides live in the repository under <code>docs/guides</code>.</p>
  </header>
  <ol class="guide-list">
${guides
  .map(
    (g, i) =>
      `    <li><a href="/docs/${g.slug}/"><span class="num">${String(i + 1).padStart(2, "0")}</span><span class="name">${esc(g.label)}</span><span class="desc">${esc(g.description)}</span></a></li>`,
  )
  .join("\n")}
  </ol>
  <p class="more">Why postline works the way it does: <a href="${GITHUB}/tree/main/docs/architecture" rel="noopener">architecture decision records</a> on GitHub.</p>
</div>`;
  page("/docs/", "Guides · postline docs", "Guides for postline: getting started, content format, configuration, design systems, channels and scheduling.", index, "docs-home");

  const urls = ["/", "/docs/", ...guides.map((g) => `/docs/${g.slug}/`)];
  write(
    join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${SITE}${u}</loc></url>`)
      .join("\n")}\n</urlset>\n`,
  );

  console.log(`built ${urls.length} pages for postline ${version} into ${basename(web)}/dist`);
}

build();
