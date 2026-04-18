function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function encodeWavFromAudioBuffer(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;

  const mono = new Float32Array(frameCount);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i += 1) {
      mono[i] += data[i] / channelCount;
    }
  }

  const bytesPerSample = 2;
  const dataSize = mono.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < mono.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, mono[i]));
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, pcm, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export async function normalizeAudioForTranscription(audioBlob) {
  const originalType = String(audioBlob?.type || "").toLowerCase();
  if (!audioBlob || originalType.includes("wav")) {
    return {
      blob: audioBlob,
      converted: false
    };
  }

  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return {
      blob: audioBlob,
      converted: false
    };
  }

  const context = new Context();
  try {
    const inputBuffer = await audioBlob.arrayBuffer();
    const decoded = await context.decodeAudioData(inputBuffer.slice(0));
    const wavBlob = encodeWavFromAudioBuffer(decoded);
    return {
      blob: wavBlob,
      converted: true,
      sampleRate: decoded.sampleRate,
      durationSec: decoded.duration
    };
  } catch (_error) {
    return {
      blob: audioBlob,
      converted: false
    };
  } finally {
    await context.close();
  }
}
