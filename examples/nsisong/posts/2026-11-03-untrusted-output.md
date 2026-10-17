---
at: 2026-11-03 08:30
topic: llm-output
card:
  layout: rows
  eyebrow: AI security
  headline:
    - LLM output is untrusted input,
    - not your application's output.
  items:
    - title: Rendered as HTML
      note: Cross-site scripting through the model
      chip: xss
    - title: Executed as a query
      note: Injection, with a model in the middle
      chip: injection
    - title: Fetched as a URL
      note: Server-side request forgery
      chip: ssrf
  footer: Validate what comes out, not just what goes in.
---

What comes out of the model is untrusted input to the rest of your system.

The response is shaped by everything in the context: user messages, retrieved documents, tool results. If any of that was manipulated, the output can carry it.

Familiar bugs come back through a new door:

→ Render it as HTML and you get XSS
→ Execute it as a query and you get injection
→ Fetch the URLs it produces and you get SSRF

Treat model text like user-generated content. Constrain the format, sanitise before rendering, never execute it raw.

#AISecurity #AppSec
