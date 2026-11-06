/** A real 1x1 PNG, for tests that go through the PNG signature check. */
export const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);
export const pngBlob = () => new Blob([PNG_BYTES], { type: 'image/png' });
