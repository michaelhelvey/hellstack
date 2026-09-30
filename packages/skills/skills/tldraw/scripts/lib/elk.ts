import { createRequire } from "node:module";

import type { ELK, ELKConstructorArguments } from "elkjs/lib/elk-api.js";

interface ElkWorkerModule {
  Worker: new (url?: string) => Worker;
}

type ElkApiConstructor = new (options: ELKConstructorArguments) => ELK;

// elk-worker thinks that it is in a web worker when `self` is set and `document` is not. Bun sets
// `self`, so remove it while the module loads. The module then exports a worker that runs in
// this thread.
function requireWithoutSelf(require: NodeJS.Require, id: string): ElkWorkerModule {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
  Reflect.deleteProperty(globalThis, "self");
  try {
    return require(id) as ElkWorkerModule;
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "self", descriptor);
  }
}

/** Makes an ELK instance that runs in this thread. `base` is the path that elkjs resolves from. */
export function createElk(base: string | URL): ELK {
  const require = createRequire(base);
  const { Worker } = requireWithoutSelf(require, "elkjs/lib/elk-worker.min.js");
  const ElkApi = require("elkjs/lib/elk-api.js") as ElkApiConstructor;
  return new ElkApi({ workerFactory: (url) => new Worker(url) });
}
