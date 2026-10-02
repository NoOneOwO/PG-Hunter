/**
 * PG Hunter — HTML escaping / URL sanitisation tests.
 *
 * The repo has no test framework, so this uses Node's built-in runner
 * (`node:test`) rather than adding a dependency. Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  escapeAttr,
  escapeJsonForScript,
  safeUrl,
  safeImageSrc,
  attrs,
  str,
} from '../src/lib/html.ts';

test('escapeHtml neutralises tag and attribute injection', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('</script>'), '&lt;/script&gt;');
});

test('escapeAttr neutralises quote breakout', () => {
  assert.equal(escapeAttr('a" onload="alert(1)'), 'a&quot; onload=&quot;alert(1)');
  assert.equal(escapeAttr("a' onload='x"), 'a&#39; onload=&#39;x');
});

test('escapeHtml coerces non-strings without leaking [object Object]', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(NaN), '');
  assert.equal(escapeHtml(Infinity), '');
  assert.equal(escapeHtml(42), '42');
  assert.equal(str(null), '');
  assert.equal(str([1, 2]), '1, 2');
});

test('safeUrl rejects script-bearing schemes', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeUrl('  javascript:alert(1)'), null);
  assert.equal(safeUrl('vbscript:msgbox(1)'), null);
  assert.equal(safeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), null);
  assert.equal(safeUrl('file:///etc/passwd'), null);
});

test('safeUrl rejects control-character scheme smuggling', () => {
  assert.equal(safeUrl('java' + String.fromCharCode(0) + 'script:alert(1)'), null);
  assert.equal(safeUrl('java' + String.fromCharCode(0x2028) + 'script:alert(1)'), null);
  assert.equal(safeUrl('java' + String.fromCharCode(0x0a) + 'script:alert(1)'), null);
});

test('safeUrl rejects protocol-relative and empty values', () => {
  assert.equal(safeUrl('//evil.example.com'), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl('   '), null);
});

test('safeUrl allows the schemes the app actually uses', () => {
  assert.equal(safeUrl('/owner/listings'), '/owner/listings');
  assert.equal(safeUrl('#section'), '#section');
  assert.equal(safeUrl('?q=test'), '?q=test');
  assert.equal(safeUrl('https://www.youtube.com/watch?v=abc'), 'https://www.youtube.com/watch?v=abc');
  assert.equal(safeUrl('http://localhost:4321/x'), 'http://localhost:4321/x');
  assert.equal(safeUrl('mailto:owner@example.com'), 'mailto:owner@example.com');
  assert.equal(safeUrl('tel:+911234567890'), 'tel:+911234567890');
});

test('safeImageSrc allows base64 raster images but not svg or html', () => {
  assert.equal(
    safeImageSrc('data:image/png;base64,iVBORw0KGgo='),
    'data:image/png;base64,iVBORw0KGgo='
  );
  assert.equal(safeImageSrc('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), null);
  assert.equal(safeImageSrc('data:text/html,<script>alert(1)</script>'), null);
});

test('escapeJsonForScript prevents premature </script> termination', () => {
  const encoded = escapeJsonForScript({ note: '</script><img src=x onerror=alert(1)>' });
  assert.equal(encoded.includes('</script>'), false);
  assert.equal(encoded.includes('\\u003c'), true);
  assert.deepEqual(JSON.parse(encoded).note, '</script><img src=x onerror=alert(1)>');
});

test('attrs escapes values and drops empty attributes', () => {
  assert.equal(
    attrs({ id: 'a"b', n: 1, t: true, skip: null, empty: '' }),
    ' id="a&quot;b" n="1" t'
  );
});
