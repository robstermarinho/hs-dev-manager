import pc from "picocolors";

type Rgb = readonly [red: number, green: number, blue: number];

// Terminal prompt (">_") as a 6-row pixel grid — generic dev mark, no trademark.
const ICON_PIXELS = [
  "       ",
  "██     ",
  " ██    ",
  " ██    ",
  "██     ",
  "   ████",
] as const;

// 5-row pixel glyphs; rendered two pixel rows per terminal line via half blocks.
const GLYPHS: Record<string, readonly string[]> = {
  " ": ["  ", "  ", "  ", "  ", "  "],
  A: [" █ ", "█ █", "███", "█ █", "█ █"],
  B: ["██ ", "█ █", "██ ", "█ █", "██ "],
  D: ["██ ", "█ █", "█ █", "█ █", "██ "],
  E: ["███", "█  ", "██ ", "█  ", "███"],
  G: [" ██", "█  ", "█ █", "█ █", " ██"],
  H: ["█ █", "█ █", "███", "█ █", "█ █"],
  M: ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
  N: ["█  █", "██ █", "█ ██", "█  █", "█  █"],
  O: [" █ ", "█ █", "█ █", "█ █", " █ "],
  P: ["██ ", "█ █", "██ ", "█  ", "█  "],
  R: ["██ ", "█ █", "██ ", "█ █", "█ █"],
  S: [" ██", "█  ", " █ ", "  █", "██ "],
  T: ["███", " █ ", " █ ", " █ ", " █ "],
  U: ["█ █", "█ █", "█ █", "█ █", "███"],
  V: ["█ █", "█ █", "█ █", "█ █", " █ "],
};

const TITLE_COLORS: readonly Rgb[] = [
  [91, 225, 255],
  [43, 165, 255],
  [70, 91, 235],
];

const ICON_ORANGE: Rgb = [255, 122, 89];

/** Merge two pixel rows into one terminal line using half-block characters. */
function halfBlockLine(top: string, bottom: string): string {
  const width = Math.max(top.length, bottom.length);
  let line = "";

  for (let index = 0; index < width; index++) {
    const hasTop = top[index] === "█";
    const hasBottom = bottom[index] === "█";
    line += hasTop && hasBottom ? "█" : hasTop ? "▀" : hasBottom ? "▄" : " ";
  }

  return line.trimEnd();
}

/** Collapse a pixel grid (any row count) into half-height terminal lines. */
function renderPixels(pixelRows: readonly string[]): string[] {
  const lines: string[] = [];

  for (let index = 0; index < pixelRows.length; index += 2) {
    lines.push(halfBlockLine(pixelRows[index]!, pixelRows[index + 1] ?? ""));
  }

  return lines;
}

function renderText(text: string): string[] {
  const rows = Array.from({ length: 5 }, () => "");

  for (const character of text.toUpperCase()) {
    const glyph = GLYPHS[character];
    if (!glyph) throw new Error(`Unsupported banner character: ${character}`);

    glyph.forEach((row, index) => {
      rows[index] += `${row} `;
    });
  }

  return renderPixels(rows);
}

function color(text: string, [red, green, blue]: Rgb, enabled: boolean): string {
  if (!enabled) return text;
  return `[38;2;${red};${green};${blue}m${text}[39m`;
}

/** Render the compact CLI wordmark, retaining a readable monochrome fallback. */
export function renderBanner(useColor: boolean = pc.isColorSupported): string {
  const iconLines = renderPixels(ICON_PIXELS);
  const title = renderText("HS Dev Manager");
  const iconWidth = Math.max(...iconLines.map((line) => line.length));

  return title
    .map((line, index) => {
      const iconLine = (iconLines[index] ?? "").padEnd(iconWidth);
      const icon = color(iconLine, ICON_ORANGE, useColor);
      const wordmark = color(line, TITLE_COLORS[index]!, useColor);
      return `${icon}  ${wordmark}`.trimEnd();
    })
    .join("\n");
}
