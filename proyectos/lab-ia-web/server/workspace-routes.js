import { posix } from 'node:path';
import { createSessionGuard, readBoundedJson, AuthRequestError } from './security-http.js';

export const workspaceBodyLimits = Object.freeze({ activate: 16 * 1024, summary: 1024 });
const hasControlCharacters = value => Array.from(value).some(character => {
  const code = character.charCodeAt(0);
  return code <= 31 || code === 127;
});
function validActivationPath(path) {
  return typeof path === 'string' && path.trim().length > 0
    && posix.isAbsolute(path) && !hasControlCharacters(path)
    && !path.split('/').includes('..');
}

// Keep the existing workspace validations and process policy behind one boundary.
// All external work is injected so tests never launch Docker/OpenCode or a workspace.
export function createPrivateWorkspaceRoutes({ securityStore, json, readRecentWorkspaces, stat,
  inspectOpenCode, getOpenCodeStatus, queryOpenCode, workspaceSummaryConfig,
  inspectWorkspaceSnapshot, runWorkspaceSummary, runLabOpen, acquireActivationLock }) {
  const guard = createSessionGuard(securityStore);
  let activationInProgress = false;
  let summaryInProgress = false;
  async function workspaces(request, response) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Método no permitido.' });
      return;
    }
    try {
      let content;
      try {
        content = await readRecentWorkspaces();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        json(response, 200, []);
        return;
      }
      const paths = [...new Set(content.split(/\r?\n/)
        .filter((path) => posix.isAbsolute(path) && !hasControlCharacters(path)))];
      const result = await Promise.all(paths.map(async (path) => {
        let exists = true;
        try {
          await stat(path);
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
          exists = false;
        }
        return { path, type: /^\/mnt\/[a-z](?:\/|$)/i.test(path) ? 'windows' : 'wsl', exists };
      }));
      json(response, 200, result);
    } catch {
      json(response, 500, { error: 'No se pudieron consultar los workspaces recientes.' });
    }
  }

  async function activeWorkspace(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Método no permitido.' });
      return;
    }
    if (request.url.includes('?') || request.headers['transfer-encoding']
      || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
      json(response, 400, { error: 'Este endpoint no acepta parámetros ni cuerpo.' });
      return;
    }
    try {
      json(response, 200, await inspectOpenCode());
    } catch {
      json(response, 500, { error: 'No se pudo consultar Docker para determinar el workspace activo.' });
    }
  }

  async function openCodeStatus(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Método no permitido.' });
      return;
    }
    if (request.url.includes('?') || request.headers['transfer-encoding']
      || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
      json(response, 400, { error: 'Este endpoint no acepta parámetros ni cuerpo.' });
      return;
    }
    try {
      json(response, 200, await getOpenCodeStatus());
    } catch {
      json(response, 500, { error: 'No se pudo consultar el estado de OpenCode.' });
    }
  }

  async function workspaceSummary(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      json(response, 405, { success: false, error: 'Método no permitido.' });
      return;
    }
    if (summaryInProgress) {
      json(response, 409, { success: false, error: 'Ya hay un análisis de OpenCode en curso.' });
      return;
    }
    summaryInProgress = true;
    let releaseDelay = 0;
    let startedAt;
    try {
      const status = await getOpenCodeStatus();
      const unavailable = !status.available ? 'El contenedor OpenCode no existe.'
        : !status.running ? 'El contenedor OpenCode está detenido.'
          : !status.workspace ? 'OpenCode no tiene un montaje en /workspace.'
            : !status.cliAvailable ? 'La CLI de OpenCode no está disponible.' : null;
      if (unavailable) {
        json(response, 503, { success: false, error: unavailable });
        return;
      }
      // Fail closed if Reviewer was removed or its read-only tools policy changed.
      const agent = JSON.parse(await queryOpenCode(['exec', '--env', workspaceSummaryConfig,
        '--workdir', '/workspace', 'opencode',
        'opencode', '--pure', 'debug', 'agent', 'reviewer']));
      const action = (name) => agent.permission?.filter((rule) =>
        (rule.permission === name || rule.permission === '*') && rule.pattern === '*').at(-1)?.action;
      const blanketDenyIndex = Array.isArray(agent.permission) ? agent.permission.findLastIndex((rule) =>
        rule.permission === '*' && rule.pattern === '*' && rule.action === 'deny') : -1;
      if (agent.name !== 'reviewer' || agent.mode !== 'primary'
        || !Array.isArray(agent.permission) || !agent.tools
        || typeof agent.tools !== 'object' || Array.isArray(agent.tools)
        || Object.keys(agent.tools).length === 0
        || Object.values(agent.tools).some((enabled) => enabled !== false)
        || blanketDenyIndex < 0
        // OpenCode may append external_directory access to its truncation directory.
        // That is a permission for paths, not a tool; no later tool exception is allowed.
        || agent.permission.slice(blanketDenyIndex + 1).some((rule) =>
          rule.action !== 'deny' && rule.permission !== 'external_directory')
        || agent.permission.some((rule) => ['edit', 'write', 'bash', 'task'].includes(rule.permission)
          && rule.action === 'allow')
        || agent.tools?.edit !== false || agent.tools?.write !== false || agent.tools?.task !== false
        || action('edit') !== 'deny' || action('bash') !== 'deny'
        || action('task') !== 'deny') {
        json(response, 503, { success: false, error: 'No se pudo confirmar que Reviewer tenga todas las herramientas deshabilitadas.' });
        return;
      }
      const snapshot = await inspectWorkspaceSnapshot(status.workspace);
      startedAt = Date.now();
      const result = await runWorkspaceSummary(snapshot);
      json(response, 200, { success: true, workspace: status.workspace, agent: 'reviewer', summary: result });
    } catch (error) {
      if (error.retainLock && startedAt) releaseDelay = Math.max(0, 120_000 - (Date.now() - startedAt));
      json(response, error.timedOut ? 504 : 502, { success: false, error: error.timedOut
        ? 'El análisis de OpenCode excedió el tiempo máximo.'
        : error.inspectionFailed ? 'No se pudo inspeccionar el workspace de forma segura.'
          : error.invalidSummary ? 'OpenCode no devolvió el resumen en el formato esperado.'
          : 'No se pudo completar el análisis de OpenCode con una respuesta válida.' });
    } finally {
      if (releaseDelay) setTimeout(() => { summaryInProgress = false; }, releaseDelay).unref();
      else summaryInProgress = false;
    }
  }

  async function activateWorkspace(request, response, body) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      json(response, 405, { success: false, error: 'Método no permitido.' });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'path')
      || !validActivationPath(body.path)) {
      json(response, 400, { success: false, error: 'Ruta de workspace no válida.' });
      return;
    }
    if (activationInProgress) {
      json(response, 409, { success: false, error: 'Ya hay una activación de workspace en curso.' });
      return;
    }
    const releaseProposalLock = acquireActivationLock();
    if (!releaseProposalLock) {
      json(response, 409, { success: false, error: 'El workspace está ocupado.' }); return;
    }
    activationInProgress = true;
    try {
      let content;
      try { content = await readRecentWorkspaces(); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        content = '';
      }
      if (!content.split(/\r?\n/).filter(validActivationPath).includes(body.path)) {
        json(response, 403, { success: false, error: 'El workspace no pertenece al historial reciente actual.' });
        return;
      }
      let directory;
      try { directory = await stat(body.path); } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
      if (!directory?.isDirectory()) {
        json(response, 400, { success: false, error: 'El workspace no existe o no es un directorio.' });
        return;
      }
      try {
        await runLabOpen(body.path);
      } catch (error) {
        json(response, 500, { success: false, error: error.code === 'ACTIVATION_TIMEOUT'
          ? 'La activación excedió el tiempo máximo de 120 segundos.' : 'No se pudo activar el workspace.' });
        return;
      }
      json(response, 200, { success: true, workspace: body.path });
    } catch {
      json(response, 500, { success: false, error: 'No se pudo activar el workspace.' });
    } finally {
      activationInProgress = false;
      releaseProposalLock();
    }
  }

  const routes = new Map([
    ['/api/workspaces', { method: 'GET', handle: workspaces }],
    ['/api/workspaces/active', { method: 'GET', handle: activeWorkspace }],
    ['/api/workspaces/activate', { method: 'POST', limit: workspaceBodyLimits.activate, handle: activateWorkspace }],
    ['/api/opencode/status', { method: 'GET', handle: openCodeStatus }],
    ['/api/opencode/workspace-summary', { method: 'POST', limit: workspaceBodyLimits.summary, handle: workspaceSummary }],
  ]);
  return async function privateWorkspaces(request, response) {
    const path = (request.url ?? '').split('?')[0];
    const route = routes.get(path);
    if (!route) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      guard(request);
      if (request.method !== route.method) {
        response.setHeader('Allow', route.method);
        throw new AuthRequestError(405);
      }
      let body;
      if (route.method === 'POST') {
        if (request.url.includes('?')) throw new AuthRequestError(400);
        body = await readBoundedJson(request, { maxBytes: route.limit });
        guard(request); // Expiry/logout while streaming cannot acquire locks or run work.
        if (path === '/api/opencode/workspace-summary' && (!body || typeof body !== 'object'
          || Array.isArray(body) || Object.keys(body).length !== 0)) throw new AuthRequestError(400);
      }
      await route.handle(request, response, body);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        response.setHeader('Connection', 'close');
        response.once?.('finish', () => request.destroy());
        json(response, error instanceof AuthRequestError ? error.status : 500,
          { success: false, error: 'No se pudo autorizar o procesar la solicitud.' });
      }
    }
    return true;
  };
}
