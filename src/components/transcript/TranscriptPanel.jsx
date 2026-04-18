import { memo, useRef } from "react";
import Panel from "../layout/Panel";
import { useAutoScroll } from "../../hooks/useAutoScroll";

function TranscriptPanel({
  isRecording,
  isBusy,
  transcriptChunks,
  transcriptIntervalSec,
  recorderError,
  pipelineError,
  onToggleRecording,
  onExport,
  onOpenSettings
}) {
  const transcriptRef = useRef(null);
  useAutoScroll(transcriptRef, transcriptChunks.length);

  return (
    <Panel
      title="1. Mic & Transcript"
      rightLabel={isRecording ? "Recording" : "Idle"}
      className="panel-scroll"
    >
      <div className="row gap-sm">
        <button
          className={`mic-button ${isRecording ? "mic-on" : ""}`}
          onClick={onToggleRecording}
          disabled={isBusy}
        >
          <span />
          {isRecording ? "Stop mic" : "Start mic"}
        </button>
        <button className="secondary-button" onClick={onOpenSettings}>
          Settings
        </button>
        <button className="secondary-button" onClick={onExport}>
          Export
        </button>
      </div>

      <p className="helper-text">
        Transcript updates roughly every {transcriptIntervalSec}s while recording.
      </p>

      {recorderError ? <p className="error-text">{recorderError}</p> : null}
      {pipelineError ? <p className="error-text">{pipelineError}</p> : null}

      <div ref={transcriptRef} className="scroll-region transcript-list">
        {transcriptChunks.length ? (
          transcriptChunks.map((chunk) => (
            <p key={chunk.id}>
              <span className="dim-text">{chunk.time}</span> {chunk.text}
            </p>
          ))
        ) : (
          <p className="empty-text">Transcript will appear here after recording starts.</p>
        )}
      </div>
    </Panel>
  );
}

export default memo(TranscriptPanel);
