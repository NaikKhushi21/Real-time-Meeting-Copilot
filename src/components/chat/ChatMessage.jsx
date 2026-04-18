import { memo } from "react";

function ChatMessage({ message }) {
  return (
    <article className={`chat-message ${message.role}`}>
      <p className="chat-meta">
        {message.role}
        {message.label ? ` • ${message.label}` : ""}
      </p>
      <p>{message.content}</p>
    </article>
  );
}

export default memo(ChatMessage);
