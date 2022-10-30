import { test } from 'uvu';
import * as assert from 'uvu/assert';

test('placeholder', () => {
  assert.is(1 + 2, 3);
});

test.run();

// TODO: Test rollup v2 and v3
