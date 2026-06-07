import { describe, expect, it } from 'vitest';
import {
  extractThinkingFromMessage,
  extractToolResultText,
  formatToolCall,
  formatToolCalls,
  formatToolResult,
  splitMessage,
  truncate,
} from '../src/formatting';

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates with ellipsis at maxLen', () => {
    expect(truncate('hello world!', 8)).toBe('hello...');
  });

  it('returns empty string for falsy input', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('splitMessage', () => {
  it('returns single chunk for short text', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits at newline boundary and preserves all content', () => {
    const text = 'aaaa\nbbbb\ncccc';
    // maxLen=9: "aaaa\nbbbb" is 9 chars, so first chunk should be exactly that
    const chunks = splitMessage(text, 9);
    expect(chunks).toEqual(['aaaa\nbbbb', 'cccc']);
  });

  it('splits at space when no good newline exists', () => {
    const text = 'hello world goodbye world';
    const chunks = splitMessage(text, 15);
    // Should break at space, not mid-word
    expect(chunks[0]).toBe('hello world');
    expect(chunks[1]).toBe('goodbye world');
  });

  it('hard-cuts continuous text and preserves all content', () => {
    const text = 'a'.repeat(100);
    const chunks = splitMessage(text, 30);
    expect(chunks.join('')).toBe(text);
    // First chunks should be exactly maxLen
    expect(chunks[0].length).toBe(30);
  });

  it('handles text that is exactly maxLen', () => {
    const text = 'a'.repeat(50);
    expect(splitMessage(text, 50)).toEqual([text]);
  });
});

describe('extractThinkingFromMessage', () => {
  it('extracts thinking content', () => {
    const msg = {
      content: [
        { type: 'thinking', thinking: 'let me reason' },
        { type: 'text', text: 'the answer' },
      ],
    } as any;
    expect(extractThinkingFromMessage(msg)).toBe('let me reason');
  });

  it('joins multiple thinking blocks and trims', () => {
    const msg = {
      content: [
        { type: 'thinking', thinking: 'first' },
        { type: 'thinking', thinking: 'second ' },
      ],
    } as any;
    expect(extractThinkingFromMessage(msg)).toBe('first\nsecond');
  });

  it('returns empty string when there is no thinking', () => {
    const msg = { content: [{ type: 'text', text: 'hi' }] } as any;
    expect(extractThinkingFromMessage(msg)).toBe('');
  });

  it('ignores redacted thinking with no text', () => {
    const msg = {
      content: [{ type: 'thinking', thinking: '', redacted: true }],
    } as any;
    expect(extractThinkingFromMessage(msg)).toBe('');
  });
});

describe('formatToolCall', () => {
  it('formats a single tool call with args', () => {
    expect(formatToolCall('grep', { pattern: 'hi', path: '/src' })).toBe(
      '🔧 `grep` (pattern=hi, path=/src)'
    );
  });

  it('formats a single tool call without args', () => {
    expect(formatToolCall('status', {})).toBe('🔧 `status`');
    expect(formatToolCall('status', undefined)).toBe('🔧 `status`');
  });

  it('falls back to "tool" when name is empty', () => {
    expect(formatToolCall('', {})).toBe('🔧 `tool`');
  });
});

describe('extractToolResultText', () => {
  it('joins text content parts', () => {
    const result = {
      content: [
        { type: 'text', text: 'line1' },
        { type: 'image', data: '...' },
        { type: 'text', text: 'line2' },
      ],
    };
    expect(extractToolResultText(result)).toBe('line1\nline2');
  });

  it('handles a plain string result', () => {
    expect(extractToolResultText('hello')).toBe('hello');
  });

  it('returns empty string for empty/unknown results', () => {
    expect(extractToolResultText(null)).toBe('');
    expect(extractToolResultText({})).toBe('');
  });
});

describe('formatToolResult', () => {
  it('formats output under a result marker', () => {
    const result = { content: [{ type: 'text', text: 'done' }] };
    expect(formatToolResult(result, false)).toBe('↳ done');
  });

  it('marks errors', () => {
    const result = { content: [{ type: 'text', text: 'boom' }] };
    expect(formatToolResult(result, true)).toBe('↳ ⚠️ boom');
  });

  it('returns empty for no output (non-error)', () => {
    expect(formatToolResult({ content: [] }, false)).toBe('');
  });

  it('shows a marker for empty error output', () => {
    expect(formatToolResult({ content: [] }, true)).toBe('↳ ⚠️ (error)');
  });

  it('truncates long output at 1500 chars', () => {
    const result = { content: [{ type: 'text', text: 'x'.repeat(2000) }] };
    expect(formatToolResult(result, false).length).toBeLessThanOrEqual(1500 + 2);
  });
});

describe('formatToolCalls', () => {
  it('formats tool calls with arguments', () => {
    const msg = {
      content: [
        {
          type: 'toolCall',
          name: 'grep',
          arguments: { pattern: 'hello', path: '/src' },
        },
      ],
    } as any;
    const result = formatToolCalls(msg);
    expect(result).toBe('🔧 `grep` (pattern=hello, path=/src)');
  });

  it('formats tool calls without arguments', () => {
    const msg = {
      content: [{ type: 'toolCall', name: 'status', arguments: {} }],
    } as any;
    expect(formatToolCalls(msg)).toBe('🔧 `status`');
  });

  it('returns empty string when no tool calls', () => {
    const msg = {
      content: [{ type: 'text', text: 'hi' }],
    } as any;
    expect(formatToolCalls(msg)).toBe('');
  });

  it('truncates long argument values at 50 chars', () => {
    const longVal = 'x'.repeat(100);
    const msg = {
      content: [
        {
          type: 'toolCall',
          name: 'write',
          arguments: { content: longVal },
        },
      ],
    } as any;
    const result = formatToolCalls(msg);
    // 50 chars: 47 x's + "..."
    expect(result).toContain('content=' + 'x'.repeat(47) + '...');
  });

  it('joins multiple tool calls with newlines', () => {
    const msg = {
      content: [
        { type: 'toolCall', name: 'grep', arguments: { pattern: 'a' } },
        { type: 'toolCall', name: 'read', arguments: { path: '/b' } },
      ],
    } as any;
    const result = formatToolCalls(msg);
    expect(result).toBe('🔧 `grep` (pattern=a)\n🔧 `read` (path=/b)');
  });
});
