// =============================================================================
// AARIZO — ISSUE-06 Phase B.2.3 (Phase 2): Incremental WHATWG SSE Frame Parser
// Pure, UTF-8 chunk-safe, bounded-memory Server-Sent Events parser for Fetch streams.
// Conforms to WHATWG Server-Sent Events Section 9.2.6:
// - Leading UTF-8 BOM stripped ONLY once at stream start
// - Incomplete frames at EOF are strictly discarded (never dispatched without blank line)
// - Empty `id:` explicitly resets cursor (`id: ""`); NUL-containing IDs are ignored
// =============================================================================

export interface ParsedSseFrame {
  event?: string;
  data: string;
  /** Present when the frame carried an `id:` field (`""` resets the cursor per WHATWG SSE). */
  id?: string;
  retryMs?: number;
}

export interface SseFrameParserOptions {
  /** Maximum accumulated characters/bytes per frame before dropping it safely. Default: 256 KiB. */
  maxFrameBytes?: number;
  /** Maximum single-line length before flagging the active frame as oversized. Default: 128 KiB. */
  maxLineBytes?: number;
  /** Optional diagnostic callback invoked when an oversized frame is safely dropped. */
  onOversizedFrame?: () => void;
}

const DEFAULT_MAX_FRAME_BYTES = 256 * 1024;
const DEFAULT_MAX_LINE_BYTES = 128 * 1024;
const MAX_RETRY_MS = 300_000;
const MAX_EVENT_ID_LENGTH = 128;

/**
 * Validates a non-empty SSE event ID before allowing it to become a replay cursor.
 * Rejects empty, oversized (>128 chars), NUL, or newline-containing IDs.
 */
export function isValidSseEventId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EVENT_ID_LENGTH) return false;
  if (/[\0\r\n]/.test(trimmed)) return false;
  return true;
}

/**
 * Incremental WHATWG-compliant SSE parser supporting:
 * - Multi-byte UTF-8 sequences split across arbitrary Uint8Array chunks (`TextDecoder` stream mode)
 * - Leading UTF-8 BOM stripping strictly once at the beginning of the stream
 * - CRLF (`\r\n`), CR (`\r`), and LF (`\n`) line endings including CR/LF split across chunks
 * - Comment / heartbeat lines (`: ...`)
 * - Multiline `data:` fields joined with `\n`
 * - `event:`, `id:` (including empty reset & NUL rejection), and `retry:` directives
 * - Strict WHATWG EOF behavior: decoder bytes flush without dispatching incomplete unterminated frames
 * - Strict bounded memory protection against oversized lines or unbounded incomplete frames
 */
export class SseFrameParser {
  private decoder: TextDecoder;
  private atStreamStart = true;
  private lineBuffer = '';
  private trailingCarriageReturn = false;

  private currentEvent: string | undefined;
  private currentDataLines: string[] = [];
  private currentId: string | undefined;
  private currentRetryMs: number | undefined;
  private currentFrameBytes = 0;
  private currentFrameOversized = false;

  private readonly maxFrameBytes: number;
  private readonly maxLineBytes: number;
  private readonly onOversizedFrame?: () => void;

