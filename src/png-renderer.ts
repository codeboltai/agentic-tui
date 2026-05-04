import { createCanvas } from '@napi-rs/canvas';

export interface PngRenderOptions {
  fontSize?: number;
  fontFamily?: string;
  foreground?: string;
  background?: string;
  padding?: number;
  lineHeight?: number;
}

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 'Consolas, Menlo, Monaco, "Courier New", monospace';
const DEFAULT_FOREGROUND = '#d4d4d4';
const DEFAULT_BACKGROUND = '#111111';
const DEFAULT_PADDING = 16;

export function renderTextGridToPng(text: string, options: PngRenderOptions = {}): Buffer {
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;
  const foreground = options.foreground ?? DEFAULT_FOREGROUND;
  const background = options.background ?? DEFAULT_BACKGROUND;
  const padding = options.padding ?? DEFAULT_PADDING;
  const lineHeight = options.lineHeight ?? Math.ceil(fontSize * 1.35);
  const lines = text.length > 0 ? text.split('\n') : [''];

  const measureCanvas = createCanvas(1, 1);
  const measureContext = measureCanvas.getContext('2d');
  measureContext.font = `${fontSize}px ${fontFamily}`;
  const charWidth = Math.max(1, measureContext.measureText('M').width);
  const cols = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.ceil(cols * charWidth + padding * 2);
  const height = Math.ceil(lines.length * lineHeight + padding * 2);

  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.font = `${fontSize}px ${fontFamily}`;
  context.textBaseline = 'top';
  context.fillStyle = foreground;

  for (let index = 0; index < lines.length; index += 1) {
    context.fillText(lines[index], padding, padding + index * lineHeight);
  }

  return canvas.toBuffer('image/png');
}
