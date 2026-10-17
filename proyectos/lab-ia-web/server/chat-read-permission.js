import { realpath } from 'node:fs/promises';
import { basename } from 'node:path';
import { buildAuthorizedCatalog, runProposalGit } from './change-proposal.js';
import { repositoryIdentity, same } from './proposal-safety.js';
import { planChatRead, validateReadPlan } from './chat-read-planner.js';

// The shared workspace lock blocks LAB-IA activation during planning/publication.
// Catalog construction opens/stat-checks regular files; it never reads their bytes.
export function createChatReadPermission({ actionStore, locks, getWorkspaceStatus,
  plan = planChatRead, catalogFor = buildAuthorizedCatalog, git = runProposalGit }) {
  return async function requestPermission({ lastUserMessage, turnId, turns }) {
    let release;
    try {
      let status;
      try { status = await getWorkspaceStatus(); } catch { status = null; }
      let workspace; let identity; let catalog = [];
      try {
        if (status?.available && status.running && typeof status.workspace === 'string' && status.workspace.startsWith('/')) {
          workspace = await realpath(status.workspace);
          if (workspace !== status.workspace) throw new Error();
          release = locks.acquire(workspace);
          if (!release) throw new Error();
          const deadline = Date.now() + 10_000;
          identity = await repositoryIdentity(workspace, git, deadline);
          catalog = await catalogFor(workspace, deadline, git);
        }
      } catch {
        // Without a usable repository, only a no-files response remains possible.
        release?.(); release = undefined; workspace = undefined; catalog = [];
      }
      const input = { lastUserMessage, agentId: 'senior-developer', agentName: 'Senior Developer', catalog: [...catalog] };
      const decision = validateReadPlan(await plan(input), catalog);
      if (decision.kind === 'respond') return null;
      if (!workspace) throw new Error();
      const current = await getWorkspaceStatus();
      if (!current.available || !current.running || current.workspace !== workspace) throw new Error();
      const deadline = Date.now() + 10_000;
      if (!same(identity, await repositoryIdentity(workspace, git, deadline))) throw new Error();
      const currentCatalog = await catalogFor(workspace, deadline, git);
      validateReadPlan(decision, currentCatalog);
      if (turns.get(turnId)?.state !== 'processing') throw new Error();
      // beforePublish runs synchronously after store validation and before visibility.
      // attachAction requires awaiting_permission, so transition then attach without awaits.
      const action = await actionStore.createReadAction({ agentId: input.agentId, agentName: input.agentName,
        workspace, projectName: basename(workspace).slice(0, 200) || 'Proyecto local',
        paths: decision.paths, reason: decision.reason }, {
        expectedIdentity: identity,
        beforePublish: pending => {
          turns.transition(turnId, 'awaiting_permission');
          try { turns.attachAction(turnId, pending.actionId); }
          catch (error) {
            if (turns.get(turnId)?.state === 'awaiting_permission') turns.transition(turnId, 'expired');
            throw error;
          }
        },
      });
      return { actionId: action.actionId, type: 'read', resources: [...action.resources] };
    } catch { throw new Error('No se pudo preparar una solicitud de lectura segura.'); }
    finally { release?.(); }
  };
}
