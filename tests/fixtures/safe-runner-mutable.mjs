#!/usr/bin/env node
import fs from 'node:fs';

fs.writeFileSync(process.argv[2], 'payload executed\n');
