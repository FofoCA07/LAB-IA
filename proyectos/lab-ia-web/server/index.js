import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(await realpath(fileURLToPath(import.meta.url)));
const labRoot = resolve(serverDir, '../../..');
const agentsDir = resolve(labRoot, 'agentes/agents');
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

const server = createServer(async (request, response) => {
  // Validate the raw path, without URL normalization that could hide traversal.
  const path = (request.url ?? '').split('?')[0];
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
