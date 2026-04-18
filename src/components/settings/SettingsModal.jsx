import { useEffect, useState } from "react";

function SettingsModal({ isOpen, settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    if (isOpen) {
      setDraft(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) {
    return null;
  }

  const update = (key, value) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updatePrompt = (key, value) => {
    setDraft((prev) => ({
      ...prev,
      prompts: {
        ...prev.prompts,
        [key]: value
      }
    }));
  };

  const submit = (event) => {
    event.preventDefault();
    const minSec = Number(draft.suggestionIntervalMinSec);
    const maxSec = Number(draft.suggestionIntervalMaxSec);
    const normalizedMin = Math.min(minSec, maxSec);
    const normalizedMax = Math.max(minSec, maxSec);

    onSave({
      ...draft,
      transcriptIntervalSec: Number(draft.transcriptIntervalSec),
      suggestionIntervalMinSec: normalizedMin,
      suggestionIntervalMaxSec: normalizedMax,
      realtimeRefreshMinGapSec: Number(draft.realtimeRefreshMinGapSec),
      suggestionContextMaxAgeSec: Number(draft.suggestionContextMaxAgeSec),
      suggestionContextChunks: Number(draft.suggestionContextChunks),
      minimumSuggestionWords: Number(draft.minimumSuggestionWords),
      memoryContextChunks: Number(draft.memoryContextChunks),
      semanticWindowChunks: Number(draft.semanticWindowChunks),
      semanticChangeThreshold: Number(draft.semanticChangeThreshold),
      noveltyHistoryBatches: Number(draft.noveltyHistoryBatches),
      detailContextChunks: Number(draft.detailContextChunks),
      chatContextMessages: Number(draft.chatContextMessages),
      suggestionTemperature: Number(draft.suggestionTemperature),
      chatTemperature: Number(draft.chatTemperature)
    });
  };

  return (
    <div className="modal-overlay">
      <form className="modal-card" onSubmit={submit}>
        <div className="row row-between">
          <h3>Settings</h3>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>

        <label>
          Groq API key
          <input
            type="password"
            value={draft.apiKey || ""}
            onChange={(event) => update("apiKey", event.target.value)}
            placeholder="gsk_..."
            required
          />
        </label>

        <div className="grid-two">
          <label>
            Suggestion model
            <input
              value={draft.suggestionModel}
              onChange={(event) => update("suggestionModel", event.target.value)}
            />
          </label>
          <label>
            Chat model
            <input value={draft.chatModel} onChange={(event) => update("chatModel", event.target.value)} />
          </label>
          <label>
            Transcription model
            <input
              value={draft.transcriptionModel}
              onChange={(event) => update("transcriptionModel", event.target.value)}
            />
          </label>
          <label>
            Transcript interval (sec)
            <input
              type="number"
              min="3"
              max="20"
              value={draft.transcriptIntervalSec}
              onChange={(event) => update("transcriptIntervalSec", event.target.value)}
            />
          </label>
          <label>
            Suggestions min interval (sec)
            <input
              type="number"
              min="10"
              max="45"
              value={draft.suggestionIntervalMinSec}
              onChange={(event) => update("suggestionIntervalMinSec", event.target.value)}
            />
          </label>
          <label>
            Suggestions max interval (sec)
            <input
              type="number"
              min="10"
              max="60"
              value={draft.suggestionIntervalMaxSec}
              onChange={(event) => update("suggestionIntervalMaxSec", event.target.value)}
            />
          </label>
          <label>
            Realtime refresh min gap (sec)
            <input
              type="number"
              min="6"
              max="30"
              value={draft.realtimeRefreshMinGapSec}
              onChange={(event) => update("realtimeRefreshMinGapSec", event.target.value)}
            />
          </label>
          <label>
            Suggestion context chunks
            <input
              type="number"
              min="1"
              value={draft.suggestionContextChunks}
              onChange={(event) => update("suggestionContextChunks", event.target.value)}
            />
          </label>
          <label>
            Suggestion context max age (sec)
            <input
              type="number"
              min="60"
              max="600"
              value={draft.suggestionContextMaxAgeSec}
              onChange={(event) => update("suggestionContextMaxAgeSec", event.target.value)}
            />
          </label>
          <label>
            Min words before suggestions
            <input
              type="number"
              min="8"
              max="80"
              value={draft.minimumSuggestionWords}
              onChange={(event) => update("minimumSuggestionWords", event.target.value)}
            />
          </label>
          <label>
            Memory context chunks
            <input
              type="number"
              min="12"
              max="120"
              value={draft.memoryContextChunks}
              onChange={(event) => update("memoryContextChunks", event.target.value)}
            />
          </label>
          <label>
            Semantic window chunks
            <input
              type="number"
              min="6"
              max="40"
              value={draft.semanticWindowChunks}
              onChange={(event) => update("semanticWindowChunks", event.target.value)}
            />
          </label>
          <label>
            Semantic change threshold
            <input
              type="number"
              min="0.05"
              max="0.6"
              step="0.01"
              value={draft.semanticChangeThreshold}
              onChange={(event) => update("semanticChangeThreshold", event.target.value)}
            />
          </label>
          <label>
            Novelty history batches
            <input
              type="number"
              min="2"
              max="12"
              value={draft.noveltyHistoryBatches}
              onChange={(event) => update("noveltyHistoryBatches", event.target.value)}
            />
          </label>
          <label>
            Detail context chunks
            <input
              type="number"
              min="1"
              value={draft.detailContextChunks}
              onChange={(event) => update("detailContextChunks", event.target.value)}
            />
          </label>
          <label>
            Chat context messages
            <input
              type="number"
              min="1"
              value={draft.chatContextMessages}
              onChange={(event) => update("chatContextMessages", event.target.value)}
            />
          </label>
          <label>
            Suggestion temperature
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={draft.suggestionTemperature}
              onChange={(event) => update("suggestionTemperature", event.target.value)}
            />
          </label>
          <label>
            Chat temperature
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={draft.chatTemperature}
              onChange={(event) => update("chatTemperature", event.target.value)}
            />
          </label>
        </div>

        <label>
          Live suggestion prompt
          <textarea
            rows={8}
            value={draft.prompts.suggestions}
            onChange={(event) => updatePrompt("suggestions", event.target.value)}
          />
        </label>

        <label>
          Detailed answer prompt (on suggestion click)
          <textarea
            rows={6}
            value={draft.prompts.detailedAnswer}
            onChange={(event) => updatePrompt("detailedAnswer", event.target.value)}
          />
        </label>

        <label>
          Chat prompt
          <textarea
            rows={5}
            value={draft.prompts.chat}
            onChange={(event) => updatePrompt("chat", event.target.value)}
          />
        </label>

        <div className="row row-end">
          <button type="submit">Save settings</button>
        </div>
      </form>
    </div>
  );
}

export default SettingsModal;
