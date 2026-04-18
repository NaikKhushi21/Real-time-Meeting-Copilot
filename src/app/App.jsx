import TranscriptPanel from "../components/transcript/TranscriptPanel";
import SuggestionsPanel from "../components/suggestions/SuggestionsPanel";
import ChatPanel from "../components/chat/ChatPanel";
import SettingsModal from "../components/settings/SettingsModal";
import { downloadSessionExport } from "../services/exportSession";
import { useMeetingPipeline } from "../hooks/useMeetingPipeline";
import { useChatEngine } from "../hooks/useChatEngine";

function App() {
  const meeting = useMeetingPipeline();
  const chat = useChatEngine({
    settingsRef: meeting.settingsRef,
    transcriptRef: meeting.transcriptRef
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>TwinMind - Live Suggestions</h1>
        <p>Transcript • Live Suggestions • Chat</p>
      </header>

      <main className="columns">
        <TranscriptPanel
          isRecording={meeting.recorder.isRecording}
          isBusy={meeting.isTranscribing || meeting.isRefreshing}
          transcriptChunks={meeting.transcriptChunks}
          transcriptIntervalSec={meeting.settings.transcriptIntervalSec}
          recorderError={meeting.recorder.error}
          pipelineError={meeting.pipelineError}
          onToggleRecording={meeting.toggleRecording}
          onOpenSettings={() => meeting.setIsSettingsOpen(true)}
          onExport={() =>
            downloadSessionExport({
              transcriptChunks: meeting.transcriptChunks,
              suggestionBatches: meeting.suggestionBatches,
              chatMessages: chat.chatMessages,
              settings: meeting.settings
            })
          }
        />

        <SuggestionsPanel
          isRefreshing={meeting.isRefreshing}
          suggestionBatches={meeting.suggestionBatches}
          refreshCountdown={meeting.refreshCountdown}
          onRefresh={meeting.manualRefresh}
          onSelectSuggestion={chat.handleSuggestionClick}
        />

        <ChatPanel
          chatMessages={chat.chatMessages}
          isChatLoading={chat.isChatLoading}
          onSubmitQuestion={chat.handleUserQuestion}
        />
      </main>

      <SettingsModal
        isOpen={meeting.isSettingsOpen}
        settings={meeting.settings}
        onClose={() => meeting.setIsSettingsOpen(false)}
        onSave={meeting.saveSettings}
      />
    </div>
  );
}

export default App;
