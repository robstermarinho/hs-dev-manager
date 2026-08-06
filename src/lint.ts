/**
 * Local checks for HubL templates and JSON assets.
 *
 * The HubSpot CLI v8 dropped `hs lint`; the only remaining validators are the
 * marketplace ones, which enforce listing rules rather than syntax. These checks
 * are deliberately conservative — unknown tags are ignored — so a clean result
 * never means "valid HubL", but a reported error is a real one.
 */

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  line: number;
  column: number;
  message: string;
  severity: LintSeverity;
}

export interface LintResult {
  /** Repo-relative file the issues belong to. */
  file: string;
  issues: LintIssue[];
}

interface Delimiter {
  open: string;
  close: string;
  label: string;
  quoted: boolean;
}

const DELIMITERS: Delimiter[] = [
  { open: "{#", close: "#}", label: "comment", quoted: false },
  { open: "{%", close: "%}", label: "tag", quoted: true },
  { open: "{{", close: "}}", label: "expression", quoted: true },
];

/** Tags that open a block and must be closed. Anything else is ignored. */
const BLOCK_TAGS = new Set([
  "if",
  "for",
  "block",
  "macro",
  "call",
  "filter",
  "set",
  "raw",
  "widget_block",
  "module_block",
  "require_css",
  "require_js",
  "dnd_area",
  "dnd_section",
  "dnd_column",
  "dnd_row",
  "dnd_module",
]);

const HUBL_EXTENSIONS = [".html", ".htm", ".hubl", ".hubl.css", ".hubl.js"];
const JSON_EXTENSIONS = [".json"];

function endsWithAny(file: string, extensions: string[]): boolean {
  const lower = file.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

export function isLintable(file: string): boolean {
  return endsWithAny(file, HUBL_EXTENSIONS) || endsWithAny(file, JSON_EXTENSIONS);
}

/** Line/column (1-based) of a character offset. */
export function positionAt(text: string, offset: number): { line: number; column: number } {
  const upTo = text.slice(0, Math.max(0, offset));
  const lines = upTo.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

/** First word of a tag body: `{% for x in y %}` → "for". */
function tagName(body: string): string {
  return body.trim().split(/[\s(]/, 1)[0]?.toLowerCase() ?? "";
}

/** `endif` / `end_dnd_area` → "if" / "dnd_area"; undefined when not a closing tag. */
function closingFor(name: string): string | undefined {
  if (!name.startsWith("end")) return undefined;
  const target = name.replace(/^end_?/, "");
  return target.length > 0 ? target : undefined;
}

interface OpenBlock {
  name: string;
  line: number;
  column: number;
}

/**
 * Check HubL delimiter and block balance. Reports unclosed `{{ }}` / `{% %}` /
 * `{# #}`, blocks left open at EOF, and closing tags that do not match.
 */
export function lintHubl(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const stack: OpenBlock[] = [];
  let index = 0;

  while (index < text.length) {
    const delimiter = DELIMITERS.find((candidate) => text.startsWith(candidate.open, index));
    if (!delimiter) {
      index++;
      continue;
    }

    const start = positionAt(text, index);
    const bodyStart = index + delimiter.open.length;
    let cursor = bodyStart;
    let quote: string | undefined;
    let end = -1;

    while (cursor < text.length) {
      const char = text[cursor] as string;
      if (delimiter.quoted && (char === '"' || char === "'")) {
        if (quote === char) quote = undefined;
        else if (!quote) quote = char;
      } else if (!quote && text.startsWith(delimiter.close, cursor)) {
        end = cursor;
        break;
      }
      cursor++;
    }

    if (end === -1) {
      issues.push({
        ...start,
        severity: "error",
        message: `Unclosed ${delimiter.label}: "${delimiter.open}" is never closed with "${delimiter.close}"`,
      });
      break; // Everything after an unterminated delimiter is unparseable.
    }

    if (delimiter.label === "tag") {
      const body = text.slice(bodyStart, end);
      const name = tagName(body);
      const closes = closingFor(name);

      if (closes && BLOCK_TAGS.has(closes)) {
        const open = stack.pop();
        if (!open) {
          issues.push({ ...start, severity: "error", message: `Unexpected {% ${name} %} — nothing is open here` });
        } else if (open.name !== closes) {
          issues.push({
            ...start,
            severity: "error",
            message: `{% ${name} %} does not match {% ${open.name} %} opened on line ${open.line}`,
          });
        }
      } else if (!closes && BLOCK_TAGS.has(name)) {
        // `{% set x = 1 %}` is a statement; only the bodyless form opens a block.
        const isInlineSet = name === "set" && body.includes("=");
        if (!isInlineSet) stack.push({ name, line: start.line, column: start.column });
      }
    }

    index = end + delimiter.close.length;
  }

  for (const open of stack.reverse()) {
    issues.push({
      line: open.line,
      column: open.column,
      severity: "error",
      message: `{% ${open.name} %} is never closed`,
    });
  }

  return issues;
}

/** Parse a JSON asset, turning the parser error into a positioned issue. */
export function lintJson(text: string, file: string = ""): LintIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // V8 usually appends "at position N (line L column C)", but the older
    // "Unexpected token X, ..." wording carries no location at all.
    const explicit = message.match(/line (\d+) column (\d+)/);
    const offset = message.match(/position (\d+)/);
    let at = { line: 1, column: 1 };
    if (explicit?.[1] && explicit[2]) {
      at = { line: Number(explicit[1]), column: Number(explicit[2]) };
    } else if (offset?.[1]) {
      at = positionAt(text, Number(offset[1]));
    }
    return [{ ...at, severity: "error", message: `Invalid JSON: ${message}` }];
  }

  const name = file.split("/").pop()?.toLowerCase();
  if (name === "fields.json" && !Array.isArray(parsed)) {
    return [{ line: 1, column: 1, severity: "warning", message: "fields.json should contain an array of fields" }];
  }
  if ((name === "theme.json" || name === "meta.json") && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
    return [{ line: 1, column: 1, severity: "warning", message: `${name} should contain a JSON object` }];
  }
  return [];
}

/** Lint one file's content, picking the checks by extension. */
export function lintContent(file: string, text: string): LintIssue[] {
  if (endsWithAny(file, JSON_EXTENSIONS)) return lintJson(text, file);
  if (endsWithAny(file, HUBL_EXTENSIONS)) return lintHubl(text);
  return [];
}

export function errorsOf(results: LintResult[]): LintResult[] {
  return results.filter((result) => result.issues.some((issue) => issue.severity === "error"));
}

export function countIssues(results: LintResult[], severity: LintSeverity): number {
  return results.reduce(
    (total, result) => total + result.issues.filter((issue) => issue.severity === severity).length,
    0
  );
}

/** Render results as `file` + indented `line:column  message` lines. */
export function renderLintResults(results: LintResult[]): string {
  return results
    .filter((result) => result.issues.length > 0)
    .map((result) => {
      const lines = result.issues.map(
        (issue) => `    ${issue.line}:${issue.column}  ${issue.severity}  ${issue.message}`
      );
      return [`  ${result.file}`, ...lines].join("\n");
    })
    .join("\n");
}
