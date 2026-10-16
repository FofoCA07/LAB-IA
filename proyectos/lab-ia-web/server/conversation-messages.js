// Public message creation never accepts a client-selected role.
export function createPublicMessageHandler({ database, chat, json }) {
  return function addUserMessage(body, response, id) {
    if (chat.isGenerating(id)) {
      json(response, 409, { error: 'Ya se está generando una respuesta.' });
      return;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'content')
      || typeof body.content !== 'string' || !body.content.trim()) {
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
      `).get(id, 'user', body.content, timestamp);
      database.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?')
        .run(timestamp, id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    json(response, 201, message);
  };
}
