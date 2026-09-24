/// Import worker: parses and persists exports off the main thread so the UI never freezes.
import { ImportController } from '../core/session';
import { ImportError } from '../core/types';
import type { WorkerScope } from '../../utils/workers';
import type { ImportRequest, ImportResponse } from './protocol';

const scope = self as unknown as WorkerScope;
const controller = new ImportController();

function post(msg: ImportResponse) {
  scope.postMessage(msg);
}

function fail(id: number, err: unknown) {
  post({
    type: 'error',
    id,
    message: err instanceof Error ? err.message : String(err),
    code: err instanceof ImportError ? err.code : 'unknown',
  });
}

scope.addEventListener('message', (event: MessageEvent<ImportRequest>) => {
  const req = event.data;
  switch (req.type) {
    case 'open':
      controller.open(req.file, req.fileName).then((result) => post({ type: 'opened', id: req.id, result }), (err) => fail(req.id, err));
      break;
    case 'preview':
      controller.preview(req.source).then((preview) => post({ type: 'previewed', id: req.id, preview }), (err) => fail(req.id, err));
      break;
    case 'start':
      controller
        .run(req.args, (progress) => post({ type: 'progress', id: req.id, progress }))
        .then((batch) => post({ type: 'finished', id: req.id, batch }), (err) => fail(req.id, err));
      break;
    case 'cancel':
      controller.cancel();
      break;
  }
});
