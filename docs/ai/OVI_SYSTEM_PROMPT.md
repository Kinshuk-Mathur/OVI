# Personality version 1.0.0

The canonical instructions live in `src/lib/ai/prompts/ovi-personality-v1.ts`. The module contains the owner's fifteen rules verbatim. They ask OVI to follow English, Hindi and Hinglish naturally, respect requests to listen, give practical help when invited, and acknowledge missing memories. They also cover autonomy, emotional boundaries and credible safety concerns.

The first system message starts with this exact prompt followed by stable instructions for journal excerpts, photo notes, script matching, concise casual replies and location-independent guidance for immediate danger. Change its semantic version when editing it. Compare the same synthetic cases across prompt versions, holding model, generation settings and history constant. The UI displays model output as escaped text. Provider reasoning has no display path.

The fixtures in `tests/ai-evaluations.json` specify a user message, optional prior turns and a human review criterion. Judge naturalness, language choice, conciseness, relevance and safety separately. A prompt can reduce errors, but fluent wording is no guarantee of accuracy. See [research notes](OVI_RESEARCH_NOTES.md).
