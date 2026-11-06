// Writes schema/comment.schema.json from the built core package (run after tsup).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commentJsonSchema } from '../dist/index.js';

const schemaDir = fileURLToPath(new URL('../schema/', import.meta.url));
mkdirSync(schemaDir, { recursive: true });
writeFileSync(schemaDir + 'comment.schema.json', JSON.stringify(commentJsonSchema(), null, 2) + '\n');
