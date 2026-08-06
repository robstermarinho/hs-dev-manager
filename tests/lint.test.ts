import { describe, expect, it } from "vitest";
import {
  countIssues,
  errorsOf,
  isLintable,
  lintContent,
  lintHubl,
  lintJson,
  positionAt,
  renderLintResults,
} from "../src/lint.js";

describe("isLintable", () => {
  it("covers HubL templates and JSON assets only", () => {
    expect(isLintable("src/p-1/theme/templates/home.html")).toBe(true);
    expect(isLintable("src/p-1/theme/fields.json")).toBe(true);
    expect(isLintable("src/p-1/theme/css/main.hubl.css")).toBe(true);
    expect(isLintable("src/p-1/theme/css/main.css")).toBe(false);
    expect(isLintable("src/p-1/theme/images/logo.png")).toBe(false);
  });
});

describe("positionAt", () => {
  it("reports 1-based line and column", () => {
    expect(positionAt("abc\ndefg", 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt("abc\ndefg", 5)).toEqual({ line: 2, column: 2 });
  });
});

describe("lintHubl", () => {
  it("accepts a balanced template", () => {
    const template = [
      "{% if module.show %}",
      "  {% for item in module.items %}",
      "    <li>{{ item.name }}</li>",
      "  {% endfor %}",
      "{% endif %}",
      "{# a comment with {% if %} inside #}",
    ].join("\n");
    expect(lintHubl(template)).toEqual([]);
  });

  it("reports a block left open", () => {
    const issues = lintHubl("<div>\n{% for item in items %}\n  {{ item }}\n</div>\n");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 2, column: 1, severity: "error" });
    expect(issues[0]?.message).toContain("{% for %} is never closed");
  });

  it("reports a closing tag that does not match", () => {
    const issues = lintHubl("{% if a %}\n{% endfor %}\n");
    expect(issues[0]?.message).toBe("{% endfor %} does not match {% if %} opened on line 1");
  });

  it("reports a closing tag with nothing open", () => {
    const issues = lintHubl("<p>text</p>\n{% endif %}\n");
    expect(issues[0]).toMatchObject({ line: 2, severity: "error" });
    expect(issues[0]?.message).toContain("nothing is open here");
  });

  it("reports unterminated delimiters", () => {
    expect(lintHubl("{{ module.name \n<p>rest</p>")[0]?.message).toContain("Unclosed expression");
    expect(lintHubl("{% if a %\n")[0]?.message).toContain("Unclosed tag");
    expect(lintHubl("{# note\n")[0]?.message).toContain("Unclosed comment");
  });

  it("treats an assignment set as a statement and a bodyless set as a block", () => {
    expect(lintHubl('{% set columns = "12" %}\n')).toEqual([]);
    expect(lintHubl("{% set body %}text{% endset %}\n")).toEqual([]);
    expect(lintHubl("{% set body %}text\n")).toHaveLength(1);
  });

  it("pairs underscore-style HubL blocks", () => {
    expect(lintHubl("{% dnd_area 'main' %}{% dnd_section %}{% end_dnd_section %}{% end_dnd_area %}")).toEqual([]);
    expect(lintHubl("{% require_js %}<script></script>{% end_require_js %}")).toEqual([]);
    expect(lintHubl("{% dnd_area 'main' %}{% end_dnd_section %}")[0]?.message).toContain("does not match");
  });

  it("ignores tags it does not know", () => {
    expect(lintHubl("{% include 'a.html' %}\n{% custom_thing %}\n{% do whatever %}")).toEqual([]);
  });

  it("does not treat delimiters inside quoted strings as terminators", () => {
    expect(lintHubl('{% set label = "100%} off" %}{{ label }}')).toEqual([]);
  });
});

describe("lintJson", () => {
  it("accepts valid JSON", () => {
    expect(lintJson('{"label": "Hero"}', "meta.json")).toEqual([]);
  });

  it("locates a syntax error", () => {
    const issues = lintJson('{\n  "a": 1\n  "b": 2\n}\n', "theme.json");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, column: 3, severity: "error" });
    expect(issues[0]?.message).toContain("Invalid JSON");
  });

  it("falls back to the top of the file when the parser gives no position", () => {
    const issues = lintJson('{\n  "a": 1,\n  "b":,\n}\n', "theme.json");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 1, column: 1, severity: "error" });
  });

  it("warns when a known asset has the wrong shape", () => {
    expect(lintJson('{"not": "an array"}', "modules/hero.module/fields.json")[0]).toMatchObject({
      severity: "warning",
      message: "fields.json should contain an array of fields",
    });
    expect(lintJson("[]", "theme.json")[0]?.severity).toBe("warning");
    expect(lintJson("[]", "fields.json")).toEqual([]);
  });
});

describe("lintContent", () => {
  it("dispatches by extension and ignores everything else", () => {
    expect(lintContent("a/fields.json", "{")).toHaveLength(1);
    expect(lintContent("a/module.html", "{% if x %}")).toHaveLength(1);
    expect(lintContent("a/module.js", "function ( {")).toEqual([]);
  });
});

describe("result helpers", () => {
  const results = [
    { file: "a.html", issues: [{ line: 1, column: 1, severity: "error" as const, message: "boom" }] },
    { file: "b.json", issues: [{ line: 2, column: 3, severity: "warning" as const, message: "shape" }] },
    { file: "c.html", issues: [] },
  ];

  it("selects files with errors and counts by severity", () => {
    expect(errorsOf(results).map((result) => result.file)).toEqual(["a.html"]);
    expect(countIssues(results, "error")).toBe(1);
    expect(countIssues(results, "warning")).toBe(1);
  });

  it("renders only files that have issues", () => {
    expect(renderLintResults(results)).toBe(
      ["  a.html", "    1:1  error  boom", "  b.json", "    2:3  warning  shape"].join("\n")
    );
  });
});
