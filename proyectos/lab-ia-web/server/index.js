import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(await realpath(fileURLToPath(import.meta.url)));
const labRoot = resolve(serverDir, '../../..');
const agentsDir = resolve(labRoot, 'agentes/agents');
const recentWorkspacesFile = resolve(labRoot, 'runtime/recent-workspaces');
const labOpenPath = resolve(labRoot, 'scripts/lab-open');
let activationInProgress = false;
const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let database;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const runtimeDir = resolve(labRoot, 'runtime');
  await mkdir(runtimeDir, { recursive: true });
  database = new DatabaseSync(resolve(runtimeDir, 'lab-ia.db'));
  database.exec(`
    PRAGMA foreign_keys = ON;
    BEGIN;
    CREATE TABLE IF NOT EXISTS conversaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      agente_id TEXT NOT NULL,
      modelo TEXT NOT NULL,
      workspace TEXT NOT NULL,
      creada_en TEXT NOT NULL,
      actualizada_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversacion_id INTEGER NOT NULL,
      rol TEXT NOT NULL,
      contenido TEXT NOT NULL,
      creado_en TEXT NOT NULL,
      FOREIGN KEY(conversacion_id)
        REFERENCES conversaciones(id)
        ON DELETE CASCADE
    );
    COMMIT;
  `);
} catch (error) {
  console.error('LAB-IA: no se pudo inicializar SQLite; el servidor no se iniciará.', error);
  try {
    database?.close();
  } finally {
    process.exit(1);
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function checkAgentsDir() {
  if (await realpath(agentsDir) !== agentsDir) {
    throw new Error('Agent directory must not be a symbolic link.');
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function workspaces(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    json(response, 405, { error: 'Método no permitido.' });
    return;
  }
  try {
    let content;
    try {
      content = await readFile(recentWorkspacesFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      json(response, 200, []);
      return;
    }
    const paths = [...new Set(content.split(/\r?\n/)
      .filter((path) => posix.isAbsolute(path) && !/[\x00-\x1f\x7f]/.test(path)))];
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

function validActivationPath(path) {
  return typeof path === 'string' && path.trim().length > 0
    && posix.isAbsolute(path) && !/[\x00-\x1f\x7f]/.test(path)
    && !path.split('/').includes('..');
}

function runLabOpen(workspacePath) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(labOpenPath, [workspacePath], {
      cwd: labRoot, shell: false, stdio: 'ignore',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // Target only this child; never signal a process group or unrelated process.
      child.kill('SIGKILL');
    }, 120_000);
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('No se pudo activar el workspace.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(Object.assign(new Error(), { code: 'ACTIVATION_TIMEOUT' }));
      else if (code !== 0) reject(new Error('No se pudo activar el workspace.'));
      else resolveResult();
    });
  });
}

async function activateWorkspace(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    json(response, 405, { success: false, error: 'Método no permitido.' });
    return;
  }
  // Require JSON and reject cross-origin browser requests to this local executor.
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    json(response, 415, { success: false, error: 'Se requiere application/json.' });
    return;
  }
  if (request.headers.origin) {
    let origin;
    try { origin = new URL(request.headers.origin); } catch { /* Invalid origin is rejected below. */ }
    if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) {
      json(response, 403, { success: false, error: 'Origen no permitido.' });
      return;
    }
  }
  if (activationInProgress) {
    json(response, 409, { success: false, error: 'Ya hay una activación de workspace en curso.' });
    return;
  }
  activationInProgress = true;
  try {
    let body;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16_384) {
          json(response, 413, { success: false, error: 'Solicitud demasiado grande.' });
          return;
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      json(response, 400, { success: false, error: 'JSON no válido.' });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'path')
      || !validActivationPath(body.path)) {
      json(response, 400, { success: false, error: 'Ruta de workspace no válida.' });
      return;
    }
    let content;
    try { content = await readFile(recentWorkspacesFile, 'utf8'); } catch (error) {
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
  }
}

