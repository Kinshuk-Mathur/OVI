# Future memory research

The contract in `lib/ai/memory.ts` defines a retrieval request and evidence-linked records for confirmed personal facts, episodes, conversations and reflections. Its V1 provider returns an empty list. The active context manager only has access to the submitted recent messages and explicitly selected journal.

A future provider could supply a small set of user-authorized records to the dynamic portion of the prompt builder. Before that integration, define consent, relevance, evidence provenance, expiration, correction and deletion. Give the user a way to see which record influenced a reply. Budget memory tokens alongside other optional context and keep the fixed personality prefix stable.

Retrieval supplies evidence for a particular request. Model training changes model parameters. V1 implements neither automatic extraction nor training on journals. A missing memory should lead to uncertainty or a clarifying question.
