# Context management

The browser selects up to sixteen recent turns after Vault unlock. The server validates roles, lengths, request shape and actual body size before building model input. The chat endpoint accepts no client UID, system prompt, model override, tools or generation parameters.

`lib/ai/context.ts` starts with the versioned system text. It reserves the current user input and optional selected journal first, then adds the most recent complete user/assistant pairs that fit. Unanswered turns remain visible in the journal companion's history. The model receives complete exchanges in chronological order. Long required input produces an actionable validation error.

The tokenizer uses the o200k vocabulary plus a per-message framing allowance and a fixed provider margin. The default 4,800-token input budget leaves room for a 768-token completion, which includes reasoning. Both values are configurable within hard bounds below the model context window. The shared tokens-per-minute budget can further restrict admission. See [model specifications](https://console.groq.com/docs/model/openai/gpt-oss-120b).

The editor flushes its latest local checkpoint before handing the title, text and photo notes to a WeakMap keyed by the unlocked CryptoKey. A deep link cannot create this permission. The composer displays the selection and can remove it. The handoff caps a long journal at a 6,000-character excerpt. It joins the latest message as labeled user data for one accepted request. Image bytes, the library and Vault secrets are absent. After the turn, continuity comes from messages that are actually in history.