async function conversations(request, response, path) {
  const isList = path === '/api/conversations';
  const match = /^\/api\/conversations\/([^/]+)(\/messages)?$/.exec(path);
  if (!isList && !match) {
    json(response, 404, { error: 'Endpoint no encontrado.' });
    return;
  }

  const isMessages = Boolean(match?.[2]);
  const allowed = isList ? ['GET', 'POST'] : isMessages ? ['POST'] : ['GET'];
  if (!allowed.includes(request.method)) {
    response.setHeader('Allow', allowed.join(', '));
    json(response, 405, { error: 'Método no permitido.' });
    return;
  }

  const id = isList ? null : Number(match[1]);
  if (!isList && (!/^[1-9][0-9]*$/.test(match[1]) || !Number.isSafeInteger(id))) {
    json(response, 400, { error: 'Identificador de conversación no válido.' });
    return;
  }

  try {
    if (isList && request.method === 'GET') {
      json(response, 200, database.prepare(`
        SELECT id, titulo, agente_id, modelo, workspace, creada_en, actualizada_en
        FROM conversaciones ORDER BY actualizada_en DESC
      `).all());
      return;
    }

    const conversation = isList ? null : database.prepare(`
      SELECT id, titulo, agente_id, modelo, workspace, creada_en, actualizada_en
      FROM conversaciones WHERE id = ?
    `).get(id);
    if (!isList && !conversation) {
      json(response, 404, { error: 'Conversación no encontrada.' });
      return;
    }
    if (request.method === 'GET') {
      const messages = database.prepare(`
        SELECT id, conversacion_id, rol, contenido, creado_en
        FROM mensajes WHERE conversacion_id = ? ORDER BY id ASC
      `).all(id);
      json(response, 200, { conversation, messages });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch {
      json(response, 400, { error: 'JSON no válido.' });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      json(response, 400, { error: 'Datos no válidos.' });
      return;
    }

    if (isList) {
      const fields = ['titulo', 'agente_id', 'modelo', 'workspace'];
      if (fields.some((field) => typeof body[field] !== 'string' || !body[field].trim())
        || !validId.test(body.agente_id)) {
        json(response, 400, { error: 'Datos de conversación no válidos.' });
        return;
      }
      const timestamp = new Date().toISOString();
      const created = database.prepare(`
        INSERT INTO conversaciones (titulo, agente_id, modelo, workspace, creada_en, actualizada_en)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id, titulo, agente_id, modelo, workspace, creada_en, actualizada_en
      `).get(...fields.map((field) => body[field].trim()), timestamp, timestamp);
      json(response, 201, created);
      return;
    }

    if (!['user', 'assistant'].includes(body.rol)
      || typeof body.contenido !== 'string' || !body.contenido.trim()) {
      json(response, 400, { error: 'Datos de mensaje no válidos.' });
      return;
    }
    const timestamp = new Date().toISOString();
    let message;
    database.exec('BEGIN');
    try {
      message = database.prepare(`
        INSERT INTO mensajes (conversacion_id, rol, contenido, creado_en)
        VALUES (?, ?, ?, ?)
        RETURNING id, conversacion_id, rol, contenido, creado_en
      `).get(id, body.rol, body.contenido, timestamp);
      database.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?')
        .run(timestamp, id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    json(response, 201, message);
  } catch {
    if (!response.headersSent) {
      json(response, 500, { error: 'No se pudo procesar la conversación.' });
    }
  }
}

const server = createServer(async (request, response) => {
  // Validate the raw path, without URL normalization that could hide traversal.
  const path = (request.url ?? '').split('?')[0];
  if (path === '/api/workspaces/activate') {
    await activateWorkspace(request, response);
    return;
  }
  if (path === '/api/workspaces') {
    await workspaces(request, response);
    return;
  }
  if (path === '/api/conversations' || path.startsWith('/api/conversations/')) {
    await conversations(request, response, path);
    return;
  }
  const isList = path === '/api/agents';
  const isDetail = path.startsWith('/api/agents/');

  if (!isList && !isDetail) {
    json(response, 404, { error: 'Endpoint no encontrado.' });
    return;
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    json(response, 405, { error: 'Método no permitido.' });
    return;
  }

  const id = isDetail ? path.slice('/api/agents/'.length) : null;
  if (isDetail && !validId.test(id)) {
    json(response, 400, { error: 'Identificador de agente no válido.' });
    return;
  }

  try {
    await checkAgentsDir();
    if (isList) {
      const entries = await readdir(agentsDir, { withFileTypes: true });
      const agents = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => ({ id: entry.name.slice(0, -3), filename: entry.name }))
        .filter((agent) => validId.test(agent.id))
        .sort((a, b) => a.filename.localeCompare(b.filename));
      json(response, 200, agents);
      return;
    }

    const filename = `${id}.md`;
    let file;
    try {
      file = await open(resolve(agentsDir, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
      if (!(await file.stat()).isFile()) {
        json(response, 404, { error: 'Agente no encontrado.' });
        return;
      }
      const content = await file.readFile('utf8');
      json(response, 200, { id, filename, content });
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) {
        json(response, 404, { error: 'Agente no encontrado.' });
      } else {
        throw error;
      }
    } finally {
      await file?.close();
    }
  } catch {
    if (!response.headersSent) {
      json(response, 500, { error: 'No se pudieron consultar los agentes.' });
    }
  }
});

server.listen(3001, '127.0.0.1', () => {
  console.log('LAB-IA: servidor local en http://127.0.0.1:3001');
});
