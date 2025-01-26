const recordingButton = document.querySelector("[recording-button]")!;
const videoPlayer = document.querySelector(
    "[video-player]"
)! as HTMLVideoElement;

let mediaStream: MediaStream | null = null;

const sampleConstraints = {
    audio: true,
    video: {
        width: { min: 720 },
        height: { min: 480 },
    },
};

// Toggle recording on button click
recordingButton?.addEventListener("click", () => {
    mediaStream === null ? startRecording() : stopRecording();
});

// Start the recording (get media)
async function startRecording() {
    videoPlayer.style.display = "block";
    recordingButton.textContent = "Stop Recording";
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia(
            sampleConstraints
        );
        playStream(mediaStream);
    } catch (err) {
        console.error("Error accessing media devices:", err);
    }
}

// Stop the recording
function stopRecording() {
    if (mediaStream) {
        stopStreamTracks(mediaStream);
        mediaStream = null;
        resetUI();
    }
}

// Play the media stream in the video player
function playStream(stream: MediaStream) {
    if (videoPlayer) {
        videoPlayer.srcObject = stream;
    }
}

// Stop all tracks in the stream
function stopStreamTracks(stream: MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
}

// Reset UI elements
function resetUI() {
    if (videoPlayer) {
        videoPlayer.style.display = "none";
        videoPlayer.srcObject = null;
    }
    if (recordingButton) {
        recordingButton.textContent = "Start Recording";
    }
}
