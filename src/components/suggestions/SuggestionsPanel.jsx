import { memo, useRef } from "react";
import Panel from "../layout/Panel";
import SuggestionCard from "./SuggestionCard";
import { useAutoScroll } from "../../hooks/useAutoScroll";

function SuggestionsPanel({
  isRefreshing,
  suggestionBatches,
  refreshCountdown,
  onRefresh,
  onSelectSuggestion
}) {
  const listRef = useRef(null);
  useAutoScroll(listRef, suggestionBatches.length);

  return (
    <Panel
      title="2. Live Suggestions"
      rightLabel={`${suggestionBatches.length} batches`}
      className="panel-scroll"
    >
      <div className="row row-between">
        <button className="secondary-button" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing..." : "Reload suggestions"}
        </button>
        <span className="dim-text">auto-refresh in {refreshCountdown}s</span>
      </div>

      <p className="helper-text">
        Every refresh creates exactly 3 fresh suggestions from recent transcript context.
      </p>

      <div ref={listRef} className="scroll-region suggestions-list">
        {suggestionBatches.length ? (
          suggestionBatches.map((batch, batchIndex) => (
            <article
              key={batch.id}
              className={`batch ${batchIndex > 0 ? "batch-old" : ""}`}
            >
              <p className="batch-label">Batch {suggestionBatches.length - batchIndex} • {batch.time}</p>
              <div className="row-stack">
                {batch.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onClick={onSelectSuggestion}
                  />
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="empty-text">Suggestions appear after transcript context is available.</p>
        )}
      </div>
    </Panel>
  );
}

export default memo(SuggestionsPanel);
