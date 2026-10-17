# Export: open owner decisions

Design: `design-docs/specs/export.md`. Each question has a default that the
design implements; answering differently changes only the named section.

## Q1. PDF text in a plain browser (section 3.5)

A browser cannot read installed font files, so web PDF export cannot embed
the fonts the editor uses.

- Default: use PDF standard fonts (Helvetica, Courier). Text stays text;
  characters outside WinAnsi (for example Japanese) cannot be drawn, and the
  dialog warns with a count and points to the desktop app or `nodetto-cli`.
- Alternatives: (a) use the Chromium-only Local Font Access API when the user
  grants it, falling back to the default elsewhere; (b) bundle a web font
  (adds an asset and license review, and would differ from the editor's
  installed-font rendering); (c) disable PDF in the plain browser.

## Q2. `svg-to-pdfkit` maintenance status (section 6)

The constraint asks for maintained dependencies. `svg-to-pdfkit` (MIT) was
last published in 2022 but is the only SVG-to-PDF converter found that runs
in Bun without a DOM shim and in the browser without changes.

- Default: depend on it with an exact version pin; tests cover the SVG subset
  svg-export emits.
- Alternatives: jsPDF + svg2pdf.js (maintained, MIT) plus a DOM shim such as
  linkedom in the CLI (larger, DOM-fidelity risk); or vendoring the single
  source file under its MIT license.

## Q3. Default export background (section 3.2)

- Default: the canvas color `#f6f4ee` for the new menu and the CLI, matching
  the existing "Export SVG". `--transparent` / "Transparent" opt out.
- Alternative: transparent by default (as the inspector Download PNG does) or
  white.
