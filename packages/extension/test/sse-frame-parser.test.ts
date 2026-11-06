import { describe, expect, it } from 'vitest';
import { SseFrameParser } from '../src/sse-frame-parser.js';

describe('SseFrameParser', () => {
  it('parses named frames and joins multi-line data', () => {
    const p = new SseFrameParser();
    expect(p.push('event: comment.created\ndata: {"a":1}\n\n')).toEqual([
      { event: 'comment.created', data: '{"a":1}' },
    ]);
    expect(p.push('data: one\ndata: two\n\n')).toEqual([{ event: 'message', data: 'one\ntwo' }]);
  });

  it('buffers frames split across chunks and handles CRLF', () => {
    const p = new SseFrameParser();
    expect(p.push('event: ready\r\nda')).toEqual([]);
    expect(p.push('ta: {}\r\n\r\nevent: x\ndata: 1\n\n')).toEqual([
      { event: 'ready', data: '{}' },
      { event: 'x', data: '1' },
    ]);
  });

  it('drops comment-only keepalives', () => {
    expect(new SseFrameParser().push(': ping\n\n')).toEqual([]);
  });
});
