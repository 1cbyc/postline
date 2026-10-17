# ADR-010: Bring Your Own Design System

## Status

Accepted. Extends ADR-003.

## Context

The three built-in layouts cover most posts, but teams with an established design
system want their own type scale, shapes and compositions, and they already keep
their colours and fonts as design tokens exported from tools such as Tokens Studio
or Figma. Re-typing those values into `brand.colors` duplicates the source of truth,
and asking for a pull request every time someone wants a new composition does not
scale. ADR-003 named user-supplied templates as the next step.

## Decision

Add an optional `design` section with three independent parts:

- `tokens`: a JSON file in DTCG, Style Dictionary or plain nested form. Aliases are resolved. Brand colours and the font family can reference tokens as `"{path.to.token}"`, and every token is exposed to every card as a CSS custom property.
- `stylesheet`: CSS inlined after the built-in CSS, for adjusting built-in layouts.
- `templates`: a folder where each `<name>.html` becomes a layout. Templates use a Mustache subset implemented in-house (no new dependency, per ADR-002). Posts pass extra values through `card.data`.

postline injects the charset, font, brand variables, tokens and stylesheet into
every template, so a template only describes layout and can't forget UTF-8.
Template values are HTML-escaped unless the template explicitly uses triple braces.
Token values that contain characters outside a plain CSS value are left out of the
generated CSS. All design files must be inside the project root.

## Consequences

Any brand can produce cards that look like the rest of its work, and design changes
flow from the token file. Templates are ordinary HTML and CSS, so designers can work
on them without learning postline internals. The costs: a template can overflow or
look wrong in ways lint can't detect, so authors need to render and look. The
template language is deliberately small (no partials or logic), and the variables
exposed to templates are now a public interface that has to stay stable.

## Revisit Trigger

Revisit if templates commonly need shared fragments (partials) or if a standard
token format replaces DTCG in the tools people use.
