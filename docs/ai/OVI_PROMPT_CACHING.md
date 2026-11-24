# Stable prompt prefixes

Every chat starts with the versioned personality and fixed guidance for interpreting selected journal text. Together these exceed 1,024 o200k tokens before dynamic input. Time, UID, selected journal and conversation history follow the static prefix or stay outside the model request. This lets Groq recognize a matching prefix automatically. There is no cache API call or persisted application prompt cache.

The provider may reuse a matching prefix, depending on its current cache policy, prompt length, routing and timing. A miss follows the same request path. The stream parser reads usage either from the terminal extension or a usage frame. A missing cached-token field remains missing. Report zero only when the provider actually reports zero.

The operational reservation stores reported prompt and completion tokens, optional cached tokens, model, latency and estimated USD. The estimate uses $0.15 per million uncached input tokens, $0.075 for cached input and $0.60 for output. Missing cache detail uses the full input price. Pricing is an estimate as of the implementation review and should be checked before a billing analysis. With unknown usage, retain the budget reservation and omit the cost estimate. [Groq caching](https://console.groq.com/docs/prompt-caching) · [Model pricing](https://console.groq.com/docs/model/openai/gpt-oss-120b)

Review provider retention settings separately. An encrypted vault does not prevent an inference provider from temporarily processing selected plaintext. See [privacy and encryption](OVI_PRIVACY_AND_ENCRYPTION.md).
