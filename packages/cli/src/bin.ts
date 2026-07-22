#!/usr/bin/env node

import { runCli } from "./cli.js";
import { processIo } from "./io.js";

process.exitCode = await runCli(process.argv.slice(2), { io: processIo() });
