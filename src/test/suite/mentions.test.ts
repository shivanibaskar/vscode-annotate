import * as assert from 'assert';
import { parseMentions, commentHasMention, collectAllMentions } from '../../mentions';

suite('parseMentions', () => {
  test('returns empty array for comment with no mentions', () => {
    assert.deepStrictEqual(parseMentions('just a plain comment'), []);
  });

  test('parses a single mention', () => {
    assert.deepStrictEqual(parseMentions('needs review @question'), ['@question']);
  });

  test('parses multiple distinct mentions', () => {
    const result = parseMentions('this is @critical and also @todo');
    assert.deepStrictEqual(result.sort(), ['@critical', '@todo']);
  });

  test('deduplicates repeated mentions', () => {
    assert.deepStrictEqual(parseMentions('@todo fix this @todo'), ['@todo']);
  });

  test('lowercases all mentions', () => {
    assert.deepStrictEqual(parseMentions('@TODO @Critical'), ['@todo', '@critical']);
  });

  test('ignores @ embedded in email addresses or other word characters', () => {
    assert.deepStrictEqual(parseMentions('email@example.com price is $10 @ store'), []);
  });

  test('handles mention at start of string', () => {
    assert.deepStrictEqual(parseMentions('@stale this annotation is outdated'), ['@stale']);
  });
});

suite('commentHasMention', () => {
  test('returns false for empty mention set', () => {
    assert.strictEqual(commentHasMention('@todo fix this', new Set()), false);
  });

  test('returns true when comment contains a selected mention', () => {
    assert.strictEqual(commentHasMention('see @question here', new Set(['@question'])), true);
  });

  test('returns false when comment has no matching mention', () => {
    assert.strictEqual(commentHasMention('plain comment', new Set(['@critical'])), false);
  });

  test('returns true for any matching mention in multi-select', () => {
    assert.strictEqual(
      commentHasMention('@todo and some text', new Set(['@critical', '@todo'])),
      true
    );
  });
});

suite('collectAllMentions', () => {
  test('returns empty array for comments with no mentions', () => {
    assert.deepStrictEqual(collectAllMentions(['hello', 'world']), []);
  });

  test('collects and sorts unique mentions across multiple comments', () => {
    const result = collectAllMentions([
      'first @todo',
      'second @critical',
      'third @todo again',
    ]);
    assert.deepStrictEqual(result, ['@critical', '@todo']);
  });

  test('returns sorted results', () => {
    const result = collectAllMentions(['@zebra @apple @mango']);
    assert.deepStrictEqual(result, ['@apple', '@mango', '@zebra']);
  });
});
