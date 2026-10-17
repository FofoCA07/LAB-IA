import { createSessionGuard, readBoundedJson, AuthRequestError } from './security-http.js';
import { validateChangeRequest } from './change-proposal.js';
import { validateApplyRequest } from './apply-change-proposal.js';

export const proposalBodyLimits = Object.freeze({ change: 32 * 1024, apply: 1024 });

// Authentication wraps the existing proposal/apply safety pipeline unchanged.
export function createPrivateProposalHandlers({ securityStore, json, changeProposal, applyChangeProposal }) {
  const guard = createSessionGuard(securityStore);
  function protect(handle, maxBytes, validate) {
    return async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      try {
        guard(request);
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          throw new AuthRequestError(405);
        }
        if (request.url.includes('?')) throw new AuthRequestError(400);
        const body = await readBoundedJson(request, { maxBytes });
        guard(request); // Streaming cannot outlive session authority and then claim an ID.
        try { validate(body); } catch { throw new AuthRequestError(400); }
        await handle(request, response, body);
      } catch (error) {
        if (!response.headersSent && !response.destroyed) {
          response.setHeader('Connection', 'close');
          response.once?.('finish', () => request.destroy());
          json(response, error instanceof AuthRequestError ? error.status : 500,
            { error: 'No se pudo autorizar o procesar la solicitud de propuesta.' });
        }
      }
    };
  }
  return Object.freeze({
    changeProposal: protect(changeProposal, proposalBodyLimits.change, validateChangeRequest),
    applyChangeProposal: protect(applyChangeProposal, proposalBodyLimits.apply, validateApplyRequest),
  });
}
