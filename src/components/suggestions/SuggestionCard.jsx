import { memo } from "react";

function prettyType(type) {
  return type.replaceAll("_", " ");
}

function SuggestionCard({ suggestion, onClick }) {
  return (
    <button className="suggestion-card" onClick={() => onClick(suggestion)}>
      <span className={`tag tag-${suggestion.type}`}>{prettyType(suggestion.type)}</span>
      <p>{suggestion.preview}</p>
      <small>{suggestion.why}</small>
    </button>
  );
}

export default memo(SuggestionCard);
