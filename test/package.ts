import * as path from 'node:path';
import { tests } from '@iobroker/testing';

// Validate the package files (package.json / io-package.json consistency) via @iobroker/testing.
tests.packageFiles(path.join(__dirname, '..'));
