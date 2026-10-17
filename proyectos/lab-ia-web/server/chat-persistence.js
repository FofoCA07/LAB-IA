// Shared synchronous SQLite boundary for ordinary replies and read continuations.
export function createChatPersistence(database) {
  return {
    loadContext(turn) {
      const conversation = database.prepare('SELECT agente_id FROM conversaciones WHERE id = ?').get(turn.conversationId);
      const history = database.prepare('SELECT id, rol, contenido FROM mensajes WHERE conversacion_id = ? ORDER BY id ASC').all(turn.conversationId);
      return { agentId: conversation?.agente_id, history };
    },
    persistAssistant(turn, content) {
      database.exec('BEGIN');
      try {
        const current = database.prepare('SELECT id FROM mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT 1').get(turn.conversationId);
        if (current?.id !== turn.userMessageId) throw new Error('Conversation changed.');
        const timestamp = new Date().toISOString();
        const inserted = database.prepare('INSERT INTO mensajes (conversacion_id, rol, contenido, creado_en) VALUES (?, ?, ?, ?)')
          .run(turn.conversationId, 'assistant', content, timestamp);
        const messageId = Number(inserted.lastInsertRowid);
        if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('Invalid message.');
        database.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?').run(timestamp, turn.conversationId);
        database.exec('COMMIT');
        return messageId;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
}
