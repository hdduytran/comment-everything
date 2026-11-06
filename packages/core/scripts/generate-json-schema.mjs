// Writes schema/comment.schema.json from the built core package (run after tsup).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { commentJsonSchema } from '../dist/index.js';

const schemaDir = path.join(import.meta.dirname, '..', 'schema');
mkdirSync(schemaDir, { recursive: true });
writeFileSync(
  path.join(schemaDir, 'comment.schema.json'),
  JSON.stringify(commentJsonSchema(), null, 2) + '\n',
);