  constructor(options: SseFrameParserOptions = {}) {
    this.decoder = new TextDecoder('utf-8');
    this.maxFrameBytes = Math.max(256, options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
    this.maxLineBytes = Math.max(128, Math.min(options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES, this.maxFrameBytes));
    this.onOversizedFrame = options.onOversizedFrame;
  }

  /**
   * Feeds a raw byte chunk (or string) and returns all properly terminated SSE frames parsed so far.
   */
  public feed(chunk: Uint8Array | string): ParsedSseFrame[] {
    const text =
      typeof chunk === 'string'
        ? chunk
        : this.decoder.decode(chunk, { stream: true });
    if (!text) return [];
    return this.processText(text);
  }

  /**
   * Flushes any pending multi-byte UTF-8 decoder bytes on stream EOF and discards
   * any incomplete unterminated frame per WHATWG SSE Section 9.2.6.
   * Only frames that actually received a terminating blank line are returned.
   */
  public finishStream(): ParsedSseFrame[] {
    const frames: ParsedSseFrame[] = [];
    const remaining = this.decoder.decode();
    if (remaining) {
      frames.push(...this.processText(remaining));
    }
    // WHATWG SSE: Any pending unterminated line or event buffer at EOF MUST be discarded.
    this.lineBuffer = '';
    this.trailingCarriageReturn = false;
    this.resetFrameState();
    return frames;
  }

  /**
   * Resets all parser buffers cleanly for parser reuse on a new stream.
   */
  public reset(): void {
    this.decoder = new TextDecoder('utf-8');
    this.atStreamStart = true;
    this.lineBuffer = '';
    this.trailingCarriageReturn = false;
    this.resetFrameState();
  }

  private resetFrameState(): void {
    this.currentEvent = undefined;
    this.currentDataLines = [];
    this.currentId = undefined;
    this.currentRetryMs = undefined;
    this.currentFrameBytes = 0;
    this.currentFrameOversized = false;
  }

  private markOversized(): void {
    if (!this.currentFrameOversized) {
      this.currentFrameOversized = true;
      this.currentDataLines = [];
      this.currentEvent = undefined;
      this.currentId = undefined;
      this.currentRetryMs = undefined;
      this.lineBuffer = '';
      this.onOversizedFrame?.();
    }
  }

  private processText(text: string): ParsedSseFrame[] {
    const frames: ParsedSseFrame[] = [];
    let startIdx = 0;

    // WHATWG SSE: Strip ONE optional leading UTF-8 BOM strictly at the beginning of the stream only.
    if (this.atStreamStart && text.length > 0) {
      this.atStreamStart = false;
      if (text.charCodeAt(0) === 0xfeff) {
        startIdx = 1;
      }
    }

    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];

      // Handle \r\n split across chunk boundaries cleanly
      if (this.trailingCarriageReturn) {
        this.trailingCarriageReturn = false;
        if (ch === '\n') {
          continue;
        }
      }

      if (ch === '\r' || ch === '\n') {
        if (ch === '\r') {
          this.trailingCarriageReturn = true;
        }
        const line = this.lineBuffer;
        this.lineBuffer = '';
        this.processLine(line, frames);
      } else if (!this.currentFrameOversized) {
        this.lineBuffer += ch;
        if (this.lineBuffer.length > this.maxLineBytes) {
          this.markOversized();
        }
      }
    }

    return frames;
  }

  private processLine(line: string, frames: ParsedSseFrame[]): void {
    // Blank line terminates the current SSE frame
    if (line === '') {
      const frame = this.finalizeFrame();
      if (frame) {
        frames.push(frame);
      }
      return;
    }

    // If current frame already overflowed, ignore remaining lines until next blank line
    if (this.currentFrameOversized) {
      return;
    }

    // Comment / keep-alive line starts with ':'
    if (line[0] === ':') {
      return;
    }

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    this.currentFrameBytes += line.length + 1;
    if (this.currentFrameBytes > this.maxFrameBytes) {
      this.markOversized();
      return;
    }

    switch (field) {
      case 'event': {
        if (value.length <= 128) {
          this.currentEvent = value;
        }
        break;
      }
      case 'data': {
        this.currentDataLines.push(value);
        break;
      }
      case 'id': {
        // WHATWG SSE:
        // - NUL-containing (or malformed/oversized) IDs MUST be ignored (do not touch buffer).
        // - Empty `id:` explicitly resets the last-event-ID buffer to "".
        // - Valid non-empty ID sets the buffer.
        if (value.includes('\0') || value.includes('\r') || value.includes('\n')) {
          break;
        }
        if (value === '') {
          this.currentId = '';
        } else if (isValidSseEventId(value)) {
          this.currentId = value.trim();
        }
        break;
      }
      case 'retry': {
        if (/^\d+$/.test(value)) {
          const parsed = Number(value);
          if (Number.isFinite(parsed) && parsed >= 0) {
            this.currentRetryMs = Math.min(parsed, MAX_RETRY_MS);
          }
        }
        break;
      }
      default:
        // Unknown SSE fields are ignored per WHATWG specification
        break;
    }
  }

  private finalizeFrame(): ParsedSseFrame | null {
    if (this.currentFrameOversized) {
      this.resetFrameState();
      return null;
    }

    if (this.currentDataLines.length === 0) {
      // Spec: empty or comment/retry/event-only blocks do not dispatch a message event
      this.resetFrameState();
      return null;
    }

    const frame: ParsedSseFrame = {
      ...(this.currentEvent ? { event: this.currentEvent } : {}),
      data: this.currentDataLines.join('\n'),
      ...(this.currentId !== undefined ? { id: this.currentId } : {}),
      ...(this.currentRetryMs !== undefined ? { retryMs: this.currentRetryMs } : {}),
    };

    this.resetFrameState();
    return frame;
  }
}
