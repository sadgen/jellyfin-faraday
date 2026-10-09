// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function worker() {
  const handlers = {};
  const context = vm.createContext({
    self: {
      location: { origin: 'https://media.example' },
      registration: { scope: 'https://media.example/faraday/' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
    }, URL, Promise,
    caches: { keys: vi.fn().mockResolvedValue(['other-app', 'faraday-shell-v1', 'faraday-shell-v2']), delete: vi.fn() },
  });
  vm.runInContext(fs.readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8'), context);
  return { handlers, context };
}

describe('offline shell boundaries', () => {
  it('leaves same-origin API and authenticated media requests to the browser', () => {
    const { handlers } = worker();
    for (const path of ['/Items', '/Videos/1/stream', '/faraday/assets/a.js?api_key=secret']) {
      const respondWith = vi.fn();
      handlers.fetch({ request: { method: 'GET', url: `https://media.example${path}`, mode: 'cors', headers: new Headers() }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
    const respondWith = vi.fn();
    handlers.fetch({ request: { method: 'GET', url: 'https://media.example/faraday/assets/a.js', mode: 'cors', headers: new Headers({ Authorization: 'secret' }) }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('removes only older Faraday caches', async () => {
    const { handlers, context } = worker();
    let completion;
    context.self.clients = { claim: vi.fn() };
    handlers.activate({ waitUntil: promise => { completion = promise; } });
    await completion;
    expect(context.caches.delete).toHaveBeenCalledExactlyOnceWith('faraday-shell-v1');
  });
});
